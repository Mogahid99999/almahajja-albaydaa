/**
 * AdminTicketThread — the reply thread + composer shown inside an admin feedback
 * card (item 10). Lets the admin read the student ⇄ admin conversation, reply
 * (with an optional attached image and an optional CTA button), and close the
 * ticket. Reuses the same get_ticket_thread / admin_reply_ticket / admin_close
 * RPCs the student side uses.
 *
 * Admin web is used from phones too, so this stays compact and RTL-correct.
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import { uploadBroadcastImage } from '@/api/broadcasts';
import { Txt } from '@/components/ui';
import { colors, fonts, radius } from '@/constants/theme';
import {
  useAdminCloseTicket,
  useAdminReplyTicket,
  useTicketThread,
} from '@/hooks/useFeedback';
import { getDocumentAsync } from '@/lib/documentPicker';
import { arSince } from '@/lib/format';

export function AdminTicketThread({ feedbackId, closed }: { feedbackId: string; closed: boolean }) {
  const { data: thread, isLoading } = useTicketThread(feedbackId);
  const reply = useAdminReplyTicket(feedbackId);
  const close = useAdminCloseTicket(feedbackId);

  const [body, setBody] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaRoute, setCtaRoute] = useState('');
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function pickImage() {
    setError('');
    try {
      const res = await getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      setUploading(true);
      const key = await uploadBroadcastImage({ uri: a.uri, name: a.name, mimeType: a.mimeType });
      setImagePath(key);
    } catch {
      setError('تعذّر رفع الصورة.');
    } finally {
      setUploading(false);
    }
  }

  function send() {
    const text = body.trim();
    if (!text) return;
    setError('');
    reply.mutate(
      {
        body: text,
        imagePath,
        ctaLabel: ctaLabel.trim() || null,
        ctaRoute: ctaRoute.trim() || null,
      },
      {
        onSuccess: () => {
          setBody('');
          setCtaLabel('');
          setCtaRoute('');
          setImagePath(null);
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'تعذّر إرسال الرد'),
      },
    );
  }

  return (
    <View style={{ marginTop: 12, gap: 10 }}>
      {/* Thread */}
      {isLoading ? (
        <ActivityIndicator color={colors.primaryTeal} />
      ) : (
        <View style={{ gap: 8 }}>
          {(thread ?? []).map((m) => (
            <View
              key={m.id}
              style={{
                alignSelf: m.isAdmin ? 'flex-start' : 'flex-end',
                maxWidth: '90%',
                backgroundColor: m.isAdmin ? colors.surfaceInset : 'rgba(44,97,87,0.08)',
                borderRadius: radius.sm,
                padding: 10,
              }}
            >
              <Txt size={10} weight="semibold" color={colors.textGhost} align="right">
                {m.isAdmin ? 'الإدارة' : 'الطالب'} · {arSince(m.createdAt)}
              </Txt>
              {m.body ? (
                <Txt size={13} color={colors.textInk} align="right" style={{ marginTop: 4, lineHeight: 21 }}>
                  {m.body}
                </Txt>
              ) : null}
              {m.ctaLabel ? (
                <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Feather name="external-link" size={11} color={colors.primaryTeal600} />
                  <Txt size={11} weight="medium" color={colors.primaryTeal600}>
                    {m.ctaLabel}
                  </Txt>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {closed ? (
        <Txt size={12} color={colors.textMuted} align="center" style={{ paddingVertical: 8 }}>
          هذه التذكرة مغلقة
        </Txt>
      ) : (
        <View style={{ gap: 8 }}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="اكتب ردّك على الطالب…"
            placeholderTextColor={colors.textGhost}
            multiline
            textAlign="right"
            textAlignVertical="top"
            style={inputStyle}
          />
          {/* Optional CTA */}
          <TextInput
            value={ctaLabel}
            onChangeText={setCtaLabel}
            placeholder="نص زر (اختياري) — مثال: افتح الصفحة"
            placeholderTextColor={colors.textGhost}
            textAlign="right"
            style={[inputStyle, { minHeight: 40 }]}
          />
          <TextInput
            value={ctaRoute}
            onChangeText={setCtaRoute}
            placeholder="رابط الزر أو مسار داخلي (اختياري)"
            placeholderTextColor={colors.textGhost}
            textAlign="left"
            autoCapitalize="none"
            style={[inputStyle, { minHeight: 40, textAlign: 'left' }]}
          />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Pressable
              onPress={pickImage}
              disabled={uploading}
              style={({ pressed }) => [chipBtn, pressed && { opacity: 0.6 }]}
            >
              <Feather name="image" size={14} color={colors.primaryTeal} />
              <Txt size={12} weight="medium" color={colors.primaryTeal}>
                {uploading ? 'جارٍ الرفع…' : imagePath ? 'تم إرفاق صورة' : 'إرفاق صورة'}
              </Txt>
            </Pressable>
            {imagePath ? (
              <Pressable onPress={() => setImagePath(null)} style={({ pressed }) => [chipBtn, pressed && { opacity: 0.6 }]}>
                <Feather name="x" size={13} color={colors.stateDanger} />
                <Txt size={12} color={colors.stateDanger}>
                  إزالة
                </Txt>
              </Pressable>
            ) : null}
          </View>

          {error ? (
            <Txt size={12} color={colors.stateDanger}>
              {error}
            </Txt>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={send}
              disabled={reply.isPending || !body.trim()}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 11,
                borderRadius: radius.input,
                alignItems: 'center',
                backgroundColor: colors.primaryTeal,
                opacity: pressed || reply.isPending || !body.trim() ? 0.6 : 1,
              })}
            >
              <Txt size={13} weight="semibold" color={colors.onTealPrimary}>
                {reply.isPending ? 'جارٍ الإرسال…' : 'إرسال الرد'}
              </Txt>
            </Pressable>
            <Pressable
              onPress={() => close.mutate()}
              disabled={close.isPending}
              style={({ pressed }) => ({
                paddingVertical: 11,
                paddingHorizontal: 16,
                borderRadius: radius.input,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: colors.borderSand2,
                opacity: pressed || close.isPending ? 0.6 : 1,
              })}
            >
              <Txt size={13} weight="medium" color={colors.textMuted}>
                إغلاق التذكرة
              </Txt>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const inputStyle = {
  minHeight: 56,
  backgroundColor: colors.surfaceWhite,
  borderWidth: 1,
  borderColor: colors.borderSand2,
  borderRadius: radius.input,
  paddingHorizontal: 12,
  paddingVertical: 9,
  fontFamily: fonts.body,
  fontSize: 13.5,
  lineHeight: 21,
  color: colors.textInk,
  writingDirection: 'rtl' as const,
};

const chipBtn = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 6,
  paddingVertical: 7,
  paddingHorizontal: 12,
  borderRadius: radius.pill,
  borderWidth: 1,
  borderColor: colors.borderSand2,
};
