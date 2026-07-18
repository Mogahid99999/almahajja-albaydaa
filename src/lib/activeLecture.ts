/**
 * The "active lecture" for the full player's lesson tools (ملاحظات · فوائد · أسئلة).
 *
 * The player screen mounts under a route param `id`, but on AUTO-ADVANCE the
 * audioController swaps the playing track IN PLACE — it drives the player store's
 * `currentLectureId` to the next lecture WITHOUT navigating, so the route `id`
 * stays pinned to whatever the user originally opened. The lesson-tools were keyed
 * off that stale route `id`, so notes/questions/benefits kept showing the PREVIOUS
 * lecture until a manual refresh.
 *
 * The playing track is therefore the source of truth for the tools. This resolver
 * picks it, falling back to the route `id` only when NOTHING is loaded yet (first
 * mount, before playback starts) — so the tools are correct in that window too.
 */
import { usePlayerStore } from '@/stores/playerStore';

/**
 * Pure resolver (unit-testable): the currently-PLAYING lecture id wins; the route
 * `id` is the fallback for the pre-playback window (nothing loaded → `playingId`
 * is null). An empty-string route id is treated as "no route id".
 */
export function resolveActiveLectureId(
  playingId: string | null | undefined,
  routeId: string | null | undefined,
): string {
  return playingId || routeId || '';
}

/**
 * The active lecture id for the full player's tools, subscribed to the store so an
 * in-place auto-advance re-drives the notes/questions/benefits queries for the new
 * lecture. Offline behaves the same: the store id changes → the tool queries read
 * their OWN (correct-key) persisted cache entry, never the previous lecture's, and
 * a never-opened lecture simply shows its calm empty state instead of stale data.
 */
export function useActiveLectureId(routeId: string | null | undefined): string {
  const playingId = usePlayerStore((s) => s.currentLectureId);
  return resolveActiveLectureId(playingId, routeId);
}
