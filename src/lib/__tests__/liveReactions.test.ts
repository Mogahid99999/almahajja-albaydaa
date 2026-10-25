/**
 * «التفاعل» (0157) — reactions ride the LiveKit data channel only. Pins: the
 * fixed vocabulary (never free text), the wire format, and the two cheap
 * anti-spam guards (sender cooldown, per-sender receive floor).
 */
import {
  acceptReaction,
  canSendReaction,
  encodeReaction,
  isReactionKey,
  parseReaction,
  REACTION_RECEIVE_MIN_MS,
  REACTION_SEND_MIN_MS,
  REACTIONS,
  reactionEmoji,
} from '../liveReactions';

test('six calm signs, each with an Arabic label', () => {
  expect(REACTIONS.map((r) => r.emoji)).toEqual(['👍', '❤️', '🤲', '😂', '😮', '🌹']);
  for (const r of REACTIONS) expect(/[؀-ۿ]/.test(r.label)).toBe(true);
  expect(reactionEmoji('dua')).toBe('🤲');
});

test('round-trips on the wire; anything else is dropped (no free text, no oversize)', () => {
  expect(parseReaction(encodeReaction('love'))).toBe('love');
  const enc = (s: string) => new TextEncoder().encode(s);
  expect(parseReaction(enc('{"e":"hello"}'))).toBeNull();
  expect(parseReaction(enc('{"e":"like","x":"' + 'a'.repeat(80) + '"}'))).toBeNull();
  expect(parseReaction(enc('not json'))).toBeNull();
  expect(parseReaction(enc('{}'))).toBeNull();
  expect(isReactionKey('like')).toBe(true);
  expect(isReactionKey('<script>')).toBe(false);
});

test('sender cooldown: one reaction per 1.2 s', () => {
  expect(canSendReaction(null, 1000)).toBe(true);
  expect(canSendReaction(1000, 1000 + REACTION_SEND_MIN_MS - 1)).toBe(false);
  expect(canSendReaction(1000, 1000 + REACTION_SEND_MIN_MS)).toBe(true);
  expect(canSendReaction(5000, 1000)).toBe(true); // a clock that went back never locks it
});

test('receiver floor: a flooding sender is thinned per identity, others are unaffected', () => {
  const last = new Map<string, number>();
  expect(acceptReaction(last, 'a', 0)).toBe(true);
  expect(acceptReaction(last, 'a', REACTION_RECEIVE_MIN_MS - 1)).toBe(false);
  expect(acceptReaction(last, 'b', 10)).toBe(true);
  expect(acceptReaction(last, 'a', REACTION_RECEIVE_MIN_MS)).toBe(true);
});

test('the per-sender memory stays bounded in a long session', () => {
  const last = new Map<string, number>();
  for (let i = 0; i < 2_500; i++) acceptReaction(last, `id${i}`, i);
  expect(last.size).toBeLessThanOrEqual(2_000);
});
