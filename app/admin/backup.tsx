/**
 * النسخ الاحتياطي والاستعادة — admin backup & restore.
 *
 * v1 CREATE side: streams a full backup (database JSONL + all R2 media) into
 * one ZIP saved to the admin's computer, R2 → browser → disk, never buffering
 * the whole archive. Desktop-web only (needs the File System Access API +
 * WebCrypto); on native/unsupported browsers a notice tells the admin to use a
 * computer. Restore (staged, re-auth-gated, typed confirmation, pre-restore
 * safety backup) is built in RestoreSection but stays DISABLED behind
 * RESTORE_ENABLED until the staging round-trip (§23) passes.
 *
 * Admin-only (useAdminOnly + the RPC/Edge gates in migration 0102 /
 * backup-media). Backups contain sensitive system data and are UNENCRYPTED in
 * v1 — the warning below is deliberate and prominent (§16 fallback).
 */
import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { isBackupSupported } from '@/api/backup';
import { AdminShell } from '@/components/admin/AdminShell';
import { RestoreSection } from '@/components/admin/RestoreSection';
import { Card, ProgressBar, Txt } from '@/components/ui';
import { colors, radius } from '@/constants/theme';
import type { BackupMode } from '@/lib/backupFormat';
import { useAdminOnly } from '@/hooks/useAdminGuard';
import { useBackupLog, useCreateBackup } from '@/hooks/useBackup';
import { arFileSize, arNum, arSince } from '@/lib/format';

const STATUS_LABEL: Record<string, string> = {
  pending: 'قيد الانتظار',
  running: 'جارٍ التنفيذ',
  validating: 'جارٍ التحقّق',
  uploading: 'جارٍ الرفع',
  restoring: 'جارٍ الاستعادة',
  verifying: 'جارٍ المراجعة',
  success: 'ناجحة',
  failed: 'فاشلة',
  cancelled: 'ملغاة',
};

function elapsedLabel(startedAt: number): string {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${arNum(m)}د ${arNum(r)}ث` : `${arNum(r)}ث`;
}

export default function BackupScreen() {
  useAdminOnly();
  const supported = isBackupSupported();
  const { state, start, cancel, reset } = useCreateBackup();
  const log = useBackupLog(20);
  const [mode, setMode] = useState<BackupMode>('full');

  const running = state.status === 'running';

  return (
    <AdminShell active="backup" breadcrumb="النسخ الاحتياطي والاستعادة" scroll>
      {/* Mobile / unsupported notice --------------------------------------- */}
      {(Platform.OS !== 'web' || !supported) && (
        <Card style={styles.card}>
          <View style={styles.rowIcon}>
            <Feather name="monitor" size={20} color={colors.accentBrass} />
            <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginRight: 8 }}>
              يتطلّب جهاز كمبيوتر
            </Txt>
          </View>
          <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22, marginTop: 8 }}>
            يرجى استخدام جهاز كمبيوتر (متصفّح Chrome أو Edge) لإنشاء أو استعادة النسخ الاحتياطية.
          </Txt>
        </Card>
      )}

      {Platform.OS === 'web' && supported && (
        <>
          {/* Sensitive-data warning (v1 is unencrypted) ------------------- */}
          <Card style={[styles.card, styles.warnCard]}>
            <View style={styles.rowIcon}>
              <Feather name="alert-triangle" size={18} color={colors.stateDanger} />
              <Txt weight="semibold" size={14} color={colors.stateDanger} style={{ marginRight: 8 }}>
                تنبيه أمني
              </Txt>
            </View>
            <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22, marginTop: 8 }}>
              تحتوي النسخة الاحتياطية على بيانات النظام الحسّاسة كاملةً (بيانات الطلاب والمشايخ
              والأسئلة والتقدّم والملفات) بصيغة غير مُشفّرة. احفظ الملف في مكان آمن ولا تُشاركه.
            </Txt>
          </Card>

          {/* Create backup ------------------------------------------------ */}
          <Card style={styles.card}>
            <View style={styles.rowIcon}>
              <Feather name="download" size={20} color={colors.primaryTeal600} />
              <Txt weight="semibold" size={16} color={colors.textInk} style={{ marginRight: 8 }}>
                إنشاء نسخة احتياطية
              </Txt>
            </View>
            <Txt size={13} color={colors.textSlate} style={{ lineHeight: 22, marginTop: 8 }}>
              يُنشئ ملف ZIP واحدًا يُحفَظ مباشرةً على جهازك. لا يُخزَّن على الخادم.
            </Txt>

            {/* Backup type selector */}
            {!running && (
              <View style={styles.modeRow}>
                <ModePill
                  active={mode === 'full'}
                  title="نسخة كاملة"
                  subtitle="قاعدة البيانات + جميع الملفات"
                  onPress={() => setMode('full')}
                />
                <ModePill
                  active={mode === 'database_only'}
                  title="قاعدة البيانات فقط"
                  subtitle="بدون الملفات الصوتية والمرفقات"
                  onPress={() => setMode('database_only')}
                />
              </View>
            )}

            {/* Idle / done / error → the button */}
            {!running && (
              <Pressable
                // start() now returns a promise (so the restore flow can await
                // it); the standalone button drives state via the hook, so
                // swallow the rejection here to avoid an unhandled rejection.
                onPress={() => void start(mode).catch(() => {})}
                accessibilityRole="button"
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
              >
                <Feather name="download" size={16} color={colors.onTealPrimary} />
                <Txt weight="semibold" size={14} color={colors.onTealPrimary} style={{ marginRight: 8 }}>
                  إنشاء النسخة الآن
                </Txt>
              </Pressable>
            )}

            {/* Running → progress */}
            {running && (
              <View style={{ marginTop: 16 }}>
                <ProgressBar
                  value={state.progress.totalFiles ? state.progress.doneFiles / state.progress.totalFiles : 0}
                  height={9}
                />
                <View style={styles.progressMeta}>
                  <Txt size={12} color={colors.textSlate}>
                    {PHASE_LABEL[state.progress.phase]}
                  </Txt>
                  <Txt size={12} color={colors.textSlate}>
                    {arNum(state.progress.doneFiles)} / {arNum(state.progress.totalFiles)} ملف
                  </Txt>
                </View>
                {state.progress.totalBytes > 0 && (
                  <Txt size={12} color={colors.textSlate} style={{ marginTop: 4 }}>
                    {arFileSize(state.progress.doneBytes)} / {arFileSize(state.progress.totalBytes)}
                    {'  ·  '}
                    {elapsedLabel(state.progress.startedAt)}
                  </Txt>
                )}
                {!!state.progress.currentFile && (
                  <Txt size={11} color={colors.textMuted} numberOfLines={1} style={{ marginTop: 4 }}>
                    {state.progress.currentFile}
                  </Txt>
                )}
                <Pressable
                  onPress={cancel}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}
                >
                  <Txt weight="medium" size={13} color={colors.stateDanger}>
                    إلغاء
                  </Txt>
                </Pressable>
              </View>
            )}

            {/* Result banners */}
            {state.status === 'success' && (
              <ResultBanner
                icon="check-circle"
                color={colors.stateSuccess}
                title="تمّت النسخة الاحتياطية"
                detail={`${state.fileName} · ${arFileSize(state.sizeBytes)}`}
                onDismiss={reset}
              />
            )}
            {state.status === 'cancelled' && (
              <ResultBanner
                icon="x-circle"
                color={colors.textSlate}
                title="أُلغيت العملية"
                detail="لم يكتمل إنشاء النسخة الاحتياطية."
                onDismiss={reset}
              />
            )}
            {state.status === 'error' && (
              <ResultBanner
                icon="alert-circle"
                color={colors.stateDanger}
                title="تعذّر إنشاء النسخة"
                detail={state.message}
                onDismiss={reset}
              />
            )}
          </Card>

          {/* Restore ------------------------------------------------------ */}
          <RestoreSection />

          {/* History ------------------------------------------------------ */}
          <Card style={styles.card}>
            <View style={styles.rowIcon}>
              <Feather name="clock" size={18} color={colors.textSlate} />
              <Txt weight="semibold" size={15} color={colors.textInk} style={{ marginRight: 8 }}>
                سجلّ العمليات
              </Txt>
            </View>
            {log.data && log.data.length === 0 && (
              <Txt size={13} color={colors.textMuted} style={{ marginTop: 12 }}>
                لا توجد عمليات بعد.
              </Txt>
            )}
            {log.data?.map((row) => (
              <View key={row.id} style={styles.logRow}>
                <View style={{ flex: 1 }}>
                  <Txt size={13} weight="medium" color={colors.textInk}>
                    {row.operation_type === 'backup' ? 'نسخ احتياطي' : 'استعادة'}
                    {row.file_name ? ` · ${row.file_name}` : ''}
                  </Txt>
                  <Txt size={11} color={colors.textMuted} style={{ marginTop: 2 }}>
                    {row.actor_name ?? '—'} · {arSince(row.started_at)}
                    {row.size_bytes ? ` · ${arFileSize(row.size_bytes)}` : ''}
                  </Txt>
                  {row.error_message && (
                    <Txt size={11} color={colors.stateDanger} style={{ marginTop: 2 }}>
                      {row.error_message}
                    </Txt>
                  )}
                </View>
                <View style={[styles.statusPill, pillStyle(row.status)]}>
                  <Txt size={11} weight="semibold" color={pillTextColor(row.status)}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </Txt>
                </View>
              </View>
            ))}
          </Card>
        </>
      )}
    </AdminShell>
  );
}

const PHASE_LABEL: Record<string, string> = {
  database: 'تصدير قاعدة البيانات…',
  media: 'تنزيل الملفات…',
  finalizing: 'إنهاء الأرشيف…',
  done: 'اكتمل',
};

function ModePill({
  active,
  title,
  subtitle,
  onPress,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.modePill,
        active && styles.modePillActive,
        pressed && !active && { opacity: 0.8 },
      ]}
    >
      <View style={styles.rowIcon}>
        <Feather
          name={active ? 'check-circle' : 'circle'}
          size={15}
          color={active ? colors.primaryTeal600 : colors.textMuted}
        />
        <Txt
          weight="semibold"
          size={13}
          color={active ? colors.primaryTeal600 : colors.textInk}
          style={{ marginRight: 6 }}
        >
          {title}
        </Txt>
      </View>
      <Txt size={11} color={colors.textSlate} style={{ marginTop: 4 }}>
        {subtitle}
      </Txt>
    </Pressable>
  );
}

function ResultBanner({
  icon,
  color,
  title,
  detail,
  onDismiss,
}: {
  icon: keyof typeof Feather.glyphMap;
  color: string;
  title: string;
  detail: string;
  onDismiss: () => void;
}) {
  return (
    <View style={[styles.banner, { borderColor: color }]}>
      <Feather name={icon} size={18} color={color} />
      <View style={{ flex: 1, marginRight: 8 }}>
        <Txt weight="semibold" size={13} color={colors.textInk}>
          {title}
        </Txt>
        <Txt size={12} color={colors.textSlate} style={{ marginTop: 2 }}>
          {detail}
        </Txt>
      </View>
      <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={8}>
        <Feather name="x" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

function pillStyle(status: string): ViewStyle {
  if (status === 'success') return { backgroundColor: '#E6F4EA' };
  if (status === 'failed') return { backgroundColor: '#FCE8E6' };
  if (status === 'cancelled') return { backgroundColor: colors.surfaceInset };
  return { backgroundColor: colors.accentBrassSoft };
}
function pillTextColor(status: string): string {
  if (status === 'success') return colors.stateSuccess;
  if (status === 'failed') return colors.stateDanger;
  return colors.textSlate;
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, padding: 18 },
  warnCard: { borderWidth: 1, borderColor: colors.stateDanger, backgroundColor: '#FEF6F5' },
  rowIcon: { flexDirection: 'row-reverse', alignItems: 'center' },
  modeRow: { flexDirection: 'row-reverse', gap: 10, marginTop: 14 },
  modePill: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderSand,
    borderRadius: radius.card,
    padding: 12,
  },
  modePillActive: { borderColor: colors.primaryTeal600, backgroundColor: colors.surfaceInset },
  primaryBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTeal600,
    borderRadius: radius.pill,
    paddingVertical: 12,
    marginTop: 16,
  },
  cancelBtn: { alignSelf: 'flex-start', marginTop: 14, paddingVertical: 6, paddingHorizontal: 4 },
  progressMeta: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 8 },
  banner: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 12,
    marginTop: 16,
    gap: 4,
  },
  logRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderHair,
    gap: 8,
  },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});
