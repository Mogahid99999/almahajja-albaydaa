/**
 * تذكرة — one support-ticket thread (item 10).
 *
 * Shows the message thread (student ⇄ admin) oldest→newest; admin replies may
 * carry an image and a CTA button (in-app route or external URL). The student
 * can reply while the ticket is open; a closed ticket is read-only. Notifications
 * from admin replies deep-link straight here.
 *
 * RTL: student messages align to the right edge, admin replies to the left, so
 * the conversation reads naturally under RTL. Reply composer is right-aligned.
 *
 * Route: /(student)/tickets/[id]
 */
import Feather from '@expo/vector-icons/Feather';
import { Image, KeyboardAvoidingView, Linking, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import type { TicketMessage } from '@/api/feedback';
import { getBroadcastImageUrl } from '@/api/broadcasts';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card } from '@/components/ui/Card';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { useMyTickets, useStudentReplyTicket, useTicketThread } from '@/hooks/useFeedback';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { arSince } from '@/lib/format';

export default function TicketThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const miniPad = useMiniPlayerPad();
  const ticketId = String(id ?? '');

  const { data: thread, refetch: refetchThread } = useTicketThread(ticketId);
  const { data: myTickets, refetch: refetchTickets } = useMyTickets();
  const reply = useStudentReplyTicket(ticketId);
  const { refreshing, onRefresh } = usePullToRefresh([
    () => refetchThread(),
    () => refetchTickets(),
  ]);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const ticket = (myTickets ?? []).find((t) => t.id === ticketId);
  const closed = ticket?.status === 'closed';

  // CTA on an admin reply: external URLs open in the browser, in-app routes
  // navigate via the router.
  const handleCta = (route: string) => {
    if (/^https?:\/\//i.test(route)) {
      void Linking.openURL(route);
    } else {
      router.push(route as Parameters<typeof router.push>[0]);
    }
  };

  const onSend = () => {
    const text = body.trim();
    if (!text) return;
    setError('');
    reply.mutate(text, {
      onSuccess: () => setBody(''),
      onError: (e) => setError(e instanceof Error ? e.message : 'تعذّر إرسال الرد'),
    });
  };

  return (
    // The app is edge-to-edge, so the keyboard OVERLAYS the screen — `padding`
    // shrinks the scroll area so the focused reply box scrolls above the
    // keyboard instead of being covered (same fix as register / FeedbackSheet).
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
    <Screen
      bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
      padded
      scroll
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18,
        }}
      >
        <Txt size={20} weight="display" color={colors.primaryTeal}>
          التذكرة
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      <View style={{ gap: 12 }}>
        {(thread ?? []).map((m) => (
          <MessageBubble key={m.id} message={m} onCta={handleCta} />
        ))}
      </View>

      {closed ? (
        <Card style={{ marginTop: 16, alignItems: 'center', paddingVertical: 16 }}>
          <Txt size={12.5} color={colors.textMuted} align="center">
            أُغلقت هذه التذكرة — يمكنك إرسال ملاحظة جديدة في أي وقت
          </Txt>
        </Card>
      ) : (
        <View style={{ marginTop: 16 }}>
          <TextInput
            value={body}
            onChangeText={setBody}
            placeholder="اكتب ردّك…"
            placeholderTextColor={colors.textGhost}
            multiline
            textAlign="right"
            textAlignVertical="top"
            style={{
              minHeight: 64,
              backgroundColor: colors.surfaceWhite,
              borderWidth: 1,
              borderColor: colors.borderSand2,
              borderRadius: radius.input,
              paddingHorizontal: 14,
              paddingVertical: 10,
              fontFamily: fonts.body,
              fontSize: 14,
              lineHeight: 22,
              color: colors.textInk,
              writingDirection: 'rtl',
            }}
          />
          {error ? (
            <Txt size={12.5} color={colors.stateDanger} style={{ marginTop: 6 }}>
              {error}
            </Txt>
          ) : null}
          <Pressable
            onPress={onSend}
            disabled={reply.isPending || !body.trim()}
            style={({ pressed }) => [
              {
                marginTop: 10,
                paddingVertical: 13,
                borderRadius: radius.input,
                alignItems: 'center',
                backgroundColor: colors.primaryTeal,
                opacity: pressed || reply.isPending || !body.trim() ? 0.6 : 1,
              },
              shadows.button,
            ]}
          >
            <Txt size={14} weight="semibold" color={colors.onTealPrimary}>
              {reply.isPending ? 'جارٍ الإرسال…' : 'إرسال'}
            </Txt>
          </Pressable>
        </View>
      )}
    </Screen>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({
  message,
  onCta,
}: {
  message: TicketMessage;
  onCta: (route: string) => void;
}) {
  const admin = message.isAdmin;
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (message.imagePath) {
      getBroadcastImageUrl(message.imagePath).then((u) => {
        if (alive) setImageUrl(u);
      });
    }
    return () => {
      alive = false;
    };
  }, [message.imagePath]);

  return (
    <View style={{ alignItems: admin ? 'flex-start' : 'flex-end' }}>
      <Card
        style={{
          maxWidth: '88%',
          backgroundColor: admin ? colors.surfaceInset : colors.primaryTeal,
        }}
      >
        <Txt size={10.5} weight="semibold" color={admin ? colors.accentBrassMuted : colors.onTealPrimary} align="right">
          {admin ? 'الإدارة' : 'أنت'}
        </Txt>
        {message.body ? (
          <Txt
            size={13.5}
            color={admin ? colors.textInk : colors.onTealPrimary}
            align="right"
            style={{ marginTop: 6, lineHeight: 22 }}
          >
            {message.body}
          </Txt>
        ) : null}

        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: '100%', height: 160, borderRadius: radius.sm, marginTop: 10 }}
            resizeMode="cover"
          />
        ) : null}

        {message.ctaLabel && message.ctaRoute ? (
          <Pressable
            onPress={() => onCta(message.ctaRoute as string)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              marginTop: 12,
              paddingVertical: 10,
              borderRadius: radius.input,
              alignItems: 'center',
              backgroundColor: admin ? colors.primaryTeal : colors.onTealPrimary,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Txt size={13} weight="semibold" color={admin ? colors.onTealPrimary : colors.primaryTeal}>
              {message.ctaLabel}
            </Txt>
          </Pressable>
        ) : null}

        <Txt size={10} color={admin ? colors.textGhost : colors.onTealPrimary} align="right" style={{ marginTop: 8, opacity: 0.7 }}>
          {arSince(message.createdAt)}
        </Txt>
      </Card>
    </View>
  );
}
