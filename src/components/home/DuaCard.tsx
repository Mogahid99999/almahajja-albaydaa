import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { Card, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';

/**
 * «لا تنسَ الدعاء» — a plain, centred card at the bottom of Home showing ONE
 * du'a, rotating locally: each new app session shows the next one. No network,
 * no tracking — the index lives in AsyncStorage on this device.
 */
export const DUAS = [
  'اللهم انفعنا بما علّمتنا، وعلّمنا ما ينفعنا.',
  'اللهم اغفر لمشايخنا، وتقبّل منهم، واجزهم عنّا خير الجزاء.',
  'اللهم اغفر للقائمين على هذا العمل ولوالديهم، وبارك في جهودهم، ووفّقهم لما تحب وترضى.',
  'اللهم ارزقنا علماً نافعاً، وعملاً صالحاً، وإخلاصاً وقبولاً.',
] as const;

const KEY = 'dua-card-index';
/** Chosen once per JS session, so the du'a doesn't change while navigating. */
let sessionIndex: Promise<number> | null = null;

export function nextDuaIndex(prev: number | null): number {
  return prev == null || !Number.isFinite(prev) ? 0 : (prev + 1) % DUAS.length;
}

function pickSessionIndex(): Promise<number> {
  if (!sessionIndex) {
    sessionIndex = AsyncStorage.getItem(KEY)
      .then((v) => nextDuaIndex(v == null ? null : Number(v)))
      .catch(() => 0)
      .then((i) => {
        void AsyncStorage.setItem(KEY, String(i)).catch(() => {});
        return i;
      });
  }
  return sessionIndex;
}

export function DuaCard() {
  const [i, setI] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void pickSessionIndex().then((n) => alive && setI(n));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card style={{ paddingVertical: 18, paddingHorizontal: 18 }}>
      <Txt
        weight="display"
        size={16}
        color={colors.primaryTeal}
        align="center"
        accessibilityLabel={`لا تنسَ الدعاء: ${DUAS[i ?? 0]}`}
        style={{ lineHeight: 30, opacity: i == null ? 0 : 1 }}
      >
        {DUAS[i ?? 0]}
      </Txt>
    </Card>
  );
}
