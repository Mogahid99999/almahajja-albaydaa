/**
 * Backup format contract — shared by the create side (this v1) and the future
 * restore side. Bump BACKUP_FORMAT_VERSION only on a breaking change to the ZIP
 * layout / manifest shape; restore checks it against a supported set (§14).
 *
 * ZIP layout (almahajja-backup-YYYYMMDD-HHmm.zip):
 *   manifest.json          — the object below
 *   database/<table>.jsonl — one JSON row per line, per table, FK-safe order
 *   database/_sequences.json
 *   media/<r2-key>         — real bytes, original R2 key preserved as the path
 *   checksums.json         — { "path": "sha256hex", ... } for every db + media file
 */

export const BACKUP_FORMAT_VERSION = '1';
export const CHECKSUM_ALGO = 'sha256';

/** App version stamped into the manifest (from app.json expo.version). */
export const APP_VERSION = '1.1.0';

/**
 * Schema version = the highest applied migration number relevant to the backup
 * shape. Bump when a later migration changes table shapes in a way a restore
 * must be aware of. Restore compares this to decide compatible /
 * after_migration / not_supported.
 */
export const SCHEMA_VERSION = '0103';

/**
 * Backup type (chosen by the admin before starting):
 *  • 'full'          — DB tables + data AND all R2 media bytes.
 *  • 'database_only' — DB tables + data only; media is NOT listed, downloaded,
 *                      hashed, or included. A database_only RESTORE leaves R2
 *                      media completely untouched.
 */
export type BackupMode = 'full' | 'database_only';

/** One table's column shape, from backup_schema_fingerprint() (migration 0103). */
export interface SchemaColumn {
  name: string;
  type: string;
  /** generated columns are excluded from insert/export. */
  generated: boolean;
}
export interface SchemaTable {
  table: string;
  columns: SchemaColumn[];
}

export interface BackupManifest {
  backup_format_version: string;
  schema_version: string;
  app_version: string;
  created_at: string;
  backup_started_at: string;
  backup_finished_at: string;
  source_project_id: string | null;
  actor: { id: string | null; name: string | null };
  /** table name → row count captured at export time. */
  table_counts: Record<string, number>;
  media_count: number;
  media_bytes: number;
  checksum_algorithm: string;
  encryption: 'none';
  backup_mode: BackupMode;
  /**
   * Machine-readable table+column shape this backup was taken against
   * (backup_schema_fingerprint, migration 0103) + a stable hash of it. Lets a
   * restore diff backup-shape vs current-shape: extra tables/columns in the
   * running app are non-breaking; renamed/removed columns or incompatible type
   * changes are what a versioned backup-migration must handle.
   */
  schema_fingerprint: SchemaTable[];
  schema_fingerprint_sha256: string;
  /**
   * We export table-by-table, each its own snapshot — NOT a single global
   * point-in-time. Documented here honestly (§4); a maintenance/read-only
   * window is the operator's tool for a near-consistent capture.
   */
  consistency_model: 'per-table';
  /**
   * Auth reality (§15): app data (profiles + tables) is included; plaintext
   * passwords are never. Same-project restore keeps auth users; cross-project
   * needs re-creation via the admin API + password reset/invite.
   */
  auth_users_note: string;
}

export const AUTH_USERS_NOTE =
  'يتضمن هذا النسخ بيانات التطبيق (الملفات الشخصية وجميع الجداول) دون كلمات المرور. ' +
  'عند الاستعادة إلى نفس المشروع تبقى حسابات الدخول كما هي؛ أما الاستعادة إلى مشروع ' +
  'جديد فتتطلب إنشاء الحسابات عبر واجهة الإدارة وإعادة تعيين كلمات المرور.';

/** Derive the Supabase project ref from the project URL (…//<ref>.supabase.co). */
export function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return m ? m[1] : null;
}

/**
 * almahajja-backup[-db]-YYYYMMDD-HHmm.zip from a Date. A database_only backup
 * gets the `-db` marker so the two types are distinguishable on disk.
 */
export function backupFileName(d: Date = new Date(), mode: BackupMode = 'full'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const tag = mode === 'database_only' ? '-db' : '';
  return (
    `almahajja-backup${tag}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}.zip`
  );
}
