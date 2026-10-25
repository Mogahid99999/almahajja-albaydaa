/**
 * Reactions in the live room «التفاعل» (owner 2026-10-05): a tap sends a small
 * sign (👍 ❤️ 🤲 …) that floats up over the halaqa for everyone, like Google
 * Meet. They travel ONLY on the LiveKit data channel (topic "reactions",
 * lossy) — never through the database. Pure helpers here; the room sends and
 * receives them in liveClient/liveStore and draws them in ReactionsOverlay.
 *
 * Abuse limits, all client-side and cheap:
 *  - a sender sends at most one reaction per REACTION_SEND_MIN_MS;
 *  - a receiver ignores a sender faster than REACTION_RECEIVE_MIN_MS (a
 *    modified client can't flood other screens) and draws at most MAX_FLYING
 *    at once;
 *  - only the fixed keys below are accepted — never free text;
 *  - a moderator can stop one person entirely (live-control `react_block`:
 *    LiveKit drops their data permission).
 */
export const REACTIONS_TOPIC = 'reactions';

export const REACTIONS = [
  { key: 'like', emoji: '👍', label: 'أعجبني' },
  { key: 'love', emoji: '❤️', label: 'أحببته' },
  { key: 'dua', emoji: '🤲', label: 'دعاء' },
  { key: 'laugh', emoji: '😂', label: 'ضحك' },
  { key: 'wow', emoji: '😮', label: 'تعجّب' },
  { key: 'rose', emoji: '🌹', label: 'جزاكم الله خيراً' },
] as const;

export type ReactionKey = (typeof REACTIONS)[number]['key'];

const KEYS: ReadonlySet<string> = new Set(REACTIONS.map((r) => r.key));
const EMOJI: Readonly<Record<string, string>> = Object.fromEntries(REACTIONS.map((r) => [r.key, r.emoji]));

export const REACTION_SEND_MIN_MS = 1_200;
export const REACTION_RECEIVE_MIN_MS = 700;
export const MAX_FLYING = 12;
/** How long one reaction floats before it fades out. */
export const REACTION_FLIGHT_MS = 2_600;

export function isReactionKey(x: unknown): x is ReactionKey {
  return typeof x === 'string' && KEYS.has(x);
}

export function reactionEmoji(key: ReactionKey): string {
  return EMOJI[key] ?? '👍';
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Wire format: `{"e":"<key>"}` (UTF-8 JSON). */
export function encodeReaction(key: ReactionKey): Uint8Array {
  return encoder.encode(JSON.stringify({ e: key }));
}

/** A data payload → its key, or null for anything that isn't exactly one known reaction. */
export function parseReaction(payload: Uint8Array): ReactionKey | null {
  if (!payload || payload.byteLength > 64) return null;
  try {
    const v = JSON.parse(decoder.decode(payload)) as { e?: unknown };
    return isReactionKey(v?.e) ? v.e : null;
  } catch {
    return null;
  }
}

/**
 * Receiver-side spam guard: accept a sender's reaction only if their previous
 * accepted one is at least REACTION_RECEIVE_MIN_MS old. Mutates `last`.
 */
export function acceptReaction(last: Map<string, number>, sender: string, nowMs: number): boolean {
  const prev = last.get(sender);
  if (prev !== undefined && nowMs - prev < REACTION_RECEIVE_MIN_MS) return false;
  last.set(sender, nowMs);
  if (last.size > 2_000) {
    // A long session with many people: forget the oldest half (insertion order).
    let drop = Math.floor(last.size / 2);
    for (const k of last.keys()) {
      if (drop-- <= 0) break;
      last.delete(k);
    }
  }
  return true;
}

/** Sender-side cooldown: may I send now? */
export function canSendReaction(lastSentMs: number | null, nowMs: number): boolean {
  return lastSentMs === null || nowMs - lastSentMs >= REACTION_SEND_MIN_MS || nowMs < lastSentMs;
}
