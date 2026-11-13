// listener-rec: records a live «مجلس» the way a student's phone hears it.
//
// The LiveKit room-composite egress places every audio packet by the SENDER's
// clock (RTP timestamps + RTCP sender reports). When a phone's clock drifts or
// jumps, the egress mixer holds or drops whole minutes (Nov 2026 holes). Live
// listeners never hear that, because a phone plays each packet when it ARRIVES.
//
// This recorder does the same: it joins every prd_/stg_ room as a hidden
// recorder, and writes each audio track to its own Ogg/Opus file whose timeline
// follows the SERVER's arrival clock:
//   - packets are written back to back (no re-encoding, no mixing during the live);
//   - a real pause (DTX, mute, reconnect: no packet ARRIVED for resyncGap) is
//     filled with Opus silence frames up to the packet's arrival time, so the
//     timeline only catches up in pauses, never inside continuous speech;
//   - a packet lost in the network (sequence gap) is replaced by silence of the
//     same length, so the timeline does not shift;
//   - a sender whose clock runs fast cannot push its track more than maxAhead
//     ahead of the wall clock (comfort-noise packets are dropped first).
// When the room ends, the tracks are mixed with ffmpeg by their arrival offsets.
//
// Runs BESIDE the egress (comparison phase): it never touches the database or
// the published lecture.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media/oggwriter"
)

const (
	sampleRate = 48000
	resyncGap  = 200 * time.Millisecond // a pause (gap between ARRIVALS) longer than this is placed at its arrival time
	maxLag     = 5 * time.Second        // a slow sender with no pauses at all is still pulled back after this
	maxAhead   = 1 * time.Second        // a fast sender may run at most this far ahead
	hardAhead  = 3 * time.Second        // beyond this, drop any packet
	identity   = "listener-rec"
	emptyGrace = 20 * time.Second // leave a room this long after the last visible participant
)

// Opus «silence» frame: TOC 0xF8 (CELT FB 20 ms, one frame) + an empty frame.
var opusSilence = []byte{0xF8, 0xFF, 0xFE}

var (
	wsURL, httpURL, apiKey, apiSecret, outDir string
	prefixes                                  []string
	safeName                                  = regexp.MustCompile(`[^A-Za-z0-9_.-]`)
)

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	wsURL = env("LIVEKIT_URL", "ws://almahajja-livekit:7880")
	httpURL = strings.Replace(wsURL, "ws", "http", 1)
	apiKey = env("LIVEKIT_API_KEY", os.Getenv("LIVEKIT_WEBHOOK_KEY"))
	apiSecret = env("LIVEKIT_API_SECRET", os.Getenv("LIVEKIT_WEBHOOK_SECRET"))
	outDir = env("OUT_DIR", "/recordings/listener")
	prefixes = strings.Split(env("ROOM_PREFIXES", "prd_,stg_"), ",")
	if apiKey == "" || apiSecret == "" {
		log.Fatal("LIVEKIT_API_KEY / LIVEKIT_API_SECRET missing")
	}
	if err := os.MkdirAll(outDir, 0o775); err != nil {
		log.Fatal(err)
	}
	log.Printf("listener-rec up: %s prefixes=%v out=%s", wsURL, prefixes, outDir)

	svc := lksdk.NewRoomServiceClient(httpURL, apiKey, apiSecret)
	var mu sync.Mutex
	active := map[string]bool{}
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		res, err := svc.ListRooms(ctx, &livekit.ListRoomsRequest{})
		cancel()
		if err != nil {
			log.Printf("list rooms: %v", err)
		} else {
			for _, r := range res.Rooms {
				if !wanted(r.Name) || r.NumParticipants == 0 {
					continue
				}
				mu.Lock()
				busy := active[r.Name]
				if !busy {
					active[r.Name] = true
				}
				mu.Unlock()
				if !busy {
					go func(room string) {
						record(room)
						mu.Lock()
						delete(active, room)
						mu.Unlock()
					}(r.Name)
				}
			}
		}
		time.Sleep(3 * time.Second)
	}
}

func wanted(room string) bool {
	for _, p := range prefixes {
		if p != "" && strings.HasPrefix(room, p) {
			return true
		}
	}
	return false
}

func token(room string) (string, error) {
	f, t := false, true
	at := auth.NewAccessToken(apiKey, apiSecret)
	at.SetVideoGrant(&auth.VideoGrant{
		RoomJoin: true, Room: room, CanSubscribe: &t, CanPublish: &f, CanPublishData: &f,
		Hidden: true, Recorder: true,
	}).SetIdentity(identity).SetValidFor(24 * time.Hour)
	return at.ToJWT()
}

// ── one room ────────────────────────────────────────────────────────────────

type trackFile struct {
	File      string `json:"file"`
	Identity  string `json:"identity"`
	TrackSid  string `json:"trackSid"`
	StartUnix int64  `json:"startUnixMs"` // arrival of the first packet (server clock)
	EndUnix   int64  `json:"endUnixMs"`
	Packets   int64  `json:"packets"`
	Filled    int64  `json:"silenceFrames"`
	Dropped   int64  `json:"droppedAhead"`
}

type session struct {
	room    string
	dir     string
	joined  time.Time
	mu      sync.Mutex
	tracks  []*trackFile
	wg      sync.WaitGroup
	seq     int
	done    chan struct{}
	ended   sync.Once
	lastVis time.Time
}

func record(room string) {
	tok, err := token(room)
	if err != nil {
		log.Printf("[%s] token: %v", room, err)
		return
	}
	s := &session{room: room, joined: time.Now(), done: make(chan struct{}), lastVis: time.Now()}
	s.dir = filepath.Join(outDir, safeName.ReplaceAllString(room, "_")+"-"+s.joined.UTC().Format("20060102T150405Z"))
	if err := os.MkdirAll(s.dir, 0o775); err != nil {
		log.Printf("[%s] mkdir: %v", room, err)
		return
	}
	cb := lksdk.NewRoomCallback()
	cb.ParticipantCallback.OnTrackSubscribed = func(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
		if track.Kind() != webrtc.RTPCodecTypeAudio {
			return
		}
		s.wg.Add(1)
		go func() {
			defer s.wg.Done()
			s.writeTrack(track, rp.Identity(), pub.SID())
		}()
	}
	cb.OnDisconnected = func() { s.end("disconnected") }
	cb.OnDisconnectedWithReason = func(reason lksdk.DisconnectionReason) { s.end(fmt.Sprintf("disconnected: %v", reason)) }
	lkRoom, err := lksdk.ConnectToRoomWithToken(wsURL, tok, cb, lksdk.WithAutoSubscribe(true))
	if err != nil {
		log.Printf("[%s] connect: %v", room, err)
		_ = os.Remove(s.dir)
		return
	}
	log.Printf("[%s] joined → %s", room, s.dir)

	// Leave when nobody visible is left (a hidden recorder must not keep the room alive).
	tick := time.NewTicker(5 * time.Second)
loop:
	for {
		select {
		case <-s.done:
			break loop
		case <-tick.C:
			if len(lkRoom.GetRemoteParticipants()) > 0 {
				s.lastVis = time.Now()
			} else if time.Since(s.lastVis) > emptyGrace {
				s.end("room empty")
				break loop
			}
		}
	}
	tick.Stop()
	lkRoom.Disconnect()
	s.wg.Wait()
	s.finish()
}

func (s *session) end(why string) {
	s.ended.Do(func() {
		log.Printf("[%s] end: %s", s.room, why)
		close(s.done)
	})
}

func opusSamples(p []byte) int {
	if len(p) < 1 {
		return 0
	}
	cfg := p[0] >> 3
	var dur float64 // ms
	switch {
	case cfg < 12:
		dur = []float64{10, 20, 40, 60}[cfg%4]
	case cfg < 16:
		dur = []float64{10, 20}[cfg%2]
	default:
		dur = []float64{2.5, 5, 10, 20}[cfg%4]
	}
	frames := 1
	switch p[0] & 3 {
	case 1, 2:
		frames = 2
	case 3:
		if len(p) < 2 {
			return 0
		}
		frames = int(p[1] & 0x3F)
	}
	return int(dur*48) * frames
}

// RFC 2198 RED → the primary (last) block.
func redPrimary(p []byte) []byte {
	i, lens := 0, 0
	for {
		if i >= len(p) {
			return nil
		}
		if p[i]&0x80 == 0 { // last header: 1 byte
			i++
			break
		}
		if i+4 > len(p) {
			return nil
		}
		lens += int(p[i+2]&0x03)<<8 | int(p[i+3])
		i += 4
	}
	if i+lens > len(p) {
		return nil
	}
	return p[i+lens:]
}

func (s *session) writeTrack(track *webrtc.TrackRemote, ident, sid string) {
	isRed := strings.EqualFold(track.Codec().MimeType, "audio/red")
	s.mu.Lock()
	s.seq++
	tf := &trackFile{File: fmt.Sprintf("%03d_%s_%s.ogg", s.seq, safeName.ReplaceAllString(ident, "_"), safeName.ReplaceAllString(sid, "_")), Identity: ident, TrackSid: sid}
	s.tracks = append(s.tracks, tf)
	s.mu.Unlock()
	w, err := oggwriter.New(filepath.Join(s.dir, tf.File), sampleRate, 1)
	if err != nil {
		log.Printf("[%s] ogg %s: %v", s.room, tf.File, err)
		return
	}
	defer w.Close()
	log.Printf("[%s] track %s (%s) codec=%s", s.room, sid, ident, track.Codec().MimeType)

	var t0, lastArrival time.Time
	var next uint64 // samples written
	var lastSeq uint16
	lastN := 960
	haveSeq := false
	silence := func(upTo uint64) {
		for next+960 <= upTo {
			if err := w.WriteRTP(&rtp.Packet{Header: rtp.Header{Timestamp: uint32(next)}, Payload: opusSilence}); err != nil {
				return
			}
			next += 960
			tf.Filled++
		}
	}
	for {
		pkt, _, err := track.ReadRTP()
		if err != nil {
			break
		}
		now := time.Now()
		payload := pkt.Payload
		if isRed {
			payload = redPrimary(payload)
		}
		if len(payload) == 0 {
			continue
		}
		lost := 0
		if haveSeq {
			d := int16(pkt.SequenceNumber - lastSeq)
			if d <= 0 {
				continue // duplicate / late reordered packet
			}
			if d > 1 && d <= 50 {
				lost = int(d) - 1
			}
		}
		lastSeq, haveSeq = pkt.SequenceNumber, true
		n := opusSamples(payload)
		if n <= 0 {
			continue
		}
		if t0.IsZero() {
			t0 = now
			tf.StartUnix = now.UnixMilli()
		}
		arrival := uint64(now.Sub(t0).Seconds() * sampleRate)
		paused := !lastArrival.IsZero() && now.Sub(lastArrival) > resyncGap
		lastArrival = now
		if lost > 0 && !paused { // network loss: keep the timeline with silence of the lost length
			silence(next + uint64(lost*lastN))
		}
		lastN = n
		switch {
		case arrival > next && (paused || arrival > next+uint64(maxLag.Seconds()*sampleRate)):
			silence(arrival) // a pause: place the next words at their arrival time
		case next > arrival+uint64(hardAhead.Seconds()*sampleRate),
			next > arrival+uint64(maxAhead.Seconds()*sampleRate) && len(payload) <= 3:
			tf.Dropped++
			continue
		}
		if err := w.WriteRTP(&rtp.Packet{Header: rtp.Header{Timestamp: uint32(next)}, Payload: payload}); err != nil {
			log.Printf("[%s] write %s: %v", s.room, tf.File, err)
			break
		}
		next += uint64(n)
		tf.Packets++
		tf.EndUnix = now.UnixMilli()
	}
	log.Printf("[%s] track %s closed: %d packets, %d silence frames, %d dropped", s.room, sid, tf.Packets, tf.Filled, tf.Dropped)
}

// ── after the room ──────────────────────────────────────────────────────────

func (s *session) finish() {
	s.mu.Lock()
	tracks := make([]*trackFile, 0, len(s.tracks))
	for _, t := range s.tracks {
		if t.Packets > 0 {
			tracks = append(tracks, t)
		} else {
			_ = os.Remove(filepath.Join(s.dir, t.File))
		}
	}
	s.mu.Unlock()
	if len(tracks) == 0 {
		log.Printf("[%s] no audio, nothing kept", s.room)
		_ = os.RemoveAll(s.dir)
		return
	}
	sort.Slice(tracks, func(i, j int) bool { return tracks[i].StartUnix < tracks[j].StartUnix })
	base := tracks[0].StartUnix
	manifest := map[string]any{"room": s.room, "joinedUnixMs": s.joined.UnixMilli(), "baseUnixMs": base, "tracks": tracks}
	if b, err := json.MarshalIndent(manifest, "", "  "); err == nil {
		_ = os.WriteFile(filepath.Join(s.dir, "manifest.json"), b, 0o664)
	}

	args := []string{"-hide_banner", "-loglevel", "error", "-y"}
	var filt []string
	var labels string
	for i, t := range tracks {
		args = append(args, "-i", filepath.Join(s.dir, t.File))
		filt = append(filt, fmt.Sprintf("[%d:a]aresample=48000,adelay=%d:all=1[a%d]", i, t.StartUnix-base, i))
		labels += fmt.Sprintf("[a%d]", i)
	}
	if len(tracks) == 1 {
		filt = append(filt, "[a0]anull[m]")
	} else {
		filt = append(filt, fmt.Sprintf("%samix=inputs=%d:normalize=0:dropout_transition=0[m]", labels, len(tracks)))
	}
	args = append(args, "-filter_complex", strings.Join(filt, ";"), "-map", "[m]", "-ac", "1", "-c:a", "libopus", "-b:a", "32k",
		filepath.Join(s.dir, "mix.ogg"))
	start := time.Now()
	cmd := exec.Command("nice", append([]string{"-n", "15", "ffmpeg"}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		log.Printf("[%s] mix failed: %v %s", s.room, err, strings.TrimSpace(string(out)))
		return
	}
	log.Printf("[%s] mixed %d tracks in %s → %s", s.room, len(tracks), time.Since(start).Round(time.Second), filepath.Join(s.dir, "mix.ogg"))
}
