/**
 * A live recording waiting in «المحاضرات الواردة» (PLAN_LIVE_V23 §8).
 *
 * The recording already landed in place (create_live_lecture, 0138): section =
 * the session's section, order = next in that section, sheikh pre-filled. So
 * the card asks for ONLY two things — «مطلوب منك: العنوان النهائي والشيخ» —
 * both pre-filled (title = the preliminary one, sheikh = the server's
 * suggestion), shows the section FIXED with a small «تغيير» link (order stays
 * automatic), lists «المداخلات», then:
 *   «نشر» (with / without notification — the «إشعار الطلاب» switch, 0123)
 *   «حفظ دون نشر»
 * through admin_save_live_lecture (finalize_live_lecture + publish, atomic).
 *
 * Exit criterion (< 1 minute): with good defaults it is «نشر» → «نشر» in the
 * confirm dialog. Keyboard on web: the title is focused with its text
 * selected, Enter = «نشر».
 */
import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { Platform, Pressable, Switch, TextInput, View } from 'react-native';

import type { LiveInboxDraft } from '@/api/liveAdmin';
import type { SheikhOption } from '@/api/types';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { TreePicker } from '@/components/admin/TreePicker';
import { rpcErrorText } from '@/components/live/liveUi';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useSaveLiveLecture } from '@/hooks/useLiveAdmin';
import { useSectionsFlat } from '@/hooks/useSections';
import { arDateTime, arDuration, arNum } from '@/lib/format';
import { InterventionsList } from './InterventionsList';
import { LiveCommentsList } from './LiveCommentsList';
import { ADMIN_LIVE_COPY, isValidFinalTitle, peakLine } from './liveAdminUi';
import { ActionButton, InlineNote, LiveSourceChip } from './parts';
import { SheikhSelect } from './SheikhSelect';

export type LiveSaveKind = 'published' | 'published_quiet' | 'saved';

export function LiveDraftCard({
  draft,
  sheikhs,
  autoFocus = false,
  highlighted = false,
  onSaved,
}: {
  draft: LiveInboxDraft;
  sheikhs: readonly SheikhOption[];
  autoFocus?: boolean;
  /** Opened from «فتح في الواردة» on the live screen. */
  highlighted?: boolean;
  onSaved?: (kind: LiveSaveKind, title: string) => void;
}) {
  const save = useSaveLiveLecture();
  const { data: sections = [] } = useSectionsFlat();

  const [title, setTitle] = useState(draft.title);
  const [titleFocused, setTitleFocused] = useState(false);
  const [sheikhId, setSheikhId] = useState<string | null>(draft.sheikhId ?? draft.suggestedSheikhId);
  const [changingSection, setChangingSection] = useState(!draft.sectionId);
  const [sectionOverride, setSectionOverride] = useState<string | null>(null);
  const [notify, setNotify] = useState(draft.notifyOnPublish);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<LiveSaveKind | null>(null);

  const sectionId = sectionOverride ?? draft.sectionId;
  const sectionNode = useMemo(
    () => (sectionId ? (sections.find((s) => s.id === sectionId) ?? null) : null),
    [sections, sectionId],
  );
  const sectionPath: string[] = sectionNode?.path ?? (draft.sectionTitle ? [draft.sectionTitle] : []);

  const titleOk = isValidFinalTitle(title);
  const sheikhOk = !!sheikhId;
  const busy = save.isPending;
  const locked = busy || done !== null;
  const canSave = titleOk && sheikhOk && !locked;
  const canPublish = canSave && !!sectionId;

  function run(publish: boolean) {
    if (!sheikhId || !titleOk) return;
    setError(null);
    const kind: LiveSaveKind = publish ? (notify ? 'published' : 'published_quiet') : 'saved';
    save.mutate(
      {
        lectureId: draft.lectureId,
        title: title.trim(),
        sheikhId,
        sectionId: sectionOverride,
        publish,
        notify,
      },
      {
        onSuccess: () => {
          setDone(kind);
          onSaved?.(kind, title.trim());
        },
        onError: (e) => setError(rpcErrorText(e, 'تعذّر الحفظ. حاول مرة أخرى')),
      },
    );
  }

  function requestPublish() {
    if (!canPublish) return;
    setConfirming(true);
  }

  const meta: string[] = [];
  if (draft.endedAt) meta.push(`انتهى ${arDateTime(draft.endedAt)}`);
  const peak = peakLine(draft.peakListeners);
  if (peak) meta.push(peak);

  const orderLine = sectionOverride
    ? `${ADMIN_LIVE_COPY.autoOrder}: في آخر القسم`
    : draft.order
      ? `${ADMIN_LIVE_COPY.autoOrder}: رقم ${arNum(draft.order)} في القسم`
      : ADMIN_LIVE_COPY.autoOrder;

  const preliminary = draft.sessionTitle ?? draft.title;
  const publishLabel = notify ? ADMIN_LIVE_COPY.publish : ADMIN_LIVE_COPY.publishQuiet;

  return (
    <Card
      style={[
        { maxWidth: 760 },
        highlighted ? { borderColor: colors.primaryTeal600, borderWidth: 1.5 } : {},
      ]}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <LiveSourceChip label={ADMIN_LIVE_COPY.fromLive} />
        <View style={{ flex: 1 }} />
        {draft.durationSec && draft.durationSec > 0 ? (
          <Txt size={12} color={colors.textGhost} tabular>
            {arDuration(draft.durationSec)}
          </Txt>
        ) : null}
      </View>
      {meta.length ? (
        <Txt size={12} color={colors.textGhost} style={{ marginTop: 6 }}>
          {meta.join(' · ')}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 12 }}>
        <Rhombus size={6} color={colors.accentBrass} filled />
        <Txt size={13} weight="semibold" color={colors.accentBrassMuted}>
          {ADMIN_LIVE_COPY.required}
        </Txt>
      </View>

      <Divider />

      {/* Section — fixed, with a small «تغيير» */}
      <View style={{ marginTop: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Txt size={12.5} weight="semibold" color={colors.textSlate}>
            القسم
          </Txt>
          {!changingSection ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flexShrink: 1 }}>
                {sectionPath.map((part, i) => {
                  const leaf = i === sectionPath.length - 1;
                  return (
                    <Txt
                      key={`${i}-${part}`}
                      size={12.5}
                      weight={leaf ? 'semibold' : 'regular'}
                      color={leaf ? colors.primaryTeal600 : colors.textMuted}
                    >
                      {part}
                      {leaf ? '' : ' › '}
                    </Txt>
                  );
                })}
              </View>
              <Pressable
                onPress={() => setChangingSection(true)}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel="تغيير القسم"
                hitSlop={8}
              >
                <Txt size={12.5} weight="semibold" color={colors.primaryTeal600} style={{ textDecorationLine: 'underline' }}>
                  {ADMIN_LIVE_COPY.change}
                </Txt>
              </Pressable>
            </>
          ) : null}
        </View>
        {changingSection ? (
          <View style={{ marginTop: 8 }}>
            <TreePicker value={sectionId} onChange={(id) => setSectionOverride(id && id !== draft.sectionId ? id : null)} />
            {draft.sectionId ? (
              <Pressable
                onPress={() => {
                  setSectionOverride(null);
                  setChangingSection(false);
                }}
                accessibilityRole="button"
                style={{ alignSelf: 'flex-start', marginTop: 6 }}
                hitSlop={8}
              >
                <Txt size={12} weight="semibold" color={colors.textMuted}>
                  {ADMIN_LIVE_COPY.undoChange}
                </Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 4 }}>
          {orderLine}
        </Txt>
      </View>

      {/* The two required fields */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 14 }}>
        <View style={{ flexGrow: 2, flexBasis: 280, minWidth: 0 }}>
          <Txt size={12.5} weight="semibold" color={colors.textSlate} style={{ marginBottom: 6 }}>
            {ADMIN_LIVE_COPY.finalTitle} <Txt size={12.5} color={colors.stateDanger}>*</Txt>
          </Txt>
          <TextInput
            value={title}
            onChangeText={(t) => {
              setTitle(t);
              if (error) setError(null);
            }}
            editable={!locked}
            autoFocus={autoFocus}
            selectTextOnFocus={Platform.OS === 'web'}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            onSubmitEditing={requestPublish}
            returnKeyType="done"
            maxLength={200}
            textAlign="right"
            placeholder="مثال: شرح كتاب التوحيد · الدرس السابع"
            placeholderTextColor={colors.textGhost}
            accessibilityLabel={ADMIN_LIVE_COPY.finalTitle}
            style={{
              minHeight: 46,
              backgroundColor: colors.surfaceWhite,
              borderWidth: 1.5,
              borderColor: titleOk || !title ? (titleFocused ? colors.primaryTeal600 : colors.borderSand2) : colors.accentBrassMuted,
              borderRadius: radius.input,
              paddingHorizontal: 14,
              paddingVertical: 10,
              fontFamily: fonts.body,
              fontSize: 15,
              color: colors.textInk,
              writingDirection: 'rtl',
              ...(titleFocused ? shadows.subtle : null),
            }}
          />
          {!titleOk ? (
            <Txt size={11.5} color={colors.accentBrassMuted} style={{ marginTop: 4 }}>
              {ADMIN_LIVE_COPY.titleRule}
            </Txt>
          ) : title.trim() !== preliminary.trim() ? (
            <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 4 }} numberOfLines={1}>
              {`المبدئي: «${preliminary}»`}
            </Txt>
          ) : null}
        </View>
        <View style={{ flexGrow: 1, flexBasis: 200, minWidth: 0 }}>
          <Txt size={12.5} weight="semibold" color={colors.textSlate} style={{ marginBottom: 6 }}>
            {ADMIN_LIVE_COPY.sheikh} <Txt size={12.5} color={colors.stateDanger}>*</Txt>
          </Txt>
          <SheikhSelect
            sheikhs={sheikhs}
            value={sheikhId}
            suggestedId={draft.suggestedSheikhId}
            onChange={setSheikhId}
            invalid={!sheikhOk}
          />
        </View>
      </View>

      <InterventionsList sessionId={draft.sessionId} />
      <LiveCommentsList sessionId={draft.sessionId} />

      {/* Publish */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <Switch
          value={notify}
          onValueChange={setNotify}
          disabled={locked}
          trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
          thumbColor={colors.surfaceWhite}
          ios_backgroundColor={colors.surfaceInset}
          accessibilityLabel={ADMIN_LIVE_COPY.notifyStudents}
        />
        <View style={{ flex: 1 }}>
          <Txt size={13} weight="medium" color={colors.textInk}>
            {ADMIN_LIVE_COPY.notifyStudents}
          </Txt>
          <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 1 }}>
            {notify ? ADMIN_LIVE_COPY.notifyOn : ADMIN_LIVE_COPY.notifyOff}
          </Txt>
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        <ActionButton
          label={publishLabel}
          icon="check"
          tone="primary"
          disabled={!canPublish}
          busy={busy && save.variables?.publish === true}
          onPress={requestPublish}
        />
        <ActionButton
          label={ADMIN_LIVE_COPY.saveDraft}
          icon="save"
          disabled={!canSave}
          busy={busy && save.variables?.publish === false}
          onPress={() => run(false)}
        />
      </View>

      <InlineNote text={error} />
      {done ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <Feather name="check-circle" size={14} color={colors.stateSuccess} />
          <Txt size={12.5} color={colors.stateSuccess}>
            {done === 'saved' ? 'حُفظت دون نشر' : done === 'published' ? 'نُشرت وأُرسل الإشعار' : 'نُشرت دون إشعار'}
          </Txt>
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirming}
        destructive={false}
        title="نشر المحاضرة؟"
        message={
          notify
            ? `سيصل إشعار فوري إلى جميع الدارسين بأن «${title.trim()}» متاحة الآن.`
            : `ستظهر «${title.trim()}» في القسم مباشرة، ولن يصل أي إشعار للدارسين.`
        }
        confirmLabel={publishLabel}
        cancelLabel="تراجع"
        pending={busy}
        onConfirm={() => {
          setConfirming(false);
          run(true);
        }}
        onCancel={() => setConfirming(false)}
      />
    </Card>
  );
}
