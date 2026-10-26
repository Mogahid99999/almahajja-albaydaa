/**
 * Today's wird progress for the UI. Follows the device-local day while the app
 * stays open (a timer at the next midnight) and on return to the foreground,
 * so yesterday's count never lingers on screen.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { localDay } from '@/lib/outboxQueue';

import { useWirdStore, wirdProgress, type WirdProgress } from './wird';

function msToNextDay(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return next.getTime() - now.getTime();
}

export function useWirdToday(): WirdProgress & { configured: boolean } {
  const [today, setToday] = useState(localDay);
  const goal = useWirdStore((s) => s.goal);
  const configured = useWirdStore((s) => s.configured);
  const day = useWirdStore((s) => s.day);
  const pages = useWirdStore((s) => s.pages);
  const doneDay = useWirdStore((s) => s.doneDay);

  useEffect(() => {
    const t = setTimeout(() => setToday(localDay()), msToNextDay());
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setToday(localDay());
    });
    return () => {
      clearTimeout(t);
      sub.remove();
    };
  }, [today]);

  return { ...wirdProgress({ goal, configured, day, pages, doneDay }, today), configured };
}
