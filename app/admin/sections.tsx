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
  StyleSheet,
  Switch,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { TreePicker } from '@/components/admin/TreePicker';
import { Card, Divider, Rhombus, Txt } from '@/components/ui';
import { colors, fonts, radius, shadows, spacing } from '@/constants/theme';
import { useCreateSection } from '@/hooks/useAdmin';
import { useSectionsFlat } from '@/hooks/useSections';
import { arNum } from '@/lib/format';
import type { FlatSectionNode } from '@/api/types';

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
  const createSection = useCreateSection();

  // Form state
  const [newTitle, setNewTitle] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [showHeader, setShowHeader] = useState(true);
  const [titleFocused, setTitleFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

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
});
