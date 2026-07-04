/**
 * Admin upload lecture screen — /admin/upload
 *
 * Two-column layout (content 1fr + right rail 320px sticky).
 * Design ref: README §4 · ds-bundle/components/Admin/UploadLecture/UploadLecture.prompt.md
 *
 * Left column cards:
 *   1. المعلومات الأساسية — title input + mock audio uploaded row
 *   2. التصنيف والترتيب — TreePicker + order input + sheikh select
 *   3. المرفقات — dashed dropzone + fake attached file row
 *
 * Right rail (sticky):
 *   - PublishToggle
 *   - Dates placeholder
 *   - Submit / معاينة buttons
 *   - Tip card
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { AttachmentManager } from '@/components/admin/AttachmentManager';
import { PublishToggle } from '@/components/admin/PublishToggle';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows, spacing } from '@/constants/theme';
import { useCreateLecture, useNextLectureOrder, useSheikhs } from '@/hooks/useAdmin';
import {
  isAudioFile,
  transcodeToMp3,
  TranscodeError,
  type TranscodeResult,
} from '@/lib/audioTranscode';
import { extractAudioDuration } from '@/lib/audioDuration';
import { getDocumentAsync } from '@/lib/documentPicker';
import { arDuration, arFileSize, toArabicDigits } from '@/lib/format';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The audio file the admin picked, held until the lecture is saved. */
type PickedAudio = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size: number | null;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={styles.sectionCard}>
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.cardTitle}>
        {title}
      </Txt>
      {children}
    </Card>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
      {children}
    </Txt>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function UploadScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const narrow = width < 900;
  // Client-side MP3 compression (ffmpeg.wasm) is web-only. On a phone the admin
  // uploads the picked file as-is — no transcode, no submit-block (Issue 6).
  const isWeb = Platform.OS === 'web';

  const { data: sheikhs = [] } = useSheikhs();
  const createLecture = useCreateLecture();

  // Form state
  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [order, setOrder] = useState('');
  const [sheikhId, setSheikhId] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<'draft' | 'published'>('draft');
  const [titleFocused, setTitleFocused] = useState(false);
  const [orderFocused, setOrderFocused] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [audioFile, setAudioFile] = useState<PickedAudio | null>(null);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  // Every picked file is compressed to a speech MP3 in the browser before upload
  // (only the compressed result is ever stored). This tracks that conversion.
  const [convert, setConvert] = useState<{
    state: 'idle' | 'converting' | 'done' | 'error';
    progress: number;
    result: TranscodeResult | null;
    error: string | null;
  }>({ state: 'idle', progress: 0, result: null, error: null });
  // Monotonic job id so a re-pick / removal supersedes an in-flight conversion.
  const jobRef = useRef(0);
  // Set once the lecture is saved — attachments hang off the created lecture id.
  const [createdLectureId, setCreatedLectureId] = useState<string | null>(null);

  // Sheikh picker open
  const [sheikhOpen, setSheikhOpen] = useState(false);

  const selectedSheikh = sheikhId ? sheikhs.find((s) => s.id === sheikhId) ?? null : null;

  // Auto-fill رقم الترتيب with the next order (max in the section + 1) once per
  // section selection, so lessons append in sequence instead of everyone landing
  // at 0. The admin can still edit it; re-selecting the same section won't clobber
  // a manual change (the ref guards a single auto-fill per section).
  const { data: nextOrder } = useNextLectureOrder(sectionId);
  const autoOrderSectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sectionId || nextOrder == null) return;
    if (autoOrderSectionRef.current !== sectionId) {
      autoOrderSectionRef.current = sectionId;
      setOrder(String(nextOrder));
    }
  }, [sectionId, nextOrder]);

  const converting = convert.state === 'converting';
  const busy = createLecture.isPending || converting;
  // Web only: a picked file must finish compressing before it can be saved. On
  // native there's no compression step, so nothing blocks submit but the upload
  // itself (createLecture.isPending) — see Issue 6.
  const audioBlocksSubmit = isWeb && audioFile != null && convert.state !== 'done';

  const submitLabel = createLecture.isPending
    ? 'جارٍ الرفع...'
    : converting
      ? 'جارٍ ضغط الصوت...'
      : !sectionId
        ? 'حفظ في الواردة'
        : publishStatus === 'published'
          ? 'نشر المحاضرة'
          : 'حفظ كمسودة';

  /** Kick off the in-browser MP3 compression; supersedes any earlier job. */
  function startConversion(picked: PickedAudio) {
    const job = ++jobRef.current;
    setConvert((prev) => {
      if (prev.result) URL.revokeObjectURL(prev.result.uri);
      return { state: 'converting', progress: 0, result: null, error: null };
    });
    transcodeToMp3(
      { uri: picked.uri, name: picked.name },
      {
        onProgress: (r) =>
          setConvert((p) =>
            jobRef.current === job && p.state === 'converting' ? { ...p, progress: r } : p,
          ),
      },
    ).then(
      (result) => {
        if (jobRef.current !== job) {
          URL.revokeObjectURL(result.uri); // superseded — drop the orphan
          return;
        }
        setConvert({ state: 'done', progress: 1, result, error: null });
        // mp3 output is always decodable — fill duration if the original didn't.
        void extractAudioDuration(result.uri).then((d) => {
          if (d != null) setAudioDuration((cur) => cur ?? d);
        });
      },
      (err) => {
        if (jobRef.current !== job) return;
        const msg =
          err instanceof TranscodeError
            ? err.message
            : 'تعذّر ضغط الملف الصوتي. حاول مرة أخرى.';
        setConvert({ state: 'error', progress: 0, result: null, error: msg });
      },
    );
  }

  async function handlePickAudio() {
    // getDocumentAsync is platform-resolved (src/lib/documentPicker): a static
    // import on web (no fragile async chunk) and a lazy require on native (so the
    // student app never resolves the native module at startup).
    const res = await getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    // Audio MIME validation — reject anything that isn't a sound file.
    if (!isAudioFile(asset.mimeType, asset.name)) {
      setAudioFile(null);
      setAudioDuration(null);
      jobRef.current++;
      setConvert({
        state: 'error',
        progress: 0,
        result: null,
        error: 'الملف المختار ليس ملفًا صوتيًا. اختر ملف صوت صالح.',
      });
      return;
    }
    const picked: PickedAudio = {
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size ?? null,
    };
    setAudioFile(picked);
    setAudioDuration(null);
    // Pull the duration from metadata so duration_sec is set on insert.
    void extractAudioDuration(asset.uri).then(setAudioDuration);
    // Compress in the background while the admin fills the rest of the form —
    // web only; on native the original file is uploaded as-is (Issue 6).
    if (isWeb) startConversion(picked);
  }

  /** Remove the picked audio and cancel any in-flight conversion. */
  function handleRemoveAudio() {
    jobRef.current++;
    setConvert((prev) => {
      if (prev.result) URL.revokeObjectURL(prev.result.uri);
      return { state: 'idle', progress: 0, result: null, error: null };
    });
    setAudioFile(null);
    setAudioDuration(null);
  }

  function handleSubmit() {
    if (!title.trim()) return;
    // Never upload an unconverted file: if audio was picked it must have finished
    // compressing (the row + disabled button communicate the converting/error state).
    if (audioBlocksSubmit) return;
    // Web: the compressed MP3 is the only thing that goes to storage (the
    // original is never uploaded). Native: no compression — upload the picked
    // file as-is (Issue 6).
    const uploadAudio: PickedAudio | null = isWeb
      ? convert.result
        ? {
            uri: convert.result.uri,
            name: convert.result.name,
            mimeType: convert.result.mimeType,
            size: convert.result.size,
          }
        : null
      : audioFile
        ? {
            uri: audioFile.uri,
            name: audioFile.name,
            mimeType: audioFile.mimeType,
            size: audioFile.size,
          }
        : null;
    // Without a section the lecture can't be shown to students even if
    // "published" — so it lands in the واردة (unclassified) review queue
    // instead, where it can be classified later. (Fixes the "lost upload" bug.)
    const effectiveStatus = sectionId ? publishStatus : 'unclassified';
    createLecture.mutate(
      {
        title: title.trim(),
        sectionId,
        sheikhId,
        order: order ? Number(order) : 0,
        durationSec: audioDuration,
        status: effectiveStatus,
        audioFile: uploadAudio,
      },
      {
        onSuccess: (created) => {
          setSuccessMsg(
            effectiveStatus === 'published'
              ? 'تم نشر المحاضرة بنجاح وستظهر للطلاب.'
              : effectiveStatus === 'unclassified'
                ? 'تم حفظ المحاضرة في قائمة الواردة (بدون قسم). صنّفها لاحقاً لنشرها.'
                : 'تم حفظ المحاضرة كمسودة. انشرها من شاشة المحاضرات.',
          );
          setCreatedLectureId(created.id);
          setTitle('');
          setSectionId(null);
          setOrder('');
          // Allow the next section pick to auto-fill الترتيب again.
          autoOrderSectionRef.current = null;
          setSheikhId(null);
          setPublishStatus('draft');
          setAudioFile(null);
          setAudioDuration(null);
          jobRef.current++;
          setConvert((prev) => {
            if (prev.result) URL.revokeObjectURL(prev.result.uri);
            return { state: 'idle', progress: 0, result: null, error: null };
          });
        },
      },
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  const content = (
    <View style={[styles.grid, narrow && styles.gridNarrow]}>
      {/* ── Left column ── */}
      <View style={styles.leftCol}>
        {/* Success banner */}
        {successMsg ? (
          <View style={styles.successBanner}>
            <Feather name="check-circle" size={16} color={colors.stateSuccess} />
            <Txt size={13} color={colors.stateSuccess} style={{ marginRight: 8, flex: 1 }}>
              {successMsg}
            </Txt>
            <Pressable onPress={() => setSuccessMsg('')}>
              <Feather name="x" size={14} color={colors.stateSuccess} />
            </Pressable>
          </View>
        ) : null}

        {/* Card 1: Basic info */}
        <CardSection title="المعلومات الأساسية">
          <FieldLabel>عنوان المحاضرة</FieldLabel>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="أدخل عنوان المحاضرة..."
            placeholderTextColor={colors.textGhost}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            textAlign="right"
            style={[styles.titleInput, titleFocused && styles.titleInputFocused]}
          />

          {/* Audio file picker / picked row */}
          <FieldLabel>ملف الصوت</FieldLabel>
          {audioFile ? (
            <View style={styles.audioRow}>
              {/* Waveform tile */}
              <View style={[styles.waveformTile, converting && { opacity: 0.6 }]}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: 8 + Math.sin(i * 0.8) * 6,
                        opacity: i < 7 ? 1 : 0.35,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt size={13} weight="semibold" color={colors.textInk} numberOfLines={1}>
                  {audioFile.name}
                </Txt>

                {convert.state === 'converting' ? (
                  <>
                    <Txt size={11} color={colors.textMuted} style={{ marginTop: 3 }} tabular>
                      {[
                        audioFile.size != null ? arFileSize(audioFile.size) : null,
                        `جارٍ الضغط… ${toArabicDigits(Math.round(convert.progress * 100))}٪`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Txt>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.max(4, Math.round(convert.progress * 100))}%` },
                        ]}
                      />
                    </View>
                  </>
                ) : convert.state === 'error' ? (
                  <>
                    <Txt size={11} color={colors.stateDanger} style={{ marginTop: 3 }}>
                      {convert.error ?? 'تعذّر ضغط الملف.'}
                    </Txt>
                    <Pressable
                      onPress={() => startConversion(audioFile)}
                      style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
                      accessibilityRole="button"
                    >
                      <Feather name="refresh-cw" size={12} color={colors.primaryTeal} />
                      <Txt size={11} weight="semibold" color={colors.primaryTeal} style={{ marginRight: 6 }}>
                        إعادة المحاولة
                      </Txt>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Txt size={11} color={colors.textMuted} style={{ marginTop: 3 }} tabular>
                      {[
                        (convert.result ? convert.result.size : audioFile.size) != null
                          ? arFileSize((convert.result ? convert.result.size : audioFile.size)!)
                          : null,
                        audioDuration ? arDuration(audioDuration) : null,
                        isWeb ? 'جاهز للرفع · MP3' : 'جاهز للرفع',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Txt>
                    {convert.result &&
                    audioFile.size != null &&
                    audioFile.size > convert.result.size ? (
                      <Txt size={11} color={colors.stateSuccess} style={{ marginTop: 2 }} tabular>
                        {`تم الضغط من ${arFileSize(audioFile.size)}`}
                      </Txt>
                    ) : null}
                  </>
                )}
              </View>
              <Pressable
                style={styles.removeBtn}
                accessibilityLabel="إزالة الملف"
                onPress={handleRemoveAudio}
              >
                <Feather name="x" size={15} color={colors.stateDanger} />
              </Pressable>
            </View>
          ) : (
            <>
              {convert.state === 'error' && convert.error ? (
                <View style={styles.audioErrorBanner}>
                  <Feather name="alert-triangle" size={14} color={colors.stateDanger} />
                  <Txt size={12} color={colors.stateDanger} style={{ flex: 1, marginRight: 8 }}>
                    {convert.error}
                  </Txt>
                </View>
              ) : null}
              <Pressable
                onPress={handlePickAudio}
                style={({ pressed }) => [styles.audioPicker, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <Feather name="upload-cloud" size={24} color={colors.primaryTeal} />
                <Txt size={13} weight="semibold" color={colors.primaryTeal} style={{ marginTop: 8 }}>
                  اختر ملف الصوت
                </Txt>
                <Txt size={11} color={colors.textGhost} style={{ marginTop: 3 }}>
                  {isWeb
                    ? 'أي صيغة صوتية — يُضغط الملف تلقائيًا إلى MP3 خفيف للكلام'
                    : 'أي صيغة صوتية — تُرفع كما هي'}
                </Txt>
              </Pressable>
            </>
          )}
        </CardSection>

        {/* Card 2: Classification */}
        <CardSection title="التصنيف والترتيب">
          <FieldLabel>القسم / العنصر الأب</FieldLabel>
          <TreePicker value={sectionId} onChange={setSectionId} allowNull label="اختر القسم الأب" />

          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <FieldLabel>رقم الترتيب</FieldLabel>
              <TextInput
                value={order}
                onChangeText={(t) => setOrder(t.replace(/[^0-9]/g, ''))}
                placeholder={toArabicDigits('1')}
                placeholderTextColor={colors.textGhost}
                keyboardType="numeric"
                onFocus={() => setOrderFocused(true)}
                onBlur={() => setOrderFocused(false)}
                textAlign="center"
                style={[styles.orderInput, orderFocused && styles.inputFocused]}
              />
            </View>
            <View style={{ flex: 2 }}>
              <FieldLabel>اسم الشيخ</FieldLabel>
              <Pressable
                onPress={() => setSheikhOpen((v) => !v)}
                style={[styles.sheikhField, sheikhOpen && styles.inputFocused]}
                accessibilityRole="button"
              >
                <Feather
                  name={sheikhOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
                <Txt size={14} color={selectedSheikh ? colors.textInk : colors.textGhost} style={{ flex: 1 }}>
                  {selectedSheikh?.name ?? 'اختر الشيخ...'}
                </Txt>
              </Pressable>
              {sheikhOpen && (
                <View style={styles.sheikhDropdown}>
                  {sheikhs.map((s, idx) => (
                    <React.Fragment key={s.id}>
                      <Pressable
                        onPress={() => { setSheikhId(s.id); setSheikhOpen(false); }}
                        style={({ pressed }) => [
                          styles.sheikhRow,
                          s.id === sheikhId && styles.sheikhRowSelected,
                          pressed && { backgroundColor: colors.bgSand },
                        ]}
                      >
                        <Txt size={13} color={s.id === sheikhId ? colors.primaryTeal : colors.textInk}>
                          {s.name}
                        </Txt>
                        {s.id === sheikhId && (
                          <Feather name="check" size={14} color={colors.primaryTeal} style={{ marginLeft: 8 }} />
                        )}
                      </Pressable>
                      {idx < sheikhs.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                  {sheikhs.length === 0 && (
                    <View style={{ padding: 14 }}>
                      <Txt size={13} color={colors.textGhost} align="center">
                        لا يوجد مشايخ مضافون بعد.
                      </Txt>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        </CardSection>

        {/* Card 3: Attachments — bound to the lecture once it's saved. */}
        <CardSection title="المرفقات">
          {createdLectureId ? (
            <>
              <View style={styles.attachSavedHint}>
                <Feather
                  name="check-circle"
                  size={15}
                  color={colors.stateSuccess}
                  style={{ marginLeft: 8 }}
                />
                <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
                  أضف مرفقات إلى المحاضرة التي تم حفظها.
                </Txt>
              </View>
              <AttachmentManager owner={{ kind: 'lecture', id: createdLectureId }} />
            </>
          ) : (
            <View style={styles.attachPlaceholder}>
              <Feather name="paperclip" size={26} color={colors.accentBrassMuted} />
              <Txt
                size={13}
                weight="semibold"
                color={colors.textMuted}
                align="center"
                style={{ marginTop: 10 }}
              >
                احفظ المحاضرة أولاً لإضافة المرفقات
              </Txt>
              <Txt size={11} color={colors.textGhost} align="center" style={{ marginTop: 4 }}>
                بعد الحفظ يمكنك إرفاق ملفات PDF أو كتب أو روابط أو تفريغ.
              </Txt>
            </View>
          )}
        </CardSection>
      </View>

      {/* ── Right rail ── */}
      <View style={[styles.rightRail, narrow && styles.rightRailNarrow, !narrow && styles.rightRailSticky]}>
        {/* Publish status card */}
        <Card style={styles.railCard}>
          <Txt weight="semibold" size={14} color={colors.textInk} style={styles.cardTitle}>
            حالة النشر
          </Txt>
          <PublishToggle value={publishStatus} onChange={setPublishStatus} />

          {!sectionId ? (
            <View style={styles.noSectionNote}>
              <Feather name="inbox" size={14} color={colors.accentBrassMuted} style={{ marginLeft: 8 }} />
              <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
                لم تختر قسماً — ستُحفظ المحاضرة في «الواردة» ولن تظهر للطلاب حتى تُصنَّف وتُنشر.
              </Txt>
            </View>
          ) : null}

          <View style={styles.metaDivider} />

          <View style={styles.metaRow}>
            <Txt size={12} color={colors.textGhost}>—</Txt>
            <Txt size={12} color={colors.textMuted}>تاريخ الإنشاء</Txt>
          </View>
          <View style={styles.metaRow}>
            <Txt size={12} color={colors.textGhost}>—</Txt>
            <Txt size={12} color={colors.textMuted}>آخر تعديل</Txt>
          </View>

          <View style={styles.metaDivider} />

          {/* Submit button */}
          <Pressable
            onPress={handleSubmit}
            disabled={busy || !title.trim() || audioBlocksSubmit}
            style={({ pressed }) => [
              styles.submitBtn,
              { opacity: pressed || !title.trim() || busy || audioBlocksSubmit ? 0.6 : 1 },
              sectionId && publishStatus === 'published' && styles.submitBtnPublished,
            ]}
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              {submitLabel}
            </Txt>
          </Pressable>

          {/* Preview outline button */}
          <Pressable
            style={({ pressed }) => [styles.previewBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <Txt weight="semibold" size={14} color={colors.primaryTeal}>
              معاينة
            </Txt>
          </Pressable>
        </Card>

        {/* Tip card */}
        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Rhombus size={8} color={colors.accentBrassMuted} />
            <Txt weight="semibold" size={13} color={colors.accentBrassMuted} style={{ marginRight: 8 }}>
              تلميح
            </Txt>
          </View>
          <Txt size={12} color={colors.textMuted} style={{ marginTop: 6, lineHeight: 20 }}>
            تأكد من أن رقم الترتيب يتوافق مع تسلسل الدرس داخل القسم لضمان ظهور المحاضرات بالترتيب الصحيح للطلاب.
          </Txt>
        </View>
      </View>
    </View>
  );

  return (
    <AdminShell active="upload" breadcrumb="المحاضرات / رفع محاضرة جديدة">
      {/* Page heading + top actions */}
      <View style={styles.pageHeader}>
        <View style={styles.topActions}>
          <Pressable
            onPress={handleSubmit}
            disabled={busy || !title.trim() || audioBlocksSubmit}
            style={({ pressed }) => [
              styles.topSaveBtn,
              { opacity: pressed || !title.trim() || busy || audioBlocksSubmit ? 0.6 : 1 },
            ]}
          >
            <Txt weight="semibold" size={13} color={colors.onTealPrimary}>
              {createLecture.isPending
                ? 'جارٍ الرفع...'
                : converting
                  ? 'جارٍ ضغط الصوت...'
                  : 'حفظ المحاضرة'}
            </Txt>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
          >
            <Txt weight="semibold" size={13} color={colors.textMuted}>
              إلغاء
            </Txt>
          </Pressable>
        </View>
        <View>
          <Txt weight="display" size={27} color={colors.primaryTeal}>
            رفع محاضرة جديدة
          </Txt>
          <Txt size={13} color={colors.textMuted} style={{ marginTop: 4 }}>
            أضف محاضرة وصنّفها في شجرة الأقسام
          </Txt>
        </View>
      </View>

      {content}
    </AdminShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  } as ViewStyle,

  topActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  } as ViewStyle,

  topSaveBtn: {
    backgroundColor: colors.primaryTeal,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.sm,
    ...shadows.button,
  } as ViewStyle,

  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
  } as ViewStyle,

  grid: {
    flexDirection: 'row',
    gap: 20,
    alignItems: 'flex-start',
  } as ViewStyle,

  gridNarrow: {
    flexDirection: 'column',
  } as ViewStyle,

  leftCol: {
    flex: 1,
    gap: 20,
  } as ViewStyle,

  rightRail: {
    width: 320,
    gap: 16,
  } as ViewStyle,

  rightRailNarrow: {
    width: '100%',
  } as ViewStyle,

  rightRailSticky: {
    // Web sticky approximation
    position: 'sticky' as any,
    top: 30,
  } as ViewStyle,

  sectionCard: {
    gap: 0,
  } as ViewStyle,

  cardTitle: {
    marginBottom: 16,
  } as ViewStyle,

  fieldLabel: {
    marginBottom: 7,
    marginTop: 14,
  } as ViewStyle,

  titleInput: {
    height: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  },

  titleInputFocused: {
    borderColor: colors.primaryTeal600,
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },

  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.borderHair,
  } as ViewStyle,

  audioPicker: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primaryTeal,
    borderRadius: radius.card,
    backgroundColor: 'rgba(31,74,66,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 26,
    paddingHorizontal: 20,
  } as ViewStyle,

  waveformTile: {
    width: 52,
    height: 36,
    backgroundColor: colors.primaryTeal,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 6,
  } as ViewStyle,

  waveBar: {
    width: 2.5,
    backgroundColor: colors.accentBrass,
    borderRadius: 2,
  } as ViewStyle,

  removeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  } as ViewStyle,

  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderSand2,
    marginTop: 6,
    overflow: 'hidden',
  } as ViewStyle,

  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primaryTeal,
  } as ViewStyle,

  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 5,
  } as ViewStyle,

  audioErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(193,58,58,0.08)',
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: 10,
  } as ViewStyle,

  twoCol: {
    flexDirection: 'row',
    gap: 12,
  } as ViewStyle,

  orderInput: {
    height: 46,
    width: 140,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textInk,
    textAlign: 'center',
  },

  inputFocused: {
    borderColor: colors.primaryTeal600,
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },

  sheikhField: {
    height: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  sheikhDropdown: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderSand,
    overflow: 'hidden',
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  } as ViewStyle,

  sheikhRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
  } as ViewStyle,

  sheikhRowSelected: {
    backgroundColor: 'rgba(31,74,66,0.05)',
  } as ViewStyle,

  attachPlaceholder: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentBrassSoft,
    borderRadius: radius.card,
    backgroundColor: 'rgba(176,137,79,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  } as ViewStyle,

  attachSavedHint: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31,138,91,0.09)',
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: 14,
  } as ViewStyle,

  noSectionNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(176,137,79,0.1)',
    borderRadius: radius.sm,
    padding: 10,
    marginTop: 12,
  } as ViewStyle,

  // ── Right rail ──
  railCard: {
    gap: 0,
  } as ViewStyle,

  metaDivider: {
    height: 1,
    backgroundColor: colors.borderHair,
    marginVertical: 14,
  } as ViewStyle,

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  } as ViewStyle,

  submitBtn: {
    backgroundColor: colors.primaryTeal,
    height: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    ...shadows.button,
  } as ViewStyle,

  submitBtnPublished: {
    backgroundColor: colors.stateSuccess,
  } as ViewStyle,

  previewBtn: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  tipCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentBrassSoft,
    borderRadius: radius.card,
    backgroundColor: 'rgba(176,137,79,0.04)',
    padding: 16,
  } as ViewStyle,

  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  } as ViewStyle,

  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31,138,91,0.09)',
    borderRadius: radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(31,138,91,0.2)',
  } as ViewStyle,
});
