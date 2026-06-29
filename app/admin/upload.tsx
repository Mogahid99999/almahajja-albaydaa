/**
 * Admin upload lecture screen — /admin/upload
 *
 * Two-column layout (content 1fr + right rail 320px sticky).
 * Design ref: README §4 · ds-bundle/components/Admin/UploadLecture/UploadLecture.prompt.md
 *
 * Left column cards:
 *   1. المعلومات الأساسية — title input + mock audio uploaded row
 *   2. التصنيف والترتيب — TreePicker + order input + sheikh select
 *   3. المرفقات — dashed dropzone + fake attached file row
 *
 * Right rail (sticky):
 *   - PublishToggle
 *   - Dates placeholder
 *   - Submit / معاينة buttons
 *   - Tip card
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { AttachmentManager } from '@/components/admin/AttachmentManager';
import { PublishToggle } from '@/components/admin/PublishToggle';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows, spacing } from '@/constants/theme';
import { useCreateLecture, useSheikhs } from '@/hooks/useAdmin';
import { arFileSize, toArabicDigits } from '@/lib/format';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The audio file the admin picked, held until the lecture is saved. */
type PickedAudio = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size: number | null;
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={styles.sectionCard}>
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.cardTitle}>
        {title}
      </Txt>
      {children}
    </Card>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
      {children}
    </Txt>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function UploadScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const narrow = width < 900;

  const { data: sheikhs = [] } = useSheikhs();
  const createLecture = useCreateLecture();

  // Form state
  const [title, setTitle] = useState('');
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [order, setOrder] = useState('');
  const [sheikhId, setSheikhId] = useState<string | null>(null);
  const [publishStatus, setPublishStatus] = useState<'draft' | 'published'>('draft');
  const [titleFocused, setTitleFocused] = useState(false);
  const [orderFocused, setOrderFocused] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [audioFile, setAudioFile] = useState<PickedAudio | null>(null);
  // Set once the lecture is saved — attachments hang off the created lecture id.
  const [createdLectureId, setCreatedLectureId] = useState<string | null>(null);

  // Sheikh picker open
  const [sheikhOpen, setSheikhOpen] = useState(false);

  const selectedSheikh = sheikhId ? sheikhs.find((s) => s.id === sheikhId) ?? null : null;

  async function handlePickAudio() {
    // Loaded lazily (not at module top-level): expo-document-picker resolves its
    // native module on import, which would crash the student app on Android/Expo
    // Go at startup — even though picking only ever happens on the web admin.
    const DocumentPicker = await import('expo-document-picker');
    const res = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    setAudioFile({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size ?? null,
    });
  }

  function handleSubmit() {
    if (!title.trim()) return;
    createLecture.mutate(
      {
        title: title.trim(),
        sectionId,
        sheikhId,
        order: order ? Number(order) : 0,
        status: publishStatus,
        audioFile,
      },
      {
        onSuccess: (created) => {
          setSuccessMsg(
            publishStatus === 'published'
              ? 'تم نشر المحاضرة بنجاح.'
              : 'تم حفظ المحاضرة كمسودة.',
          );
          setCreatedLectureId(created.id);
          setTitle('');
          setSectionId(null);
          setOrder('');
          setSheikhId(null);
          setPublishStatus('draft');
          setAudioFile(null);
        },
      },
    );
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  const content = (
    <View style={[styles.grid, narrow && styles.gridNarrow]}>
      {/* ── Left column ── */}
      <View style={styles.leftCol}>
        {/* Success banner */}
        {successMsg ? (
          <View style={styles.successBanner}>
            <Feather name="check-circle" size={16} color={colors.stateSuccess} />
            <Txt size={13} color={colors.stateSuccess} style={{ marginRight: 8, flex: 1 }}>
              {successMsg}
            </Txt>
            <Pressable onPress={() => setSuccessMsg('')}>
              <Feather name="x" size={14} color={colors.stateSuccess} />
            </Pressable>
          </View>
        ) : null}

        {/* Card 1: Basic info */}
        <CardSection title="المعلومات الأساسية">
          <FieldLabel>عنوان المحاضرة</FieldLabel>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="أدخل عنوان المحاضرة..."
            placeholderTextColor={colors.textGhost}
            onFocus={() => setTitleFocused(true)}
            onBlur={() => setTitleFocused(false)}
            textAlign="right"
            style={[styles.titleInput, titleFocused && styles.titleInputFocused]}
          />

          {/* Audio file picker / picked row */}
          <FieldLabel>ملف الصوت</FieldLabel>
          {audioFile ? (
            <View style={styles.audioRow}>
              {/* Waveform tile */}
              <View style={styles.waveformTile}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: 8 + Math.sin(i * 0.8) * 6,
                        opacity: i < 7 ? 1 : 0.35,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Txt size={13} weight="semibold" color={colors.textInk} numberOfLines={1}>
                  {audioFile.name}
                </Txt>
                <Txt size={11} color={colors.textMuted} style={{ marginTop: 3 }} tabular>
                  {audioFile.size != null
                    ? `${arFileSize(audioFile.size)} · جاهز للرفع`
                    : 'جاهز للرفع'}
                </Txt>
              </View>
              <Pressable
                style={styles.removeBtn}
                accessibilityLabel="إزالة الملف"
                onPress={() => setAudioFile(null)}
              >
                <Feather name="x" size={15} color={colors.stateDanger} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={handlePickAudio}
              style={({ pressed }) => [styles.audioPicker, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <Feather name="upload-cloud" size={24} color={colors.primaryTeal} />
              <Txt size={13} weight="semibold" color={colors.primaryTeal} style={{ marginTop: 8 }}>
                اختر ملف الصوت
              </Txt>
              <Txt size={11} color={colors.textGhost} style={{ marginTop: 3 }}>
                MP3 أو M4A أو أي صيغة صوتية
              </Txt>
            </Pressable>
          )}
        </CardSection>

        {/* Card 2: Classification */}
        <CardSection title="التصنيف والترتيب">
          <FieldLabel>القسم / العنصر الأب</FieldLabel>
          <TreePicker value={sectionId} onChange={setSectionId} allowNull label="اختر القسم الأب" />

          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <FieldLabel>رقم الترتيب</FieldLabel>
              <TextInput
                value={order}
                onChangeText={(t) => setOrder(t.replace(/[^0-9]/g, ''))}
                placeholder={toArabicDigits('1')}
                placeholderTextColor={colors.textGhost}
                keyboardType="numeric"
                onFocus={() => setOrderFocused(true)}
                onBlur={() => setOrderFocused(false)}
                textAlign="center"
                style={[styles.orderInput, orderFocused && styles.inputFocused]}
              />
            </View>
            <View style={{ flex: 2 }}>
              <FieldLabel>اسم الشيخ</FieldLabel>
              <Pressable
                onPress={() => setSheikhOpen((v) => !v)}
                style={[styles.sheikhField, sheikhOpen && styles.inputFocused]}
                accessibilityRole="button"
              >
                <Feather
                  name={sheikhOpen ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
                <Txt size={14} color={selectedSheikh ? colors.textInk : colors.textGhost} style={{ flex: 1 }}>
                  {selectedSheikh?.name ?? 'اختر الشيخ...'}
                </Txt>
              </Pressable>
              {sheikhOpen && (
                <View style={styles.sheikhDropdown}>
                  {sheikhs.map((s, idx) => (
                    <React.Fragment key={s.id}>
                      <Pressable
                        onPress={() => { setSheikhId(s.id); setSheikhOpen(false); }}
                        style={({ pressed }) => [
                          styles.sheikhRow,
                          s.id === sheikhId && styles.sheikhRowSelected,
                          pressed && { backgroundColor: colors.bgSand },
                        ]}
                      >
                        <Txt size={13} color={s.id === sheikhId ? colors.primaryTeal : colors.textInk}>
                          {s.name}
                        </Txt>
                        {s.id === sheikhId && (
                          <Feather name="check" size={14} color={colors.primaryTeal} style={{ marginLeft: 8 }} />
                        )}
                      </Pressable>
                      {idx < sheikhs.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                  {sheikhs.length === 0 && (
                    <View style={{ padding: 14 }}>
                      <Txt size={13} color={colors.textGhost} align="center">
                        لا يوجد مشايخ مضافون بعد.
                      </Txt>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        </CardSection>

        {/* Card 3: Attachments — bound to the lecture once it's saved. */}
        <CardSection title="المرفقات">
          {createdLectureId ? (
            <>
              <View style={styles.attachSavedHint}>
                <Feather
                  name="check-circle"
                  size={15}
                  color={colors.stateSuccess}
                  style={{ marginLeft: 8 }}
                />
                <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
                  أضف مرفقات إلى المحاضرة التي تم حفظها.
                </Txt>
              </View>
              <AttachmentManager owner={{ kind: 'lecture', id: createdLectureId }} />
            </>
          ) : (
            <View style={styles.attachPlaceholder}>
              <Feather name="paperclip" size={26} color={colors.accentBrassMuted} />
              <Txt
                size={13}
                weight="semibold"
                color={colors.textMuted}
                align="center"
                style={{ marginTop: 10 }}
              >
                احفظ المحاضرة أولاً لإضافة المرفقات
              </Txt>
              <Txt size={11} color={colors.textGhost} align="center" style={{ marginTop: 4 }}>
                بعد الحفظ يمكنك إرفاق ملفات PDF أو كتب أو روابط أو تفريغ.
              </Txt>
            </View>
          )}
        </CardSection>
      </View>

      {/* ── Right rail ── */}
      <View style={[styles.rightRail, !narrow && styles.rightRailSticky]}>
        {/* Publish status card */}
        <Card style={styles.railCard}>
          <Txt weight="semibold" size={14} color={colors.textInk} style={styles.cardTitle}>
            حالة النشر
          </Txt>
          <PublishToggle value={publishStatus} onChange={setPublishStatus} />

          <View style={styles.metaDivider} />

          <View style={styles.metaRow}>
            <Txt size={12} color={colors.textGhost}>—</Txt>
            <Txt size={12} color={colors.textMuted}>تاريخ الإنشاء</Txt>
          </View>
          <View style={styles.metaRow}>
            <Txt size={12} color={colors.textGhost}>—</Txt>
            <Txt size={12} color={colors.textMuted}>آخر تعديل</Txt>
          </View>

          <View style={styles.metaDivider} />

          {/* Submit button */}
          <Pressable
            onPress={handleSubmit}
            disabled={createLecture.isPending || !title.trim()}
            style={({ pressed }) => [
              styles.submitBtn,
              { opacity: pressed || !title.trim() ? 0.6 : 1 },
              publishStatus === 'published' && styles.submitBtnPublished,
            ]}
          >
            <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
              {publishStatus === 'published' ? 'نشر المحاضرة' : 'حفظ كمسودة'}
            </Txt>
          </Pressable>

          {/* Preview outline button */}
          <Pressable
            style={({ pressed }) => [styles.previewBtn, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
          >
            <Txt weight="semibold" size={14} color={colors.primaryTeal}>
              معاينة
            </Txt>
          </Pressable>
        </Card>

        {/* Tip card */}
        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Rhombus size={8} color={colors.accentBrassMuted} />
            <Txt weight="semibold" size={13} color={colors.accentBrassMuted} style={{ marginRight: 8 }}>
              تلميح
            </Txt>
          </View>
          <Txt size={12} color={colors.textMuted} style={{ marginTop: 6, lineHeight: 20 }}>
            تأكد من أن رقم الترتيب يتوافق مع تسلسل الدرس داخل القسم لضمان ظهور المحاضرات بالترتيب الصحيح للطلاب.
          </Txt>
        </View>
      </View>
    </View>
  );

  return (
    <AdminShell active="upload" breadcrumb="المحاضرات / رفع محاضرة جديدة">
      {/* Page heading + top actions */}
      <View style={styles.pageHeader}>
        <View style={styles.topActions}>
          <Pressable
            onPress={handleSubmit}
            disabled={createLecture.isPending || !title.trim()}
            style={({ pressed }) => [
              styles.topSaveBtn,
              { opacity: pressed || !title.trim() ? 0.6 : 1 },
            ]}
          >
            <Txt weight="semibold" size={13} color={colors.onTealPrimary}>
              حفظ المحاضرة
            </Txt>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.7 }]}
          >
            <Txt weight="semibold" size={13} color={colors.textMuted}>
              إلغاء
            </Txt>
          </Pressable>
        </View>
        <View>
          <Txt weight="display" size={27} color={colors.primaryTeal}>
            رفع محاضرة جديدة
          </Txt>
          <Txt size={13} color={colors.textMuted} style={{ marginTop: 4 }}>
            أضف محاضرة وصنّفها في شجرة الأقسام
          </Txt>
        </View>
      </View>

      {content}
    </AdminShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pageHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  } as ViewStyle,

  topActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  } as ViewStyle,

  topSaveBtn: {
    backgroundColor: colors.primaryTeal,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.sm,
    ...shadows.button,
  } as ViewStyle,

  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
  } as ViewStyle,

  grid: {
    flexDirection: 'row-reverse',
    gap: 20,
    alignItems: 'flex-start',
  } as ViewStyle,

  gridNarrow: {
    flexDirection: 'column',
  } as ViewStyle,

  leftCol: {
    flex: 1,
    gap: 20,
  } as ViewStyle,

  rightRail: {
    width: 320,
    gap: 16,
  } as ViewStyle,

  rightRailSticky: {
    // Web sticky approximation
    position: 'sticky' as any,
    top: 30,
  } as ViewStyle,

  sectionCard: {
    gap: 0,
  } as ViewStyle,

  cardTitle: {
    marginBottom: 16,
  } as ViewStyle,

  fieldLabel: {
    marginBottom: 7,
    marginTop: 14,
  } as ViewStyle,

  titleInput: {
    height: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
  },

  titleInputFocused: {
    borderColor: colors.primaryTeal600,
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },

  audioRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.sm,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.borderHair,
  } as ViewStyle,

  audioPicker: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primaryTeal,
    borderRadius: radius.card,
    backgroundColor: 'rgba(31,74,66,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 26,
    paddingHorizontal: 20,
  } as ViewStyle,

  waveformTile: {
    width: 52,
    height: 36,
    backgroundColor: colors.primaryTeal,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 6,
  } as ViewStyle,

  waveBar: {
    width: 2.5,
    backgroundColor: colors.accentBrass,
    borderRadius: 2,
  } as ViewStyle,

  removeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  } as ViewStyle,

  twoCol: {
    flexDirection: 'row-reverse',
    gap: 12,
  } as ViewStyle,

  orderInput: {
    height: 46,
    width: 140,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textInk,
    textAlign: 'center',
  },

  inputFocused: {
    borderColor: colors.primaryTeal600,
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },

  sheikhField: {
    height: 46,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  } as ViewStyle,

  sheikhDropdown: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: colors.surfaceWhite,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderSand,
    overflow: 'hidden',
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  } as ViewStyle,

  sheikhRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 16,
  } as ViewStyle,

  sheikhRowSelected: {
    backgroundColor: 'rgba(31,74,66,0.05)',
  } as ViewStyle,

  attachPlaceholder: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentBrassSoft,
    borderRadius: radius.card,
    backgroundColor: 'rgba(176,137,79,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
  } as ViewStyle,

  attachSavedHint: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: 'rgba(31,138,91,0.09)',
    borderRadius: radius.sm,
    padding: 10,
    marginBottom: 14,
  } as ViewStyle,

  // ── Right rail ──
  railCard: {
    gap: 0,
  } as ViewStyle,

  metaDivider: {
    height: 1,
    backgroundColor: colors.borderHair,
    marginVertical: 14,
  } as ViewStyle,

  metaRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 6,
  } as ViewStyle,

  submitBtn: {
    backgroundColor: colors.primaryTeal,
    height: 46,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    ...shadows.button,
  } as ViewStyle,

  submitBtnPublished: {
    backgroundColor: colors.stateSuccess,
  } as ViewStyle,

  previewBtn: {
    height: 40,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primaryTeal,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  tipCard: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.accentBrassSoft,
    borderRadius: radius.card,
    backgroundColor: 'rgba(176,137,79,0.04)',
    padding: 16,
  } as ViewStyle,

  tipHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  } as ViewStyle,

  successBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: 'rgba(31,138,91,0.09)',
    borderRadius: radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(31,138,91,0.2)',
  } as ViewStyle,
});
