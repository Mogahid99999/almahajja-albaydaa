/**
 * «المداخلات» of a live recording: who was given the word and when (offsets
 * from the start of the broadcast ≈ the recording), and how long they spoke —
 * so the editor knows what is in the file before publishing it. Real names are
 * staff-visible (D2, changed 2026-09-28), incl. a sister who chose «بدون اسم».
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import type { LiveIntervention } from '@/api/liveAdmin';
import { Rhombus, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useLiveInterventions } from '@/hooks/useLiveAdmin';
import { ADMIN_LIVE_COPY, interventionLine, interventionName, interventionsCount } from './liveAdminUi';

const COLLAPSED = 4;

export function InterventionsList({ sessionId }: { sessionId: string | null }) {
  const q = useLiveInterventions(sessionId);
  const [all, setAll] = useState(false);
  if (!sessionId) return null;

  const rows: readonly LiveIntervention[] = q.data ?? [];
  const shown = all ? rows : rows.slice(0, COLLAPSED);

  return (
    <View
      style={{
        marginTop: 14,
        padding: 12,
        borderRadius: radius.sm,
        backgroundColor: colors.bgSandRaised,
        borderWidth: 1,
        borderColor: colors.borderSand,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt size={12.5} weight="semibold" color={colors.textSlate}>
          {ADMIN_LIVE_COPY.interventions}
        </Txt>
        {rows.length ? (
          <Txt size={12} color={colors.textGhost}>
            {interventionsCount(rows.length)}
          </Txt>
        ) : null}
        {q.isLoading ? <ActivityIndicator size="small" color={colors.textGhost} /> : null}
      </View>

      {q.isError ? (
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 6 }}>
          تعذّر تحميل المداخلات
        </Txt>
      ) : !q.isLoading && rows.length === 0 ? (
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 6 }}>
          {ADMIN_LIVE_COPY.noInterventions}
        </Txt>
      ) : (
        <View style={{ marginTop: 6, gap: 6 }}>
          {shown.map((i) => (
            <View key={i.identity} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <View style={{ paddingTop: 7 }}>
                <Rhombus size={5} color={i.gender === 'f' ? colors.accentBrassMuted : colors.primaryTeal600} />
              </View>
              <Txt size={12.5} color={colors.textInk} style={{ flex: 1, lineHeight: 20 }}>
                <Txt size={12.5} weight="semibold" color={colors.textInk}>
                  {interventionName(i)}
                </Txt>
                {` — ${interventionLine(i)}`}
              </Txt>
            </View>
          ))}
          {rows.length > COLLAPSED ? (
            <Pressable onPress={() => setAll((v) => !v)} accessibilityRole="button" style={{ alignSelf: 'flex-start' }}>
              <Txt size={12} weight="semibold" color={colors.primaryTeal600}>
                {all ? 'عرض أقل' : `عرض الكل (${interventionsCount(rows.length)})`}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}
