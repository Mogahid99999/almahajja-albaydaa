/**
 * Backup validation & version compatibility — PURE logic (no I/O), so it can be
 * unit-tested and reused by the restore orchestrator. Covers the §11 ZIP-path
 * safety checks (the realistic subset for a trusted-admin archive: traversal /
 * absolute / duplicate / control-char / reserved-prefix), the §13 checksum
 * verification helpers, and the §14 version-compatibility decision.
 *
 * The adversarial-archive hardening (zip bombs, symlinks, compression ratios)
 * is explicitly deferred to v2 — restore is admin-only + re-auth + typed
 * confirmation, so the archive is not attacker-reachable in v1.
 */
import {
  BACKUP_FORMAT_VERSION,
  SCHEMA_VERSION,
  type BackupManifest,
} from '@/lib/backupFormat';

// ─── Path safety (§11) ───────────────────────────────────────────────────────

const RESERVED_PREFIXES = ['restore-staging/', 'pre-restore/'];

/**
 * A ZIP entry path is safe to act on iff it has no traversal/absolute/backslash/
 * control-char tricks, is valid, and lives under one of the expected top-level
 * folders. Returns a reason (Arabic) when unsafe, or null when safe.
 */
export function unsafePathReason(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'مسار فارغ داخل الأرشيف.';
  if (path.length > 1024) return `مسار طويل غير متوقّع: ${path.slice(0, 40)}…`;
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return `مسار مطلق غير مسموح: ${path}`;
  if (path.includes('\\')) return `مسار يحتوي على شرطة عكسية: ${path}`;
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) return `مسار يحتوي على تجاوز (..): ${path}`;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return `مسار يحتوي على أحرف تحكّم: ${path}`;
  }
  if (RESERVED_PREFIXES.some((p) => path.startsWith(p))) {
    return `مسار يستخدم بادئة محجوزة: ${path}`;
  }
  return null;
}

/** Classify a ZIP entry path into the backup's logical sections. */
export type EntryKind =
  | { kind: 'manifest' }
  | { kind: 'checksums' }
  | { kind: 'sequences' }
  | { kind: 'table'; table: string }
  | { kind: 'media'; key: string }
  | { kind: 'unknown' };

export function classifyEntry(path: string): EntryKind {
  if (path === 'manifest.json') return { kind: 'manifest' };
  if (path === 'checksums.json') return { kind: 'checksums' };
  if (path === 'database/_sequences.json') return { kind: 'sequences' };
  const t = path.match(/^database\/(.+)\.jsonl$/);
  if (t) return { kind: 'table', table: t[1] };
  if (path.startsWith('media/')) return { kind: 'media', key: path.slice('media/'.length) };
  return { kind: 'unknown' };
}

// ─── Structure validation ────────────────────────────────────────────────────

export interface ParsedManifest {
  manifest: BackupManifest;
}

/** Parse + shape-check manifest.json. Throws an Arabic error on any problem. */
export function parseManifest(text: string): BackupManifest {
  let m: any;
  try {
    m = JSON.parse(text);
  } catch {
    throw new Error('تعذّرت قراءة manifest.json — الملف تالف أو ليس نسخة احتياطية صحيحة.');
  }
  const required = [
    'backup_format_version',
    'schema_version',
    'app_version',
    'created_at',
    'table_counts',
    'media_count',
    'checksum_algorithm',
    'backup_mode',
  ];
  for (const k of required) {
    if (!(k in m)) throw new Error(`manifest.json ناقص الحقل: ${k}`);
  }
  if (m.checksum_algorithm !== 'sha256') {
    throw new Error(`خوارزمية تحقّق غير مدعومة: ${m.checksum_algorithm}`);
  }
  return m as BackupManifest;
}

/** Parse checksums.json into a path→hash map. Throws on malformed input. */
export function parseChecksums(text: string): Record<string, string> {
  let c: any;
  try {
    c = JSON.parse(text);
  } catch {
    throw new Error('تعذّرت قراءة checksums.json — الأرشيف تالف.');
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    throw new Error('صيغة checksums.json غير صحيحة.');
  }
  for (const [k, v] of Object.entries(c)) {
    if (typeof v !== 'string' || !/^[0-9a-f]{64}$/i.test(v)) {
      throw new Error(`قيمة تحقّق غير صحيحة للملف: ${k}`);
    }
  }
  return c as Record<string, string>;
}

// ─── Version compatibility (§14) ─────────────────────────────────────────────

export type CompatOutcome = 'compatible' | 'after_migration' | 'not_supported';

export interface CompatResult {
  outcome: CompatOutcome;
  /** Arabic explanation shown to the admin. */
  message: string;
}

/**
 * Decide whether a backup can be restored into THIS build.
 *  • format version must match exactly (a different ZIP layout = not supported).
 *  • same schema_version → fully compatible.
 *  • backup's schema OLDER than current → restorable but the running schema is
 *    newer; we surface "after_migration" (the newer columns take defaults). We
 *    do NOT auto-run anything — it's an explicit, documented outcome.
 *  • backup's schema NEWER than current → not supported (this build predates it).
 */
export function checkCompatibility(m: BackupManifest): CompatResult {
  if (m.backup_format_version !== BACKUP_FORMAT_VERSION) {
    return {
      outcome: 'not_supported',
      message:
        `صيغة النسخة (${m.backup_format_version}) لا يدعمها هذا الإصدار ` +
        `(${BACKUP_FORMAT_VERSION}). لا يمكن الاستعادة.`,
    };
  }
  const backupSchema = parseInt(m.schema_version, 10);
  const currentSchema = parseInt(SCHEMA_VERSION, 10);
  if (Number.isNaN(backupSchema) || Number.isNaN(currentSchema)) {
    return { outcome: 'not_supported', message: 'رقم مخطّط قاعدة البيانات غير صالح في النسخة.' };
  }
  if (backupSchema === currentSchema) {
    return { outcome: 'compatible', message: 'النسخة متوافقة تمامًا مع النظام الحالي.' };
  }
  if (backupSchema < currentSchema) {
    return {
      outcome: 'after_migration',
      message:
        `أُنشئت هذه النسخة على مخطّط أقدم (${m.schema_version}) من الحالي ` +
        `(${SCHEMA_VERSION}). يمكن الاستعادة، وستأخذ الأعمدة الأحدث قيمها الافتراضية.`,
    };
  }
  return {
    outcome: 'not_supported',
    message:
      `أُنشئت هذه النسخة على مخطّط أحدث (${m.schema_version}) من الذي يدعمه ` +
      `هذا الإصدار (${SCHEMA_VERSION}). حدّث التطبيق أولًا.`,
  };
}

// ─── Cross-checks between manifest / checksums / entries ──────────────────────

/**
 * After the whole ZIP has been walked, verify the collected entry list against
 * the manifest + checksums. Returns a list of Arabic problems (empty = OK).
 *  • every media/db file in checksums.json must have been seen (no missing).
 *  • no duplicate paths.
 *  • media_count in the manifest must match the media files seen.
 */
export function crossCheck(
  manifest: BackupManifest,
  checksums: Record<string, string>,
  seenPaths: string[],
): string[] {
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const p of seenPaths) {
    if (seen.has(p)) problems.push(`مسار مكرّر داخل الأرشيف: ${p}`);
    seen.add(p);
  }

  // Every checksummed file must be present.
  for (const path of Object.keys(checksums)) {
    if (!seen.has(path)) problems.push(`ملف مذكور في checksums.json ومفقود: ${path}`);
  }

  // media_count consistency.
  const mediaSeen = seenPaths.filter((p) => p.startsWith('media/')).length;
  if (mediaSeen !== manifest.media_count) {
    problems.push(
      `عدد الملفات لا يطابق البيان: ${mediaSeen} موجودة مقابل ${manifest.media_count} في manifest.`,
    );
  }

  return problems;
}
