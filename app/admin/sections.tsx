/**
 * Admin sections tree screen — /admin/sections
 *
 * Shows the full nested section tree (from useSectionsFlat), indented by depth
 * with rhombus bullets matching TreePicker's style. Below the tree, an
 * "إضافة قسم" form with title, parent TreePicker (allowNull), description,
 * and a "إظهار الهيدر" toggle → useCreateSection().mutate(...)
 */
import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { AttachmentManager } from '@/components/admin/AttachmentManager';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows, spacing } from '@/constants/theme';
import { useAdminLectures, useCreateSection } from '@/hooks/useAdmin';
import { useSectionsFlat } from '@/hooks/useSections';
import { arNum } from '@/lib/format';
import type { AttachmentOwnerRef, FlatSectionNode } from '@/api/types';

// ─── Tree display ─────────────────────────────────────────────────────────────

function SectionTreeRow({ node }: { node: FlatSectionNode }) {
  return (
    <View
      style={[
        styles.treeRow,
        { paddingRight: 12 + node.depth * 20 },
      ]}
    >
      <View style={styles.treeBullet}>
        {node.depth === 0 ? (
          <Rhombus size={8} color={colors.primaryTeal} filled />
        ) : (
          <Rhombus size={8} color={colors.accentBrass} filled={false} />
        )}
      </View>
      <Txt
        size={node.depth === 0 ? 14 : 13}
        weight={node.depth === 0 ? 'semibold' : 'regular'}
        color={node.depth === 0 ? colors.textInk : colors.textMuted}
        style={{ flex: 1 }}
      >
        {node.title}
      </Txt>
      <Txt size={11} color={colors.textGhost}>
        {node.path.slice(0, -1).join(' › ')}
      </Txt>
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SectionsScreen() {
  const { data: sections = [], isLoading } = useSectionsFlat();
  const { data: adminLectures = [] } = useAdminLectures();
  const createSection = useCreateSection();

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [showHeader, setShowHeader] = useState(true);
  const [titleFocused, setTitleFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Attachments manager — pick an owner (section node or lecture)
  const [ownerKind, setOwnerKind] = useState<'section' | 'lecture'>('section');
  const [attSectionId, setAttSectionId] = useState<string | null>(null);
  const [attLectureId, setAttLectureId] = useState<string | null>(null);
  const [lectureOpen, setLectureOpen] = useState(false);

  const owner: AttachmentOwnerRef | null =
    ownerKind === 'section'
      ? attSectionId
        ? { kind: 'section', id: attSectionId }
        : null
      : attLectureId
        ? { kind: 'lecture', id: attLectureId }
        : null;
  const selectedLecture = attLectureId
    ? adminLectures.find((l) => l.id === attLectureId) ?? null
    : null;

  function handleAddSection() {
    if (!newTitle.trim()) return;
    createSection.mutate(
      {
        title: newTitle.trim(),
        parentId,
        description: description.trim() || null,
        showHeader,
      },
      {
        onSuccess: () => {
          setSuccessMsg(`تم إضافة القسم "${newTitle.trim()}" بنجاح.`);
          setNewTitle('');
          setParentId(null);
          setDescription('');
          setShowHeader(true);
        },
      },
    );
  }

  return (
    <AdminShell active="sections" breadcrumb="الأقسام والشجرة">
      {/* Page heading */}
      <Txt weight="display" size={27} color={colors.primaryTeal} style={styles.pageTitle}>
        الأقسام والشجرة
      </Txt>
      <Txt size={13} color={colors.textMuted} style={styles.pageSubtitle}>
        {arNum(sections.length)} قسم · استعرض الهيكل أو أضف قسماً جديداً
      </Txt>

      {/* Tree card */}
      <Card padded={false} style={styles.treeCard}>
        {isLoading && (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Txt size={13} color={colors.textGhost}>جارٍ التحميل...</Txt>
          </View>
        )}
        {!isLoading && sections.length === 0 && (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Txt size={13} color={colors.textGhost}>لا توجد أقسام بعد. أضف القسم الأول أدناه.</Txt>
          </View>
        )}
        {sections.map((node, idx) => (
          <React.Fragment key={node.id}>
            <SectionTreeRow node={node} />
            {idx < sections.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </Card>

      {/* Add section form */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.formHeading}>
        إضافة قسم / عنصر
      </Txt>

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

      <Card style={styles.formCard}>
        {/* Title */}
        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
          اسم القسم *
        </Txt>
        <TextInput
          value={newTitle}
          onChangeText={setNewTitle}
          placeholder="مثال: العقيدة، التوحيد، شرح الأصول الثلاثة..."
          placeholderTextColor={colors.textGhost}
          onFocus={() => setTitleFocused(true)}
          onBlur={() => setTitleFocused(false)}
          textAlign="right"
          style={[styles.textInput, titleFocused && styles.inputFocused]}
        />

        {/* Parent picker */}
        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
          القسم الأب (اتركه فارغاً للمستوى الأعلى)
        </Txt>
        <TreePicker
          value={parentId}
          onChange={setParentId}
          allowNull
          label="— المستوى الأعلى —"
        />

        {/* Description */}
        <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
          وصف القسم (اختياري)
        </Txt>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="وصف مختصر للقسم..."
          placeholderTextColor={colors.textGhost}
          multiline
          numberOfLines={3}
          onFocus={() => setDescFocused(true)}
          onBlur={() => setDescFocused(false)}
          textAlign="right"
          style={[styles.textArea, descFocused && styles.inputFocused]}
        />

        {/* Show header toggle */}
        <View style={styles.toggleRow}>
          <Switch
            value={showHeader}
            onValueChange={setShowHeader}
            thumbColor={showHeader ? colors.primaryTeal : colors.textGhost}
            trackColor={{ false: colors.surfaceTrack, true: 'rgba(31,74,66,0.3)' }}
          />
          <View style={{ flex: 1, marginRight: 12 }}>
            <Txt size={13} weight="semibold" color={colors.textInk}>
              إظهار الهيدر
            </Txt>
            <Txt size={12} color={colors.textMuted} style={{ marginTop: 2 }}>
              يعرض شريط العنوان للقسم في تطبيق الطالب
            </Txt>
          </View>
        </View>

        {/* Submit */}
        <Pressable
          onPress={handleAddSection}
          disabled={createSection.isPending || !newTitle.trim()}
          style={({ pressed }) => [
            styles.submitBtn,
            { opacity: pressed || !newTitle.trim() ? 0.6 : 1 },
          ]}
        >
          <Feather name="plus" size={16} color={colors.onTealPrimary} style={{ marginLeft: 8 }} />
          <Txt weight="semibold" size={14} color={colors.onTealPrimary}>
            إضافة القسم
          </Txt>
        </Pressable>
      </Card>

      {/* ── Attachments management (PRD §13) ──────────────────────────────────── */}
      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.attHeading}>
        إدارة المرفقات
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ marginBottom: 12 }}>
        أضف ملفات PDF أو كتباً أو تفريغات أو صوراً أو روابط إلى قسم أو درس.
      </Txt>

      <Card style={styles.formCard}>
        {/* Owner-kind toggle */}
        <View style={styles.ownerToggle}>
          {(['section', 'lecture'] as const).map((kind) => {
            const active = ownerKind === kind;
            return (
              <Pressable
                key={kind}
                onPress={() => setOwnerKind(kind)}
                style={[styles.ownerToggleBtn, active && styles.ownerToggleBtnActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Txt
                  size={13}
                  weight="semibold"
                  color={active ? colors.onTealPrimary : colors.textMuted}
                >
                  {kind === 'section' ? 'قسم' : 'درس'}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        {ownerKind === 'section' ? (
          <>
            <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
              اختر القسم
            </Txt>
            <TreePicker value={attSectionId} onChange={setAttSectionId} label="اختر القسم..." />
          </>
        ) : (
          <>
            <Txt weight="semibold" size={13} color={colors.textSlate} style={styles.fieldLabel}>
              اختر الدرس
            </Txt>
            <Pressable
              onPress={() => setLectureOpen((v) => !v)}
              style={[styles.lectureField, lectureOpen && styles.inputFocused]}
              accessibilityRole="button"
            >
              <Feather
                name={lectureOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
              <Txt
                size={14}
                color={selectedLecture ? colors.textInk : colors.textGhost}
                style={{ flex: 1 }}
                numberOfLines={1}
              >
                {selectedLecture?.title ?? 'اختر الدرس...'}
              </Txt>
            </Pressable>
            {lectureOpen && (
              <Card padded={false} style={styles.lectureDropdown}>
                <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
                  {adminLectures.map((l, idx) => (
                    <React.Fragment key={l.id}>
                      <Pressable
                        onPress={() => {
                          setAttLectureId(l.id);
                          setLectureOpen(false);
                        }}
                        style={({ pressed }) => [
                          styles.lectureRow,
                          pressed && { backgroundColor: colors.bgSand },
                        ]}
                      >
                        <Txt
                          size={13}
                          color={l.id === attLectureId ? colors.primaryTeal : colors.textInk}
                          weight={l.id === attLectureId ? 'semibold' : 'regular'}
                          numberOfLines={1}
                          style={{ flex: 1 }}
                        >
                          {l.title}
                        </Txt>
                        {l.sectionTitle ? (
                          <Txt size={11} color={colors.textGhost} numberOfLines={1}>
                            {l.sectionTitle}
                          </Txt>
                        ) : null}
                      </Pressable>
                      {idx < adminLectures.length - 1 && <Divider />}
                    </React.Fragment>
                  ))}
                </ScrollView>
              </Card>
            )}
          </>
        )}

        {/* Manager for the chosen owner */}
        <View style={{ marginTop: 18 }}>
          {owner ? (
            <AttachmentManager owner={owner} />
          ) : (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <Txt size={13} color={colors.textGhost} align="center">
                اختر {ownerKind === 'section' ? 'قسماً' : 'درساً'} لإدارة مرفقاته.
              </Txt>
            </View>
          )}
        </View>
      </Card>
    </AdminShell>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pageTitle: {
    marginBottom: 4,
  } as ViewStyle,

  pageSubtitle: {
    marginBottom: 20,
  } as ViewStyle,

  treeCard: {
    marginBottom: 32,
    overflow: 'hidden',
  } as ViewStyle,

  treeRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 11,
    paddingLeft: 16,
    minHeight: 42,
  } as ViewStyle,

  treeBullet: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  } as ViewStyle,

  formHeading: {
    marginBottom: 12,
  } as ViewStyle,

  formCard: {
    gap: 0,
  } as ViewStyle,

  fieldLabel: {
    marginBottom: 8,
    marginTop: 16,
  } as ViewStyle,

  textInput: {
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

  inputFocused: {
    borderColor: colors.primaryTeal600,
    shadowColor: colors.primaryTeal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
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
    minHeight: 80,
  },

  toggleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 4,
  } as ViewStyle,

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

  successBanner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: 'rgba(31,138,91,0.09)',
    borderRadius: radius.sm,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(31,138,91,0.2)',
    marginBottom: 16,
  } as ViewStyle,

  attHeading: {
    marginTop: 36,
    marginBottom: 4,
  } as ViewStyle,

  ownerToggle: {
    flexDirection: 'row-reverse',
    gap: 8,
    backgroundColor: colors.bgSandRaised,
    borderRadius: radius.input,
    padding: 4,
  } as ViewStyle,

  ownerToggleBtn: {
    flex: 1,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,

  ownerToggleBtnActive: {
    backgroundColor: colors.primaryTeal,
  } as ViewStyle,

  lectureField: {
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

  lectureDropdown: {
    marginTop: 8,
    overflow: 'hidden',
  } as ViewStyle,

  lectureRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
  } as ViewStyle,
});
