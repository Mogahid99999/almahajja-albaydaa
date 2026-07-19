/**
 * RestoreSection — the destructive restore flow for app/admin/backup.tsx.
 *
 * Kept in its own component because the flow has several gated stages (§19):
 *   pick file → inspect (validate + compat) → warning → re-auth → typed
 *   confirmation (+ pre-restore safety backup) → run (staged, streamed) →
 *   verification result.
 *
 * When RESTORE_ENABLED is false (v1, until staging passes) the whole section
 * renders a "disabled until tested" notice and never lets a restore start.
 */
import Feather from '@expo/vector-icons/Feather';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, ProgressBar, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import { useCurrentUser } from '@/hooks/useAuth';
import {
  RESTORE_CONFIRM_PHRASE,
  RESTORE_ENABLED,
  useCreateBackup,
  useRestore,
} from '@/hooks/useBackup';
import { checkCompatibility } from '@/lib/backupValidate';
import { arFileSize, arNum } from '@/lib/format';

const PHASE_LABEL: Record<string, string> = {
  staging: 'رفع الملفات إلى التخزين المؤقت…',
  validating: 'التحقّق من الملفات المؤقتة…',
  database: 'استعادة قاعدة البيانات…',
  activating: 'تفعيل الملفات…',
  cleanup: 'تنظيف…',
  verifying: 'المراجعة بعد الاستعادة…',
  done: 'اكتمل',
};

export function RestoreSection() {
  const { data: user } = useCurrentUser();
  const restore = useRestore();
  const safetyBackup = useCreateBackup();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickedFile = useRef<File | null>(null);

  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [wantSafety, setWantSafety] = useState(true);
  const [localErr, setLocalErr] = useState<string | null>(null);

  // ── Disabled banner (v1) ────────────────────────────────────────────────
  if (!RESTORE_ENABLED) {
    return (
      <Card style={[styles.card, { opacity: 0.75 }]}>
        <View style={styles.rowIcon}>
          <Feather name="upload" size={20} color={colors.textMuted} />
          <Txt weight="semibold" size={16} color={colors.textInk} style={{ marginRight: 8 }}>
            استعادة نسخة احتياطية
          </Txt>
        </View>
        <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22, marginTop: 8 }}>
          الاستعادة معطّلة مؤقتًا حتى اكتمال اختبارات البيئة التجريبية. صُمّمت لتعمل على مراحل
          آمنة مع إعادة المصادقة وتأكيد صريح ونسخة وقائية قبل الاستبدال.
        </Txt>
      </Card>
    );
  }

  const st = restore.state;

  const onPick = () => {
    setLocalErr(null);
    fileRef.current?.click();
  };
  const onFileChange = (e: any) => {
    const f: File | undefined = e?.target?.files?.[0];
    if (!f) return;
    pickedFile.current = f;
    void restore.inspect(f);
  };

  const startRun = () => {
    const insp = 'inspection' in st ? st.inspection : null;
    if (!pickedFile.current || !insp) return;
    restore.execute(pickedFile.current, insp);
  };

  const proceedToReauth = () => {
    if ('inspection' in st) restore.setStage({ status: 'reauth', inspection: st.inspection });
  };

  const doReauthThenConfirm = async () => {
    if (!('inspection' in st)) return;
    setLocalErr(null);
    try {
      const email = user?.email;
      if (!email) throw new Error('تعذّرت معرفة بريد المشرف.');
      await restore.reauthenticate(email, password);
      restore.setStage({ status: 'confirm', inspection: st.inspection });
    } catch (e) {
      setLocalErr((e as Error).message);
    }
  };

  // Single guided flow (§20): confirm phrase → create the safety backup (if
  // enabled) and AWAIT it → on success continue straight to the restore; on
  // failure stop and show the error. No second click.
  const [safetyRunning, setSafetyRunning] = useState(false);
  const doFinalConfirm = async () => {
    if (!('inspection' in st)) return;
    setLocalErr(null);
    if (confirmText.trim() !== RESTORE_CONFIRM_PHRASE) {
      setLocalErr(`اكتب «${RESTORE_CONFIRM_PHRASE}» للتأكيد.`);
      return;
    }
    if (wantSafety) {
      setSafetyRunning(true);
      try {
        // Must start synchronously in this gesture (showSaveFilePicker), then
        // await completion before touching live data.
        await safetyBackup.start();
      } catch (e) {
        setSafetyRunning(false);
        const msg = (e as Error).message;
        setLocalErr(
          msg === 'cancelled'
            ? 'أُلغيت النسخة الوقائية — تم إيقاف الاستعادة.'
            : `فشلت النسخة الوقائية، وتم إيقاف الاستعادة: ${msg}`,
        );
        return;
      }
      setSafetyRunning(false);
    }
    startRun();
  };

  // ── Render by stage ──────────────────────────────────────────────────────
  return (
    <Card style={styles.card}>
      <View style={styles.rowIcon}>
        <Feather name="upload" size={20} color={colors.primaryTeal600} />
        <Txt weight="semibold" size={16} color={colors.textInk} style={{ marginRight: 8 }}>
          استعادة نسخة احتياطية
        </Txt>
      </View>

      {/* hidden native file input (web) */}
      <input
        ref={fileRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      {(st.status === 'idle' || st.status === 'error') && (
        <>
          <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22, marginTop: 8 }}>
            اختر ملف نسخة احتياطية (ZIP) للتحقّق منه قبل الاستعادة.
          </Txt>
          <PrimaryBtn icon="folder" label="اختيار ملف" onPress={onPick} />
          {st.status === 'error' && <ErrText msg={st.message} />}
        </>
      )}

      {st.status === 'inspecting' && (
        <Txt size={13} color={colors.textSlate} style={{ marginTop: 12 }}>
          جارٍ فحص الملف والتحقّق من سلامته…
        </Txt>
      )}

      {st.status === 'inspected' && (
        <InspectionPreview
          inspection={st.inspection}
          onProceed={proceedToReauth}
          problems={st.inspection.problems}
        />
      )}

      {st.status === 'reauth' && (
        <View style={{ marginTop: 14 }}>
          <WarningBox />
          <Txt size={13} weight="medium" color={colors.textInk} style={{ marginTop: 12 }}>
            أعد إدخال كلمة المرور لتأكيد هويتك
          </Txt>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="كلمة المرور"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          {localErr && <ErrText msg={localErr} />}
          <PrimaryBtn icon="unlock" label="متابعة" onPress={doReauthThenConfirm} />
        </View>
      )}

      {st.status === 'confirm' && (
        <View style={{ marginTop: 14 }}>
          <WarningBox />
          <Pressable
            onPress={() => setWantSafety((v) => !v)}
            style={styles.checkRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: wantSafety }}
          >
            <Feather
              name={wantSafety ? 'check-square' : 'square'}
              size={18}
              color={wantSafety ? colors.primaryTeal600 : colors.textMuted}
            />
            <Txt size={13} color={colors.textInk} style={{ marginRight: 8, flex: 1 }}>
              إنشاء نسخة احتياطية من النظام الحالي قبل الاستعادة (مُوصى به)
            </Txt>
          </Pressable>

          <Txt size={13} weight="medium" color={colors.textInk} style={{ marginTop: 12 }}>
            اكتب «{RESTORE_CONFIRM_PHRASE}» للتأكيد النهائي
          </Txt>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={RESTORE_CONFIRM_PHRASE}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          {localErr && <ErrText msg={localErr} />}
          <PrimaryBtn
            icon="alert-triangle"
            label={safetyRunning ? 'جارٍ إنشاء النسخة الوقائية…' : 'تنفيذ الاستعادة'}
            danger
            disabled={safetyRunning}
            onPress={doFinalConfirm}
          />
          {safetyRunning && (
            <Txt size={12} color={colors.textSlate} style={{ marginTop: 8, lineHeight: 20 }}>
              يجري حفظ نسخة وقائية من النظام الحالي. ستبدأ الاستعادة تلقائيًا بعد اكتمالها.
            </Txt>
          )}
        </View>
      )}

      {st.status === 'running' && (
        <View style={{ marginTop: 16 }}>
          <ProgressBar
            value={st.progress.totalFiles ? st.progress.doneFiles / st.progress.totalFiles : 0}
            height={9}
          />
          <View style={styles.progressMeta}>
            <Txt size={12} color={colors.textSlate}>
              {PHASE_LABEL[st.progress.phase]}
            </Txt>
            <Txt size={12} color={colors.textSlate}>
              {arNum(st.progress.doneFiles)} / {arNum(st.progress.totalFiles)}
            </Txt>
          </View>
          {!!st.progress.currentFile && (
            <Txt size={11} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 4 }}>
              {st.progress.currentFile}
            </Txt>
          )}
          <Pressable onPress={restore.cancel} style={styles.cancelBtn} accessibilityRole="button">
            <Txt weight="medium" size={13} color={colors.stateDanger}>
              إلغاء
            </Txt>
          </Pressable>
        </View>
      )}

      {st.status === 'success' && (
        <View style={{ marginTop: 14 }}>
          <View style={styles.rowIcon}>
            <Feather
              name={st.verification.ok ? 'check-circle' : 'alert-circle'}
              size={18}
              color={st.verification.ok ? colors.stateSuccess : colors.stateDanger}
            />
            <Txt weight="semibold" size={14} color={colors.textInk} style={{ marginRight: 8 }}>
              {st.verification.ok ? 'تمّت الاستعادة بنجاح' : 'اكتملت الاستعادة مع ملاحظات'}
            </Txt>
          </View>
          {st.verification.checks.map((c) => (
            <View key={c.label} style={styles.checkResult}>
              <Feather name={c.ok ? 'check' : 'x'} size={14} color={c.ok ? colors.stateSuccess : colors.stateDanger} />
              <Txt size={12} color={colors.textSlate} style={{ marginRight: 6 }}>
                {c.label}
              </Txt>
            </View>
          ))}
          <PrimaryBtn icon="rotate-ccw" label="تم" onPress={restore.reset} />
        </View>
      )}
    </Card>
  );
}

// ── Sub-parts ────────────────────────────────────────────────────────────────

function InspectionPreview({
  inspection,
  onProceed,
  problems,
}: {
  inspection: import('@/api/backupRestore').BackupInspection;
  onProceed: () => void;
  problems: string[];
}) {
  const m = inspection.manifest;
  const compat = checkCompatibility(m);
  const totalRows = Object.values(m.table_counts).reduce((a, b) => a + b, 0);
  const blocked = compat.outcome === 'not_supported' || problems.length > 0;

  return (
    <View style={{ marginTop: 14 }}>
      <Row label="تاريخ النسخة" value={new Date(m.created_at).toLocaleString('ar')} />
      <Row label="حجم الوسائط" value={arFileSize(m.media_bytes)} />
      <Row label="عدد الملفات" value={`${arNum(m.media_count)} ملف`} />
      <Row label="عدد صفوف الجداول" value={arNum(totalRows)} />
      <Row label="وضع الاستعادة" value="استبدال كامل" />
      <Row label="التشفير" value={m.encryption === 'none' ? 'غير مُشفّرة' : 'مُشفّرة'} />

      <View
        style={[
          styles.compatBox,
          {
            borderColor:
              compat.outcome === 'compatible'
                ? colors.stateSuccess
                : compat.outcome === 'after_migration'
                  ? colors.accentBrass
                  : colors.stateDanger,
          },
        ]}
      >
        <Txt size={12} color={colors.textSlate} style={{ lineHeight: 20 }}>
          {compat.message}
        </Txt>
      </View>

      {problems.length > 0 &&
        problems.map((p) => (
          <Txt key={p} size={12} color={colors.stateDanger} style={{ marginTop: 4 }}>
            • {p}
          </Txt>
        ))}

      {!blocked && <PrimaryBtn icon="arrow-left" label="متابعة" onPress={onProceed} />}
      {blocked && (
        <Txt size={13} color={colors.stateDanger} style={{ marginTop: 12, fontWeight: '600' }}>
          لا يمكن متابعة الاستعادة بهذه النسخة.
        </Txt>
      )}
    </View>
  );
}

function WarningBox() {
  return (
    <View style={styles.warnBox}>
      <Feather name="alert-triangle" size={16} color={colors.stateDanger} />
      <Txt size={12} color={colors.textInk} style={{ marginRight: 8, flex: 1, lineHeight: 20 }}>
        سيتم استبدال بيانات النظام الحالية بالبيانات الموجودة في النسخة الاحتياطية. قد تؤثر هذه
        العملية على الطلاب والمحاضرات والأسئلة والتقدم والملفات. تأكد من إنشاء نسخة احتياطية حديثة
        قبل المتابعة.
      </Txt>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Txt size={12} color={colors.textMuted}>
        {label}
      </Txt>
      <Txt size={12} weight="medium" color={colors.textInk}>
        {value}
      </Txt>
    </View>
  );
}

function PrimaryBtn({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.primaryBtn,
        { backgroundColor: danger ? colors.stateDanger : colors.primaryTeal600 },
        (pressed || disabled) && { opacity: disabled ? 0.6 : 0.85 },
      ]}
    >
      <Feather name={icon} size={16} color={colors.onTealPrimary} />
      <Txt weight="semibold" size={14} color={colors.onTealPrimary} style={{ marginRight: 8 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

function ErrText({ msg }: { msg: string }) {
  return (
    <Txt size={12} color={colors.stateDanger} style={{ marginTop: 8, lineHeight: 20 }}>
      {msg}
    </Txt>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, padding: 18 },
  rowIcon: { flexDirection: 'row-reverse', alignItems: 'center' },
  primaryBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 8,
    textAlign: 'right',
    color: colors.textInk,
    fontSize: 14,
  },
  detailRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.borderHair,
  },
  compatBox: { borderWidth: 1, borderRadius: radius.card, padding: 12, marginTop: 12 },
  warnBox: {
    flexDirection: 'row-reverse',
    borderWidth: 1,
    borderColor: colors.stateDanger,
    backgroundColor: '#FEF6F5',
    borderRadius: radius.card,
    padding: 12,
  },
  checkRow: { flexDirection: 'row-reverse', alignItems: 'center', marginTop: 12 },
  checkResult: { flexDirection: 'row-reverse', alignItems: 'center', marginTop: 6 },
  progressMeta: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 8 },
  cancelBtn: { alignSelf: 'flex-start', marginTop: 14, paddingVertical: 6, paddingHorizontal: 4 },
});
