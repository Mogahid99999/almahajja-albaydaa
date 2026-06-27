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

import type { AttachmentOwnerRef, AttachmentType } from '@/api/types';
import { Card, Divider, Txt } from '@/components/ui';
import { AttachmentRow } from '@/components/attachments/AttachmentRow';
import { ATTACHMENT_META } from '@/components/attachments/attachmentMeta';
import { colors, fonts, radius, shadows } from '@/constants/theme';
import {
  useCreateAttachment,
  useDeleteAttachment,
  useLectureAttachments,
  useSectionAttachments,
} from '@/hooks/useAttachments';

const TYPES: AttachmentType[] = ['pdf', 'book', 'transcript', 'image', 'link'];

export function AttachmentManager({ owner }: { owner: AttachmentOwnerRef }) {
  // Both hooks always run (rules of hooks); the non-matching one is disabled.
  const sectionQ = useSectionAttachments(owner.kind === 'section' ? owner.id : '');
  const lectureQ = useLectureAttachments(owner.kind === 'lecture' ? owner.id : '');
  const attachments = (owner.kind === 'section' ? sectionQ.data : lectureQ.data) ?? [];

  const createAttachment = useCreateAttachment();
  const deleteAttachment = useDeleteAttachment();

  const [type, setType] = useState<AttachmentType>('pdf');
  const [title, setTitle] = useState('');
  const [payload, setPayload] = useState(''); // URL for most types, text for transcript
  const [focused, setFocused] = useState(false);

  const isTranscript = type === 'transcript';
  const canSubmit = title.trim().length > 0 && payload.trim().length > 0;

  function handleAdd() {
    if (!canSubmit) return;
    createAttachment.mutate(
      {
        owner,
        type,
        title: title.trim(),
        url: isTranscript ? null : payload.trim(),
        body: isTranscript ? payload.trim() : null,
      },
      {
        onSuccess: () => {
          setTitle('');
          setPayload('');
        },
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
                onPress={() => setType(t)}
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

        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.label}>
          {isTranscript ? 'نص التفريغ' : 'الرابط'}
        </Txt>
        <TextInput
          value={payload}
          onChangeText={setPayload}
          placeholder={isTranscript ? 'الصق نص التفريغ هنا...' : 'https://...'}
          placeholderTextColor={colors.textGhost}
          textAlign="right"
          multiline={isTranscript}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[
            isTranscript ? styles.textArea : styles.input,
            focused && styles.inputFocused,
          ]}
        />

        <Pressable
          onPress={handleAdd}
          disabled={!canSubmit || createAttachment.isPending}
          style={({ pressed }) => [
            styles.submitBtn,
            { opacity: pressed || !canSubmit ? 0.6 : 1 },
          ]}
        >
          <Feather name="plus" size={16} color={colors.onTealPrimary} style={{ marginLeft: 8 }} />
          <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
            إضافة المرفق
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
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
  } as ViewStyle,

  typeChip: {
    flexDirection: 'row-reverse',
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

  submitBtn: {
    marginTop: 20,
    backgroundColor: colors.primaryTeal,
    height: 46,
    borderRadius: radius.sm,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.button,
  } as ViewStyle,
});
