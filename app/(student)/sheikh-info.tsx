/**
 * التعريف بالشيخ — Item 8.
 *
 * Reuses the admin's `useSheikhProfiles()` (bio + resolved photo signed URL).
 * Whoever has a bio written is "the" sheikh and gets the fabulous hero card +
 * formatted biography; any other sheikh rows (demo/test accounts with no bio)
 * render as a small secondary list underneath instead of taking over the page.
 * With zero bios anywhere, falls back to the old single-hero/list behavior.
 */

/**
 * The DB's `sheikhs.name` for this record predates his family name — display
 * copy on this page only (not persisted) uses the fuller name from his own
 * biography note.
 */
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  '7d14315d-1211-4f72-a8ca-8308ed78e1f8': 'الشيخ النذير محمد فرح عثمان',
};
import { useMemo, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';

import type { SheikhProfile } from '@/api/sheikhs';
import { BOTTOM_NAV_CLEARANCE } from '@/components/navigation/BottomNavBar';
import { Card, Divider, IconButton, Rhombus, Screen, Txt } from '@/components/ui';
import { ConcentricMotif } from '@/components/ui/Rhombus';
import { colors, shadows } from '@/constants/theme';
import { useSheikhProfiles } from '@/hooks/useAdmin';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

/**
 * Lightweight bio markup, written by admins in the plain-text bio field:
 *   "## عنوان"     → section heading
 *   "- عنوان — تفصيل"  → list row (title bold, detail muted; "—" split optional)
 *   blank line     → paragraph break
 * Anything else renders as flowing prose. Kept intentionally tiny — this is a
 * bio field, not a document editor.
 */
type BioBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: { title: string; detail: string }[] }
  | { kind: 'para'; text: string };

function parseBio(raw: string): BioBlock[] {
  const lines = raw.split('\n');
  const blocks: BioBlock[] = [];
  let para: string[] = [];
  let list: { title: string; detail: string }[] = [];

  function flushPara() {
    if (para.length) {
      blocks.push({ kind: 'para', text: para.join(' ').trim() });
      para = [];
    }
  }
  function flushList() {
    if (list.length) {
      blocks.push({ kind: 'list', items: list });
      list = [];
    }
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      continue;
    }
    if (line.startsWith('## ')) {
      flushPara();
      flushList();
      blocks.push({ kind: 'heading', text: line.slice(3).trim() });
    } else if (line.startsWith('- ')) {
      flushPara();
      const body = line.slice(2).trim();
      const dashIdx = body.indexOf(' — ');
      if (dashIdx === -1) {
        list.push({ title: body, detail: '' });
      } else {
        list.push({ title: body.slice(0, dashIdx), detail: body.slice(dashIdx + 3) });
      }
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return blocks;
}

function BioContent({ bio }: { bio: string }) {
  const blocks = useMemo(() => parseBio(bio), [bio]);
  return (
    <View>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginTop: i === 0 ? 0 : 22,
                marginBottom: 12,
              }}
            >
              <Rhombus size={7} color={colors.accentBrassMuted} />
              <Txt size={15.5} weight="display" color={colors.primaryTeal}>
                {block.text}
              </Txt>
            </View>
          );
        }
        if (block.kind === 'list') {
          return (
            <View key={i} style={{ gap: 10, marginBottom: 4 }}>
              {block.items.map((item, j) => (
                <View key={j} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ marginTop: 7 }}>
                    <Rhombus size={5.5} color={colors.accentBrass} />
                  </View>
                  <Txt size={13.5} color={colors.textSlate} style={{ flex: 1, lineHeight: 22 }} align="right">
                    <Txt size={13.5} weight="semibold" color={colors.textInk}>
                      {item.title}
                    </Txt>
                    {item.detail ? (
                      <Txt size={13} color={colors.textMuted}>
                        {'  —  ' + item.detail}
                      </Txt>
                    ) : null}
                  </Txt>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Txt
            key={i}
            size={14}
            color={colors.textMuted}
            align="right"
            style={{ lineHeight: 26, marginBottom: 14 }}
          >
            {block.text}
          </Txt>
        );
      })}
    </View>
  );
}

function SheikhAvatar({ uri, size }: { uri: string | null; size: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.bgSand,
        borderWidth: 1,
        borderColor: colors.borderSand2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} />
      ) : (
        <Feather name="user" size={size * 0.45} color={colors.textGhost} />
      )}
    </View>
  );
}

function SheikhListRow({ sheikh }: { sheikh: SheikhProfile }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable onPress={() => setExpanded((e) => !e)} style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <SheikhAvatar uri={sheikh.photoUrl} size={40} />
        <Txt size={14} weight="medium" color={colors.textInk} style={{ flex: 1 }}>
          {sheikh.name}
        </Txt>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textGhost} />
      </View>
      {expanded ? (
        <Txt size={13} color={colors.textMuted} style={{ marginTop: 10, lineHeight: 22 }}>
          {sheikh.bio || 'لم تُضف نبذة بعد.'}
        </Txt>
      ) : null}
    </Pressable>
  );
}

export default function SheikhInfoScreen() {
  const router = useRouter();
  const miniPad = useMiniPlayerPad();
  const { data: sheikhs = [], isLoading, refetch } = useSheikhProfiles();
  const { refreshing, onRefresh } = usePullToRefresh([refetch]);

  const primary = sheikhs.find((s) => !!s.bio?.trim()) ?? (sheikhs.length === 1 ? sheikhs[0] : null);
  const others = primary ? sheikhs.filter((s) => s.id !== primary.id) : sheikhs;

  return (
    <Screen
      bottomPad={(miniPad || 24) + BOTTOM_NAV_CLEARANCE}
      padded
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <Txt size={22} weight="display" color={colors.primaryTeal}>
          التعريف بالشيخ
        </Txt>
        <IconButton icon="chevron-right" onPress={() => router.back()} accessibilityLabel="رجوع" />
      </View>

      {isLoading ? (
        <Card>
          <Txt size={13} color={colors.textGhost} align="center">جارٍ التحميل...</Txt>
        </Card>
      ) : sheikhs.length === 0 ? (
        <Card>
          <Txt size={13} color={colors.textMuted} align="center">لا تتوفر معلومات بعد.</Txt>
        </Card>
      ) : primary ? (
        <>
          <Card style={{ alignItems: 'center', gap: 14, overflow: 'hidden' }}>
            <ConcentricMotif
              size={200}
              rings={3}
              color="rgba(31,74,66,0.05)"
              style={{ top: -50, left: -50 }}
            />
            <SheikhAvatar uri={primary.photoUrl} size={104} />
            <Txt size={21} weight="display" color={colors.primaryTeal} align="center">
              {DISPLAY_NAME_OVERRIDES[primary.id] ?? primary.name}
            </Txt>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Rhombus size={5} color={colors.accentBrassSoft} />
              <Rhombus size={8} color={colors.accentBrassMuted} filled={false} />
              <Rhombus size={5} color={colors.accentBrassSoft} />
            </View>
          </Card>

          <Card style={[{ marginTop: 16 }, shadows.feature]}>
            {primary.bio ? (
              <BioContent bio={primary.bio} />
            ) : (
              <Txt size={13} color={colors.textMuted} align="center">لم تُضف نبذة بعد.</Txt>
            )}
          </Card>

          {others.length > 0 ? (
            <>
              <Txt size={13} weight="medium" color={colors.textFaint} style={{ marginTop: 24, marginBottom: 10 }}>
                مشايخ آخرون
              </Txt>
              <Card padded={false}>
                {others.map((s, idx) => (
                  <View key={s.id}>
                    {idx > 0 ? <Divider /> : null}
                    <SheikhListRow sheikh={s} />
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : (
        <Card padded={false}>
          {sheikhs.map((s, idx) => (
            <View key={s.id}>
              {idx > 0 ? <Divider /> : null}
              <SheikhListRow sheikh={s} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
