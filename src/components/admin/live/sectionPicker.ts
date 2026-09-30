/**
 * PURE helpers for the live section picker (SectionPickerSheet): the tree in
 * true parent → child order, and a second line per row that tells look-alike
 * sections apart (owner 2026-09-29: staging really has two root sections named
 * «العقيدة», each with an «التوحيد» — the rows looked duplicated).
 *
 *  - Order is rebuilt from `parentId` (siblings by رقم الترتيب, then title,
 *    then id). get_sections_flat sorts by an order+title key, so two same-named,
 *    same-order roots would otherwise interleave their children.
 *  - Each row: its parent path («العقيدة › التوحيد»), its OWN lecture count
 *    (where the recording lands — no subtree walking here) and its sub-section
 *    count; «رقم الترتيب n» when another section has the very same path.
 *  - Rows are de-duplicated by id (a defensive guard; the RPC returns each once).
 */
import type { FlatSectionNode } from '@/api/types';
import { arLectureCount, arNum } from '@/lib/format';

export interface SectionPickerRow {
  id: string;
  title: string;
  depth: number;
  /** Ancestors only, «العقيدة › التوحيد»; null for a root. */
  parentPath: string | null;
  /** «١٥ محاضرة · قسم فرعي واحد · رقم الترتيب ١». */
  meta: string | null;
}

/** «قسم فرعي واحد» / «قسمان فرعيان» / «٣ أقسام فرعية» / «١١ قسماً فرعياً». */
export function arSubsectionCount(n: number): string | null {
  if (n <= 0) return null;
  if (n === 1) return 'قسم فرعي واحد';
  if (n === 2) return 'قسمان فرعيان';
  if (n <= 10) return `${arNum(n)} أقسام فرعية`;
  return `${arNum(n)} قسماً فرعياً`;
}

/** Arabic-insensitive search key: no diacritics / tatweel, one alef, ة→ه, ى→ي. */
export function foldArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim();
}

/** The flat list in parent → children order (depth-first), each id once. */
export function orderSectionTree(nodes: readonly FlatSectionNode[]): FlatSectionNode[] {
  const byId = new Map<string, FlatSectionNode>();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const children = new Map<string | null, FlatSectionNode[]>();
  for (const n of byId.values()) {
    // A parent the viewer can't see (gender scope) → show it as a root.
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  const cmp = (a: FlatSectionNode, b: FlatSectionNode) =>
    a.order - b.order || a.title.localeCompare(b.title, 'ar') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out: FlatSectionNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const n of [...(children.get(parent) ?? [])].sort(cmp)) {
      if (seen.has(n.id)) continue; // cycles can't happen, but never loop
      seen.add(n.id);
      out.push(n);
      walk(n.id);
    }
  };
  walk(null);
  return out;
}

/**
 * The picker rows. `lectureCounts` = lectures sitting DIRECTLY in each section
 * (null while unknown → no count shown). A non-empty `query` filters by the
 * title or any ancestor title.
 */
export function sectionPickerRows(
  nodes: readonly FlatSectionNode[],
  lectureCounts: ReadonlyMap<string, number> | null,
  query = '',
): SectionPickerRow[] {
  const ordered = orderSectionTree(nodes);
  const childCount = new Map<string, number>();
  for (const n of ordered) if (n.parentId) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);
  const pathKey = (n: FlatSectionNode) => (n.path.length ? n.path : [n.title]).join('\u0000');
  const samePath = new Map<string, number>();
  for (const n of ordered) samePath.set(pathKey(n), (samePath.get(pathKey(n)) ?? 0) + 1);

  const q = foldArabic(query);
  const rows: SectionPickerRow[] = [];
  for (const n of ordered) {
    if (q && !foldArabic(n.title).includes(q) && !n.path.some((p) => foldArabic(p).includes(q))) continue;
    const ancestors = n.path.length > 1 ? n.path.slice(0, -1) : [];
    const meta = [
      lectureCounts ? arLectureCount(lectureCounts.get(n.id) ?? 0) : null,
      arSubsectionCount(childCount.get(n.id) ?? 0),
      (samePath.get(pathKey(n)) ?? 0) > 1 ? `رقم الترتيب ${arNum(n.order)}` : null,
    ].filter((x): x is string => !!x);
    rows.push({
      id: n.id,
      title: n.title,
      depth: n.depth,
      parentPath: ancestors.length ? ancestors.join(' › ') : null,
      meta: meta.length ? meta.join(' · ') : null,
    });
  }
  return rows;
}

/** Lectures sitting directly in each section (from the admin lecture list). */
export function directLectureCounts(
  lectures: readonly { sectionId: string | null }[] | null | undefined,
): Map<string, number> | null {
  if (!lectures) return null;
  const out = new Map<string, number>();
  for (const l of lectures) if (l.sectionId) out.set(l.sectionId, (out.get(l.sectionId) ?? 0) + 1);
  return out;
}
