/**
 * «ابدأ مجلساً مباشراً» from a section page (PLAN_LIVE_V23 §7.3/§7.6) — staff
 * who can host (admin / publisher / sheikh). Title (prefilled with the section
 * title, 3–200 chars) + «إشعار للجميع عند البدء» + «استقبال طلبات الكلمة»
 * (both on) → create_live_session → `onCreated(id)` (the caller opens the green
 * room). The RPC's own Arabic message shows on failure (e.g. another live running).
 */
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Switch, TextInput, View } from 'react-native';

import { Divider, Txt, cardRowStyle } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import { useCreateLiveSession } from '@/hooks/useLive';
import { LIVE_P4_COPY, isValidLiveTitle, rpcErrorText } from '../liveUi';
import { LiveSheet } from './LiveSheet';
import { SheetButton, SheetError } from './sheetParts';

export function CreateLiveSheet({
  visible,
  onClose,
  sectionId,
  initialTitle,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  sectionId: string;
  initialTitle: string;
  onCreated: (sessionId: string) => void;
}) {
  const create = useCreateLiveSession();
  const [title, setTitle] = useState(initialTitle);
  const [notify, setNotify] = useState(true);
  const [allowRequests, setAllowRequests] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setTitle(initialTitle);
    setNotify(true);
    setAllowRequests(true);
    setError(null);
  }, [visible, initialTitle]);

  const valid = isValidLiveTitle(title);
  const busy = create.isPending;

  const submit = () => {
    if (!valid || busy) return;
    setError(null);
    create.mutate(
      { sectionId, title: title.trim(), notify, allowRequests },
      {
        onSuccess: (id) => onCreated(id),
        onError: (e) => setError(rpcErrorText(e, 'تعذّر بدء المجلس. حاول مرة أخرى')),
      },
    );
  };

  return (
    <LiveSheet
      visible={visible}
      onClose={onClose}
      title={LIVE_P4_COPY.startLive}
      sub="يُسجَّل المجلس ويُحفظ في هذا القسم. تبدأ بغرفة التجهيز لتختبر الميكروفون قبل البث."
    >
      <KeyboardAvoidingView behavior="padding">
        <Txt size={12.5} weight="semibold" color={colors.textSlate} style={{ marginBottom: 6 }}>
          عنوان المجلس
        </Txt>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="مثال: شرح كتاب التوحيد · الدرس الأول"
          placeholderTextColor={colors.textGhost}
          maxLength={200}
          textAlign="right"
          accessibilityLabel="عنوان المجلس"
          style={{
            backgroundColor: colors.surfaceWhite,
            borderWidth: 1.5,
            borderColor: valid || !title ? colors.borderSand2 : colors.accentBrassMuted,
            borderRadius: radius.input,
            paddingHorizontal: 14,
            paddingVertical: 11,
            fontFamily: fonts.body,
            fontSize: 15,
            color: colors.textInk,
            writingDirection: 'rtl',
          }}
        />
        {!valid ? (
          <Txt size={12} color={colors.textFaint} style={{ marginTop: 6 }}>
            العنوان من ٣ إلى ٢٠٠ حرف
          </Txt>
        ) : null}

        <View style={{ marginTop: 14 }}>
          <ToggleRow first label={LIVE_P4_COPY.notifyAll} value={notify} onChange={setNotify} />
          <View
            style={{
              backgroundColor: colors.surfaceCard,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderColor: colors.borderSand,
            }}
          >
            <Divider />
          </View>
          <ToggleRow last label={LIVE_P4_COPY.allowRequests} value={allowRequests} onChange={setAllowRequests} />
        </View>

        <SheetError text={error} />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <SheetButton
            label="إلى غرفة التجهيز"
            tone="primary"
            busy={busy}
            disabled={!valid}
            onPress={submit}
          />
          <SheetButton label={LIVE_P4_COPY.cancel} onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </LiveSheet>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  first = false,
  last = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  first?: boolean;
  last?: boolean;
}) {
  return (
    <View
      style={[
        cardRowStyle(first, last),
        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
      ]}
    >
      <Txt size={14} weight="medium" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: colors.surfaceInset, true: colors.primaryTeal600 }}
        thumbColor={colors.surfaceWhite}
        ios_backgroundColor={colors.surfaceInset}
      />
    </View>
  );
}
