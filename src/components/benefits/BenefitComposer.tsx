/**
 * «قيّد فائدة» — the inline box at the top of فوائد الدارسين, shaped like the
 * question composer («اسأل سؤالاً»). General benefits only: a benefit from a
 * lesson is added inside that lesson (player → الفوائد), where it is linked.
 * Always published without a name.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { usePostBenefit } from '@/hooks/useBenefits';
import { arabicOr } from '@/lib/errorText';

export function BenefitComposer({ onPosted }: { onPosted?: () => void }) {
  const post = usePostBenefit();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const text = body.trim();

  function submit() {
    if (text.length < 3) {
      setError('اكتب الفائدة أولاً');
      return;
    }
    setError('');
    post.mutate(
      { lectureId: null, body: text },
      {
        onSuccess: () => {
          setBody('');
          setSent(true);
          onPosted?.();
        },
        onError: (e) => setError(arabicOr(e, 'تعذّر نشر الفائدة')),
      },
    );
  }

  return (
    <Card style={{ marginBottom: 12 }}>
      <Txt weight="semibold" size={14} color={colors.textInk}>
        قيّد فائدة
      </Txt>
      <TextInput
        value={body}
        onChangeText={(t) => {
          setBody(t);
          if (sent) setSent(false);
          if (error) setError('');
        }}
        placeholder="اكتب الفائدة، ويحسن أن تنسبها إلى قائلها..."
        placeholderTextColor={colors.textGhost}
        multiline
        maxLength={1000}
        textAlign="right"
        textAlignVertical="top"
        style={styles.input}
        accessibilityLabel="نص الفائدة"
      />
      <Txt size={11.5} color={colors.textGhost} style={{ marginTop: 12, lineHeight: 18 }}>
        تُنشر دون اسمك. ولإضافة فائدة من درس، افتح الدرس واختر «الفوائد».
      </Txt>
      {error ? (
        <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
          {error}
        </Txt>
      ) : null}
      {sent ? (
        <View style={styles.sentRow}>
          <Feather name="check-circle" size={14} color={colors.stateSuccess} />
          <Txt size={12.5} color={colors.stateSuccess} style={{ flex: 1, lineHeight: 19 }}>
            نُشرت فائدتك دون اسمك، جزاك الله خيراً.
          </Txt>
        </View>
      ) : null}
      <Pressable
        onPress={submit}
        disabled={post.isPending || !text}
        accessibilityRole="button"
        style={({ pressed }) => [styles.btn, { opacity: pressed || post.isPending || !text ? 0.7 : 1 }]}
      >
        {post.isPending ? (
          <ActivityIndicator size="small" color={colors.onTealPrimary} />
        ) : (
          <Txt size={13.5} weight="semibold" color={colors.onTealPrimary}>
            نشر الفائدة
          </Txt>
        )}
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 88,
    marginTop: 12,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textInk,
  },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  btn: {
    marginTop: 12,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  },
});
