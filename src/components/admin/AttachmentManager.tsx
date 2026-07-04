/**
 * AttachmentManager (admin) — list + add + remove attachments for one owner
 * (a section node OR a lecture). Mounted in the sections screen; reusable from
 * any future per-lecture editor by passing a different `owner`.
 *
 * Add form: type chips (PDF/كتاب/تفريغ/صورة/رابط) + title + a URL field (or a
 * transcript-text area for تفريغ). Mock-backed now; same hooks drive live later.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';

import { uploadAttachmentFile, type PickedAttachmentFile } from '@/api/attachments';
import type { AttachmentOwnerRef, AttachmentType } from '@/api/types';
import { Card, Divider, Txt } from '@/components/ui';
import { AttachmentRow } from '@/components/attachments/AttachmentRow';
import { ATTACHMENT_META } from '@/components/attachments/attachmentMeta';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import { getDocumentAsync } from '@/lib/documentPicker';
import {
  useAdminAttachments,
  useCreateAttachment,
  useDeleteAttachment,
  useReorderAttachments,
} from '@/hooks/useAttachments';

const TYPES: AttachmentType[] = ['pdf', 'book', 'transcript', 'image', 'link'];

/** What payload sources each attachment type accepts (first = default). */
type Source = 'file' | 'link' | 'text';
const SOURCES: Record<AttachmentType, Source[]> = {
  pdf: ['file', 'link'],
  image: ['file', 'link'],
  book: ['link', 'file'],
  transcript: ['text', 'file'],
  link: ['link'],
};
const SOURCE_LABEL: Record<Source, string> = { file: 'ملف', link: 'رابط', text: 'نص' };

/** expo-document-picker MIME filter per type. */
function pickerMime(type: AttachmentType): string {
  if (type === 'pdf') return 'application/pdf';
  if (type === 'image') return 'image/*';
  return '*/*';
}

export function AttachmentManager({ owner }: { owner: AttachmentOwnerRef }) {
  const { data: attachments = [] } = useAdminAttachments(owner);

  const createAttachment = useCreateAttachment();
  const deleteAttachment = useDeleteAttachment();
  const reorderAttachments = useReorderAttachments();

  const [type, setType] = useState<AttachmentType>('pdf');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<Source>('file');
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<PickedAttachmentFile | null>(null);
  const [focused, setFocused] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  function chooseType(t: AttachmentType) {
    setType(t);
    setSource(SOURCES[t][0]);
    setLink('');
    setText('');
    setFile(null);
    setError('');
  }

  const payloadReady =
    source === 'file' ? !!file : source === 'link' ? link.trim().length > 0 : text.trim().length > 0;
  const busy = uploading || createAttachment.isPending;
  const canSubmit = title.trim().length > 0 && payloadReady && !busy;

  /** Move an attachment between positions and persist the new order. */
  function move(from: number, to: number) {
    const orderedIds = attachments.map((a) => a.id);
    const [moved] = orderedIds.splice(from, 1);
    orderedIds.splice(to, 0, moved);
    reorderAttachments.mutate({ owner, orderedIds });
  }

  async function pickFile() {
    setError('');
    // getDocumentAsync is platform-resolved (src/lib/documentPicker): static on
    // web (no fragile async chunk → no "Failed to fetch"), lazy on native.
    const res = await getDocumentAsync({
      type: pickerMime(type),
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    setFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
  }

  async function handleAdd() {
    if (!canSubmit) return;
    setError('');
    let storagePath: string | null = null;
    if (source === 'file' && file) {
      setUploading(true);
      try {
        storagePath = await uploadAttachmentFile(file);
      } catch {
        setUploading(false);
        setError('تعذّر رفع الملف. حاول مجدداً.');
        return;
      }
      setUploading(false);
    }
    createAttachment.mutate(
      {
        owner,
        type,
        title: title.trim(),
        url: source === 'link' ? link.trim() : null,
        body: source === 'text' ? text.trim() : null,
        storagePath,
      },
      {
        onSuccess: () => {
          setTitle('');
          setLink('');
          setText('');
          setFile(null);
        },
        onError: () => setError('تعذّر إضافة المرفق.'),
      },
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {/* Existing attachments */}
      {attachments.length === 0 ? (
        <View style={styles.empty}>
          <Txt size={13} color={colors.textGhost} align="center">
            لا توجد مرفقات لهذا العنصر بعد.
          </Txt>
        </View>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {attachments.map((attachment, index) => (
            <View key={attachment.id}>
              {index > 0 ? <Divider /> : null}
              <AttachmentRow
                attachment={attachment}
                onRemove={() => deleteAttachment.mutate({ id: attachment.id, owner })}
                onMoveUp={index > 0 ? () => move(index, index - 1) : undefined}
                onMoveDown={
                  index < attachments.length - 1 ? () => move(index, index + 1) : undefined
                }
              />
            </View>
          ))}
        </Card>
      )}

      {/* Add form */}
      <Card style={{ gap: 0 }}>
        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
          نوع المرفق
        </Txt>
        <View style={styles.typeRow}>
          {TYPES.map((t) => {
            const meta = ATTACHMENT_META[t];
            const active = t === type;
            return (
              <Pressable
                key={t}
                onPress={() => chooseType(t)}
                style={[styles.typeChip, active && styles.typeChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Feather
                  name={meta.icon}
                  size={14}
                  color={active ? colors.onTealPrimary : colors.textMuted}
                />
                <Txt
                  size={12}
                  weight="medium"
                  color={active ? colors.onTealPrimary : colors.textMuted}
                >
                  {meta.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
          العنوان
        </Txt>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="عنوان المرفق..."
          placeholderTextColor={colors.textGhost}
          textAlign="right"
          style={styles.input}
        />

        {/* Source toggle (file / link / text) when the type allows more than one */}
        {SOURCES[type].length > 1 ? (
          <>
            <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
              المصدر
            </Txt>
            <View style={styles.sourceRow}>
              {SOURCES[type].map((s) => {
                const active = s === source;
                return (
                  <Pressable
                    key={s}
                    onPress={() => {
                      setSource(s);
                      setError('');
                    }}
                    style={[styles.sourceBtn, active && styles.sourceBtnActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Txt size={12} weight="semibold" color={active ? colors.onTealPrimary : colors.textMuted}>
                      {SOURCE_LABEL[s]}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Payload, per source */}
        {source === 'file' ? (
          <>
            <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
              الملف
            </Txt>
            {file ? (
              <View style={styles.fileRow}>
                <Feather name="file" size={16} color={colors.primaryTeal} style={{ marginLeft: 10 }} />
                <Txt size={13} color={colors.textInk} numberOfLines={1} style={{ flex: 1 }}>
                  {file.name}
                </Txt>
                <Pressable onPress={() => setFile(null)} accessibilityLabel="إزالة الملف" style={styles.fileRemove}>
                  <Feather name="x" size={14} color={colors.stateDanger} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={pickFile}
                style={({ pressed }) => [styles.dropzone, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
              >
                <Feather name="upload-cloud" size={22} color={colors.primaryTeal} />
                <Txt size={13} weight="semibold" color={colors.primaryTeal} style={{ marginTop: 6 }}>
                  اختر ملفاً
                </Txt>
                <Txt size={11} color={colors.textGhost} style={{ marginTop: 3 }}>
                  {type === 'image' ? 'صورة' : type === 'pdf' ? 'ملف PDF' : 'أي ملف'}
                </Txt>
              </Pressable>
            )}
          </>
        ) : source === 'text' ? (
          <>
            <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
              نص التفريغ
            </Txt>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="الصق نص التفريغ هنا..."
              placeholderTextColor={colors.textGhost}
              textAlign="right"
              multiline
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[styles.textArea, focused && styles.inputFocused]}
            />
          </>
        ) : (
          <>
            <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
              الرابط
            </Txt>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="https://..."
              placeholderTextColor={colors.textGhost}
              textAlign="right"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[styles.input, focused && styles.inputFocused]}
            />
          </>
        )}

        {error ? (
          <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8 }}>
            {error}
          </Txt>
        ) : null}

        <Pressable
          onPress={handleAdd}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submitBtn,
            { opacity: pressed || !canSubmit ? 0.6 : 1 },
          ]}
        >
          <Feather name="plus" size={16} color={colors.onTealPrimary} style={{ marginLeft: 8 }} />
          <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
            {uploading ? 'جارٍ الرفع...' : 'إضافة المرفق'}
          </Txt>
        </Pressable>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: 20,
    alignItems: 'center',
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderHair,
  } as ViewStyle,

  label: {
    marginBottom: 8,
    marginTop: 14,
  } as ViewStyle,

  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,

  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  typeChipActive: {
    backgroundColor: colors.primaryTeal,
    borderColor: colors.primaryTeal,
  } as ViewStyle,

  input: {
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

  textArea: {
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textInk,
    minHeight: 100,
  },

  inputFocused: {
    borderColor: colors.primaryTeal600,
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },

  sourceRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.input,
    padding: 4,
  } as ViewStyle,

  sourceBtn: {
    flex: 1,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  sourceBtnActive: {
    backgroundColor: colors.primaryTeal,
  } as ViewStyle,

  dropzone: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.primaryTeal,
    borderRadius: radius.card,
    backgroundColor: 'rgba(31,74,66,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 22,
  } as ViewStyle,

  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderHair,
    paddingVertical: 10,
    paddingHorizontal: 12,
  } as ViewStyle,

  fileRemove: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  submitBtn: {
    marginTop: 20,
    backgroundColor: colors.primaryTeal,
    height: 46,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,
});
