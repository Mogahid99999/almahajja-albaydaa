import { usePlayerStore } from '@/stores/playerStore';

/**
 * Bottom clearance (px) for the globally-mounted MiniPlayer — 118 while a lecture
 * is loaded (the bar is showing), 0 otherwise. Returns a plain number so the
 * selector reference is stable and screens don't re-render on every playback tick.
 *
 * Screens that scroll their OWN list (`Screen scroll={false}` + an inner
 * FlatList/ScrollView) must add this to the list's `contentContainerStyle`
 * paddingBottom — NOT to `Screen bottomPad`, which would reserve a dead band
 * outside the scroll area and clip the footer.
 */
export function useMiniPlayerPad(): number {
  return usePlayerStore((s) => (s.currentLectureId ? 118 : 0));
}
