/**
 * التعريف بالشيخ — Item 8.
 *
 * Reuses the admin's `useSheikhProfiles()` (bio + resolved photo signed URL).
 * A single sheikh renders as a hero card; more than one renders as a simple
 * tap-to-expand list — no nested dynamic route needed for this scope.
 */
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import type { SheikhProfile } from '@/api/sheikhs';
import { Card, Divider, IconButton, Rhombus, Screen, Txt } from '@/components/ui';
import { colors } from '@/constants/theme';
import { useSheikhProfiles } from '@/hooks/useAdmin';
import { useMiniPlayerPad } from '@/hooks/useMiniPlayerPad';

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
  const { data: sheikhs = [], isLoading } = useSheikhProfiles();

  return (
    <Screen bottomPad={miniPad || 24} padded>
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
      ) : sheikhs.length === 1 ? (
        <Card style={{ alignItems: 'center', gap: 14 }}>
          <SheikhAvatar uri={sheikhs[0].photoUrl} size={96} />
          <Txt size={20} weight="display" color={colors.primaryTeal} align="center">
            {sheikhs[0].name}
          </Txt>
          <Rhombus size={7} color={colors.accentBrassMuted} />
          <Txt size={14} color={colors.textMuted} align="right" style={{ lineHeight: 24, marginTop: 4 }}>
            {sheikhs[0].bio || 'لم تُضف نبذة بعد.'}
          </Txt>
        </Card>
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
