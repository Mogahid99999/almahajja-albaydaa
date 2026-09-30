/**
 * «ابدأ مجلساً مباشراً» on the staff «البث المباشر» screen (D7, owner
 * 2026-09-29): staff can't reach the student section page (AuthGate sends
 * admins/publishers to /admin and sheikhs to /sheikh), so the section is
 * picked here (SectionPicker — a bottom sheet, owner 2026-09-29) →
 * CreateLiveSheet (title + «متى يبدأ المجلس؟» + notify + requests) → «الآن»:
 * the host's green room; «في موعد لاحق»: the sheet closes and a calm line
 * confirms «جُدول المجلس: …» (the session then shows under «قيد التجهيز
 * والمجدولة», where its host gets «فتح غرفة التجهيز»). Hosting from the
 * browser is LATER: on web the card only says «يبدأ البث من تطبيق الهاتف».
 *
 * D3 (one live at a time) is the RPC's call — its Arabic message shows in the
 * sheet; while a session is already green/live the card says so up front.
 */
import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Platform, View } from 'react-native';

import { scheduledConfirmLine } from '@/components/live/liveSchedule';
import { CreateLiveSheet } from '@/components/live/sheets/CreateLiveSheet';
import { Card, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useSectionsFlat } from '@/hooks/useSections';
import { ADMIN_LIVE_COPY } from './liveAdminUi';
import { ActionButton } from './parts';
import { SectionPicker } from './SectionPickerSheet';

export function StartLiveCard({
  canStart,
  activeTitle,
  onCreated,
  onScheduled,
}: {
  /** create_live_session: content manager or sheikh. */
  canStart: boolean;
  /** Title of the session already holding the one green/live slot (D3), if any. */
  activeTitle: string | null;
  onCreated: (sessionId: string) => void;
  /** A session was scheduled for later — refresh the lists. */
  onScheduled?: (sessionId: string, scheduledAt: string) => void;
}) {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scheduledLine, setScheduledLine] = useState<string | null>(null);
  const { data: sections = [] } = useSectionsFlat();
  const sectionTitle = useMemo(
    () => (sectionId ? (sections.find((s) => s.id === sectionId)?.title ?? '') : ''),
    [sectionId, sections],
  );

  if (!canStart) return null;

  if (Platform.OS === 'web') {
    return (
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.surfaceInset,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="smartphone" size={20} color={colors.primaryTeal600} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt weight="semibold" size={14.5} color={colors.textInk}>
            {ADMIN_LIVE_COPY.webStart}
          </Txt>
          <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 3, lineHeight: 20 }}>
            {ADMIN_LIVE_COPY.webStartSub}
          </Txt>
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <Txt weight="semibold" size={15.5} color={colors.textInk}>
        {ADMIN_LIVE_COPY.startTitle}
      </Txt>
      <Txt size={12.5} color={colors.textMuted} style={{ marginTop: 4, marginBottom: 12, lineHeight: 20 }}>
        {ADMIN_LIVE_COPY.startSub}
      </Txt>

      <SectionPicker
        value={sectionId}
        onChange={(id) => {
          setScheduledLine(null);
          setSectionId(id);
        }}
        placeholder={ADMIN_LIVE_COPY.pickSection}
      />

      {activeTitle ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 12,
            padding: 10,
            borderRadius: radius.sm,
            backgroundColor: 'rgba(176,137,79,0.10)',
          }}
        >
          <Feather name="info" size={14} color={colors.accentBrassMuted} />
          <Txt size={12.5} color={colors.textSlate} style={{ flex: 1, lineHeight: 20 }}>
            {`${ADMIN_LIVE_COPY.activeBlocks}: «${activeTitle}»`}
          </Txt>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', marginTop: 14 }}>
        <ActionButton
          label={ADMIN_LIVE_COPY.startCta}
          icon="radio"
          tone="primary"
          disabled={!sectionId}
          onPress={() => {
            setScheduledLine(null);
            setSheetOpen(true);
          }}
        />
      </View>

      {scheduledLine ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 8,
            marginTop: 12,
            padding: 10,
            borderRadius: radius.sm,
            backgroundColor: 'rgba(31,74,66,0.06)',
          }}
        >
          <Feather name="calendar" size={14} color={colors.primaryTeal600} style={{ marginTop: 3 }} />
          <Txt size={12.5} color={colors.primaryTeal} style={{ flex: 1, lineHeight: 20 }}>
            {scheduledLine}
          </Txt>
        </View>
      ) : null}

      {sectionId ? (
        <CreateLiveSheet
          visible={sheetOpen}
          onClose={() => setSheetOpen(false)}
          sectionId={sectionId}
          initialTitle={sectionTitle}
          onCreated={(id) => {
            setSheetOpen(false);
            setSectionId(null);
            onCreated(id);
          }}
          onScheduled={(id, at) => {
            // No green room for a later session: close, confirm, refresh.
            setSheetOpen(false);
            setSectionId(null);
            setScheduledLine(scheduledConfirmLine(at, Date.now()));
            onScheduled?.(id, at);
          }}
        />
      ) : null}
    </Card>
  );
}
