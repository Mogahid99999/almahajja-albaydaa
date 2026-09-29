/**
 * الإعدادات وعن المنصة — /admin/settings  (admin only).
 *
 * Edits the world-readable app_config keys through the admin-only DEFINER
 * set_app_config: the «عن المنصة» paragraphs, the Telegram live-broadcast
 * intro/link, and (with a loud caution) the V4 update gate. Saving one field at
 * a time keeps each write independent.
 *
 * V23 P7: the in-app «البث المباشر» rollout flag (app_config.live_enabled —
 * «متوقف» / «للمشرفين فقط» / «للجميع», migration 0145). One tap saves it through
 * the same set_app_config; «للجميع» asks first (every student and guest sees it
 * and gets the «بدأ البث المباشر» push). The server enforces it (get_live_now,
 * create_live_session, live-token …) — this screen only sets it.
 */
import Feather from '@expo/vector-icons/Feather';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View, type TextStyle, type ViewStyle } from 'react-native';

import { AdminShell } from '@/components/admin/AdminShell';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { Card, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import {
  ABOUT_FALLBACK,
  LIVE_ENABLED_KEY,
  parseLiveEnabledLevel,
  type LiveEnabledLevel,
} from '@/api/appContent';
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

const SHARE_FIELDS: FieldDef[] = [
  { key: 'share_app_url', label: 'رابط التطبيق', placeholder: 'https://almahajja.app' },
  {
    key: 'share_app_message',
    label: 'نص المشاركة',
    multiline: true,
    fallback: 'جرّب تطبيق المحجة البيضاء لدروس العلم الشرعي',
  },
];

const START_HERE_FIELDS: FieldDef[] = [
  {
    key: 'start_here_lecture_id',
    label: 'معرّف محاضرة «ابدأ من هنا» (تُخفى النافذة إن تُرك فارغًا)',
    placeholder: 'معرّف المحاضرة (UUID)',
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

const LIVE_LEVELS: { level: LiveEnabledLevel; label: string; hint: string }[] = [
  {
    level: 'off',
    label: 'متوقف',
    hint: 'لا يظهر البث المباشر لأحد، ولا يمكن فتح مجلس جديد.',
  },
  {
    level: 'staff',
    label: 'للمشرفين فقط',
    hint: 'للتجربة: يراه المشرفون والناشرون والمشايخ وحدهم، ولا يصل الطلاب منه شيء ولا إشعار.',
  },
  {
    level: 'all',
    label: 'للجميع',
    hint: 'يظهر لجميع الطلاب والزوار، ويصلهم إشعار عند بدء كل مجلس.',
  },
];

/** «البث المباشر» rollout: three calm choices, one tap saves («للجميع» asks first). */
function LiveRolloutControl({
  value,
  disabled,
  onChoose,
}: {
  value: LiveEnabledLevel;
  disabled: boolean;
  onChoose: (level: LiveEnabledLevel) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
      {LIVE_LEVELS.map((opt) => {
        const selected = opt.level === value;
        return (
          <Pressable
            key={opt.level}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            onPress={() => {
              if (!selected) onChoose(opt.level);
            }}
            disabled={disabled}
            style={({ pressed }) => [
              styles.levelRow,
              selected && styles.levelRowOn,
              (pressed || (disabled && !selected)) && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.radio, selected && styles.radioOn]}>
              {selected && <View style={styles.radioDot} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt weight="semibold" size={14} color={selected ? colors.primaryTeal : colors.textInk}>
                {opt.label}
              </Txt>
              <Txt size={12} color={colors.textMuted} style={{ lineHeight: 20 }}>
                {opt.hint}
              </Txt>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

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
  const [liveLevel, setLiveLevel] = useState<LiveEnabledLevel>('off');
  const [confirmAll, setConfirmAll] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  // Seed the form once config arrives (fallbacks fill empty keys).
  useEffect(() => {
    if (!config) return;
    const all = [
      ...ABOUT_FIELDS,
      ...TELEGRAM_FIELDS,
      ...SUPPORT_FIELDS,
      ...SHARE_FIELDS,
      ...START_HERE_FIELDS,
      ...QNA_FIELDS,
      ...REPORTS_FIELDS,
      ...APP_FIELDS,
      ...RELEASE_FIELDS,
    ];
    const next: Record<string, string> = {};
    for (const f of all) next[f.key] = config[f.key] ?? f.fallback ?? '';
    setForm(next);
    setLiveLevel(parseLiveEnabledLevel(config[LIVE_ENABLED_KEY]));
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

  const saveLiveLevel = (level: LiveEnabledLevel) => {
    const previous = liveLevel;
    setLiveError(null);
    setLiveLevel(level);
    save.mutate(
      { key: LIVE_ENABLED_KEY, value: level },
      {
        onSuccess: () => {
          setConfirmAll(false);
          flash('تم الحفظ');
        },
        onError: () => {
          setConfirmAll(false);
          setLiveLevel(previous);
          setLiveError('تعذّر حفظ إعداد البث المباشر، أعد المحاولة.');
        },
      },
    );
  };

  const chooseLiveLevel = (level: LiveEnabledLevel) => {
    if (level === 'all') setConfirmAll(true);
    else saveLiveLevel(level);
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
        البث المباشر
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ marginBottom: 12 }}>
        من يرى «البث المباشر» في التطبيق. يسري التغيير دون تحديث للتطبيق.
      </Txt>
      <Card style={{ gap: 12 }}>
        <LiveRolloutControl
          value={liveLevel}
          disabled={!config || save.isPending}
          onChoose={chooseLiveLevel}
        />
        {liveError && (
          <Txt size={12} color={colors.stateDanger}>
            {liveError}
          </Txt>
        )}
      </Card>
      <ConfirmDialog
        visible={confirmAll}
        title="إتاحة البث المباشر للجميع؟"
        message="سيظهر البث المباشر لجميع الطلاب والزوار، ويصلهم إشعار عند بدء كل مجلس."
        confirmLabel="إتاحة للجميع"
        cancelLabel="إلغاء"
        destructive={false}
        pending={save.isPending}
        onConfirm={() => saveLiveLevel('all')}
        onCancel={() => setConfirmAll(false)}
      />

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
        مشاركة التطبيق
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ marginBottom: 12 }}>
        الرابط والنص المستخدمان في زر «شارك التطبيق» بصفحة الحساب.
      </Txt>
      <Card style={{ gap: 18 }}>{renderFields(SHARE_FIELDS)}</Card>

      <Txt weight="semibold" size={15} color={colors.textInk} style={styles.heading}>
        محاضرة «ابدأ من هنا»
      </Txt>
      <Txt size={12} color={colors.textMuted} style={{ marginBottom: 12 }}>
        المحاضرة المقترحة على الطالب الجديد بعد انتهاء الجولة التعريفية (أو تخطّيها).
      </Txt>
      <Card style={{ gap: 18 }}>{renderFields(START_HERE_FIELDS)}</Card>

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

  levelRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.borderSand,
    backgroundColor: colors.surfaceWhite,
  } as ViewStyle,

  levelRowOn: {
    borderColor: colors.primaryTeal,
    backgroundColor: 'rgba(31,74,66,0.06)',
  } as ViewStyle,

  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.borderSand2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  } as ViewStyle,

  radioOn: {
    borderColor: colors.primaryTeal,
  } as ViewStyle,

  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryTeal,
  } as ViewStyle,

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
