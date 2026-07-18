/**
 * TicketImage — resolves a ticket-message image key (stored under the R2
 * `broadcasts/` prefix) to a signed URL and renders it, with a calm placeholder
 * while it loads or if it fails. Shared by the student thread and the admin
 * thread so an attached image shows on BOTH sides (the read gate — migration
 * 0101 — allows the admin and the ticket owner).
 *
 * The thumbnail shows the WHOLE image (contain, true aspect ratio measured — no
 * cropping) and tapping it opens a full-screen viewer. Keeps a min height so the
 * surrounding bubble never collapses to a sliver while the URL resolves.
 */
import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, View } from 'react-native';

import { getBroadcastImageUrl } from '@/api/broadcasts';
import { colors, radius } from '@/constants/theme';

export function TicketImage({
  imagePath,
  onDark = false,
}: {
  imagePath: string;
  /** Placeholder tint for a dark bubble background. */
  onDark?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    getBroadcastImageUrl(imagePath).then((u) => {
      if (!alive) return;
      setUrl(u);
      if (u) {
        // Measure the real aspect ratio so the whole image shows uncropped.
        Image.getSize(
          u,
          (w, h) => {
            if (alive && w > 0 && h > 0) setRatio(w / h);
          },
          () => {},
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [imagePath]);

  if (!url) {
    return (
      <View
        style={{
          width: '100%',
          height: 160,
          borderRadius: radius.sm,
          marginTop: 10,
          backgroundColor: onDark ? colors.primaryTealDeep : colors.surfaceWhite,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name="image" size={22} color={onDark ? colors.onTealSecondary : colors.textGhost} />
      </View>
    );
  }

  return (
    <>
      <Pressable onPress={() => setViewerOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="فتح الصورة">
        <Image
          source={{ uri: url }}
          // True aspect ratio (fallback 4:3) + contain → the entire image is
          // visible, never cropped. Capped so a very tall image can't dominate.
          style={{
            width: '100%',
            aspectRatio: ratio ?? 4 / 3,
            maxHeight: 260,
            borderRadius: radius.sm,
            marginTop: 10,
            backgroundColor: onDark ? colors.primaryTealDeep : colors.surfaceInset,
          }}
          resizeMode="contain"
        />
      </Pressable>

      {/* Full-screen viewer */}
      <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <Pressable
          onPress={() => setViewerOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          <Pressable
            onPress={() => setViewerOpen(false)}
            accessibilityLabel="إغلاق"
            hitSlop={12}
            style={{ position: 'absolute', top: 44, left: 20 }}
          >
            <Feather name="x" size={28} color="#fff" />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
