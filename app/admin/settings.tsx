/**
 * الإعدادات وعن المنصة — /admin/settings  (admin only).
 *
 * Edits the world-readable app_config keys through the admin-only DEFINER
 * set_app_config: the «عن المنصة» paragraphs, the Telegram live-broadcast
 * intro/link, and (with a loud caution) the V4 update gate. Saving one field at
 * a time keeps each write independent.
 */
import { Feather } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { Card, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { ABOUT_FALLBACK } from '@/api/appContent';
import { useAdminConfig, useSetAppConfig } from '@/hooks/useAppContent';
import { useAdminOnly } from '@/hooks/useAdminGuard';

type FieldDef = {
  key: string;
  label: string;
  multiline?: boolean;
  fallback?: string;
  placeholder?: string;
};

const ABOUT_FIELDS: FieldDef[] = [
  { key: 'about_intro', label: 'مقدمة المنصة', multiline: true, fallback: ABOUT_FALLBACK.intro },
  { key: 'about_dua', label: 'دعاء الإخلاص', multiline: true, fallback: ABOUT_FALLBACK.dua },
  { key: 'about_thanks', label: 'شكر المساهمين', multiline: true, fallback: ABOUT_FALLBACK.thanks },
  { key: 'about_closing', label: 'خاتمة', multiline: true, fallback: ABOUT_FALLBACK.closing },
];

const TELEGRAM_FIELDS: FieldDef[] = [
  { key: 'telegram_intro', label: 'فقرة تلجرام', multiline: true, fallback: ABOUT_FALLBACK.telegramIntro },
  { key: 'telegram_url', label: 'رابط القناة (يُخفى الزر إن تُرك فارغًا)', placeholder: 'https://t.me/...' },
  { key: 'telegram_label', label: 'نص الزر', fallback: ABOUT_FALLBACK.telegramLabel },
];

const SUPPORT_FIELDS: FieldDef[] = [
  {
    key: 'support_whatsapp_url',
    label: 'رابط الدعم عبر واتساب (يُخفى الزر إن تُرك فارغًا)',
    placeholder: 'https://wa.me/9665XXXXXXXX',
  },
];

const QNA_FIELDS: FieldDef[] = [
  {
    key: 'qna_notice_text',
    label: 'ملاحظة صفحتي الأسئلة (العامة وأسئلة الدرس)',
    multiline: true,
  },
];

const REPORTS_FIELDS: FieldDef[] = [
  {
    key: 'admin_notify_email',
    label: 'البريد الإلكتروني لإشعارات البلاغات (يُترك فارغاً لتعطيل التنبيه بالبريد)',
    placeholder: 'admin@example.com',
  },
];

const APP_FIELDS: FieldDef[] = [
  { key: 'min_app_version', label: 'أدنى إصدار مدعوم', placeholder: '1.0.0' },
  { key: 'app_download_url', label: 'رابط تنزيل التحديث', placeholder: 'https://...' },
];

const RELEASE_FIELDS: FieldDef[] = [
  { key: 'latest_app_version', label: 'أحدث إصدار منشور', placeholder: '1.1.0' },
  { key: 'latest_released_at', label: 'تاريخ إصدار آخر تحديث (YYYY-MM-DD)', placeholder: '2026-07-06' },
];

function ConfigField({
  def,
  value,
  onChange,
  onSave,
  saving,
}: {
  def: FieldDef;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Txt size={12} color={colors.textMuted}>
        {def.label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={def.placeholder ?? def.fallback}
        placeholderTextColor={colors.textGhost}
        multiline={def.multiline}
        autoCapitalize="none"
        style={[styles.input, def.multiline && styles.inputMultiline]}
      />
      <Pressable
        onPress={onSave}
        disabled={saving}
        style={({ pressed }) => [styles.saveBtn, (saving || pressed) && { opacity: 0.7 }]}
      >
        <Feather name="save" size={13} color={colors.onTealPrimary} />
        <Txt size={12} weight="semibold" color={colors.onTealPrimary}>
          حفظ
        </Txt>
      </Pressable>
    </View>
  );
}

export default function AdminSettings() {
  useAdminOnly();
  const { data: config } = useAdminConfig();
  const save = useSetAppConfig();
  const [form, setForm] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Seed the form once config arrives (fallbacks fill empty keys).
  useEffect(() => {
    if (!config) return;
    const all = [
      ...ABOUT_FIELDS,
      ...TELEGRAM_FIELDS,
      ...SUPPORT_FIELDS,
      ...QNA_FIELDS,
      ...REPORTS_FIELDS,
      ...APP_FIELDS,
      ...RELEASE_FIELDS,
    ];
    const next: Record<string, string> = {};
    for (const f of all) next[f.key] = config[f.key] ?? f.fallback ?? '';
    setForm(next);
  }, [config]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const saveKey = (key: string) => {
    save.mutate(
      { key, value: form[key] ?? '' },
      {
        onSuccess: () => flash('تم الحفظ'),
        onError: (e) => Alert.alert('تعذّر الحفظ', (e as Error).message),
      },
    );
  };

  const renderFields = (defs: FieldDef[]) =>
    defs.map((def) => (
      <ConfigField
        key={def.key}
        def={def}
        value={form[def.key] ?? ''}
        onChange={(v) => setForm((f) => ({ ...f, [def.key]: v }))}
        onSave={() => saveKey(def.key)}
        saving={save.isPending}
      />
    ));

  return (
    <AdminShell active="settings" breadcrumb="الإعدادات وعن المنصة">
      <Txt weight="display" size={26} color={colors.primaryTeal} style={{ marginBottom: 4 }}>
        الإعدادات وعن المنصة
      </Txt>
      <Txt size={13} color={colors.textMuted} style={{ marginBottom: 20 }}>
        نصوص صفحة «عن المنصة» ورابط البث المباشر
      </Txt>

      {notice && (
        <View style={styles.notice}>
          <Feather name="check" size={14} color={colors.stateSuccess} />
          <Txt size={12} color={colors.stateSuccess}>
            {notice}
          </Txt>
        </View>
      )}

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        عن المنصة
      </Txt>
      <Card style={{ gap: 18 }}>{renderFields(ABOUT_FIELDS)}</Card>

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        البث المباشر على تلجرام
      </Txt>
      <Card style={{ gap: 18 }}>{renderFields(TELEGRAM_FIELDS)}</Card>

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        الدعم الفني
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ marginBottom: 12 }}>
        يظهر رابط التواصل عبر واتساب أسفل شاشة تسجيل الدخول.
      </Txt>
      <Card style={{ gap: 18 }}>{renderFields(SUPPORT_FIELDS)}</Card>

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        صفحتا الأسئلة
      </Txt>
      <Card style={{ gap: 18 }}>{renderFields(QNA_FIELDS)}</Card>

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        إشعارات البلاغات
      </Txt>
      <Card style={{ gap: 18 }}>{renderFields(REPORTS_FIELDS)}</Card>

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        إعدادات التطبيق
      </Txt>
      <View style={styles.caution}>
        <Feather name="alert-triangle" size={14} color={colors.accentBrassMuted} />
        <Txt size={12} color={colors.textMuted} style={{ flex: 1 }}>
          لا ترفع «أدنى إصدار مدعوم» فوق إصدار التطبيق المثبَّت لدى المستخدمين، فسيُقفل الدخول عليهم جميعًا.
        </Txt>
      </View>
      <Card style={{ gap: 18 }}>{renderFields(APP_FIELDS)}</Card>

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        تتبّع الإصدار الأخير
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ marginBottom: 12 }}>
        عند رفع بناء جديد، سجّل رقم إصداره وتاريخه هنا. سيظهر إشعار لطيف للمستخدمين على
        إصدار أقدم، ثم يُطلب منهم التحديث تلقائيًا إن مرّت 30 يومًا دون أن يحدّثوا.
      </Txt>
      <Card style={{ gap: 18, marginBottom: 24 }}>{renderFields(RELEASE_FIELDS)}</Card>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: 12, marginTop: 20 } as TextStyle,

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(31,138,91,0.1)',
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 8,
  } as ViewStyle,

  caution: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(201,164,99,0.12)',
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 12,
  } as ViewStyle,

  input: {
    fontFamily: 'IBMPlexSansArabic_400Regular',
    fontSize: 14,
    color: colors.textInk,
    textAlign: 'right',
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  } as TextStyle,

  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
    lineHeight: 24,
  } as TextStyle,

  saveBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 18,
    borderRadius: radius.input,
    backgroundColor: colors.primaryTeal,
    justifyContent: 'center',
  } as ViewStyle,
});
