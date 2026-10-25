/**
 * «استخدام المصحف» ping: at most once per Makkah day per device, fire-and-forget.
 * Counts unique users (guests included, via their anonymous session) — no page,
 * sura or duration is ever sent.
 */
import { onlineManager } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { makkahDay, useMushafStore } from './store';

let inFlight = false;

export function touchMushafUsage() {
  const today = makkahDay();
  const st = useMushafStore.getState();
  if (st.usageDay === today || inFlight || !onlineManager.isOnline()) return;
  inFlight = true;
  // `as never`: not in database.generated.ts until 0161 is applied + types regenerated.
  void supabase
    .rpc('touch_mushaf_open' as never)
    .then(({ error }) => {
      if (!error) useMushafStore.getState().setUsageDay(today);
    })
    .then(
      () => {
        inFlight = false;
      },
      () => {
        inFlight = false;
      },
    );
}
