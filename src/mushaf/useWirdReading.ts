/**
 * Counts the page on screen toward today's wird once it has really been in
 * front of the reader: the reader screen shows it, the app is in the
 * foreground, and it has stayed there for {@link dwellMsFor} (time on the same
 * page adds up across visits within this reading session). A quick flip, a
 * jump from search / a bookmark, or the app sitting in the background counts
 * nothing; returning to a page already counted today changes nothing.
 *
 * The page is the printed page number, whatever the mode or font size.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { dwellMsFor, useWirdStore } from './wird';

export function useWirdReading(page: number, enabled: boolean, onComplete: () => void) {
  const goal = useWirdStore((s) => s.goal);
  const credit = useWirdStore((s) => s.credit);
  const seen = useRef(new Map<number, number>());
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!enabled || goal == null) return;
    let since: number | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pause = () => {
      if (since == null) return;
      seen.current.set(page, (seen.current.get(page) ?? 0) + Date.now() - since);
      since = null;
      clearTimeout(timer);
    };
    const fire = () => {
      pause();
      if (credit(page)) onCompleteRef.current();
    };
    const start = () => {
      if (since != null) return;
      since = Date.now();
      timer = setTimeout(fire, Math.max(0, dwellMsFor(page) - (seen.current.get(page) ?? 0)));
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? start() : pause()));
    return () => {
      pause();
      sub.remove();
    };
  }, [page, enabled, goal, credit]);
}
