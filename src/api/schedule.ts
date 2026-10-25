/**
 * «الجدول الأسبوعي للدروس» (migration 0158).
 *
 *  - getSchedule(): ONE rpc (get_schedule) — the shown lessons for my side +
 *    their single-date changes from a week ago to 90 days ahead, and the
 *    version stamp. The app keeps it on the device and refetches only when
 *    app_open says the version changed (no polling).
 *  - Moderators (admin / publisher / sheikh — can_edit_schedule) write the
 *    tables directly; RLS is the authority, a trigger validates a change's date
 *    and another stamps the version.
 *
 * 0158 is not in database.generated.ts yet → `as never` (same debt as broadcasts).
 */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';

export type ScheduleAudience = 'all' | 'male' | 'female';

export interface ScheduleItem {
  id: string;
  title: string;
  subtitle: string | null;
  subject: string | null;
  sheikhId: string | null;
  /** The sheikh's name (a sheikhs row, or the free name typed by the editor). */
  sheikhName: string | null;
  sectionId: string | null;
  sectionTitle: string | null;
  audience: ScheduleAudience;
  /** dow: 0 Sunday … 6 Saturday. */
  days: number[];
  /** Mecca time 'HH:MM'. */
  startTime: string;
  durationMin: number | null;
  note: string | null;
  isActive: boolean;
  sortOrder: number;
}

export interface ScheduleException {
  id: string;
  itemId: string;
  /** The ORIGINAL date 'YYYY-MM-DD' (Mecca). */
  occursOn: string;
  kind: 'cancelled' | 'moved';
  newDate: string | null;
  newTime: string | null;
  note: string | null;
}

export interface Schedule {
  version: string | null;
  items: ScheduleItem[];
  exceptions: ScheduleException[];
  /** I may edit it (moderators). */
  canEdit: boolean;
}

export const EMPTY_SCHEDULE: Schedule = { version: null, items: [], exceptions: [], canEdit: false };

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const HM = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function mapItem(raw: unknown): ScheduleItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  const title = str(r.title);
  const startTime = str(r.start_time);
  if (!id || !title || !startTime || !HM.test(startTime)) return null;
  const days = Array.isArray(r.days)
    ? Array.from(new Set(r.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)))
    : [];
  if (!days.length) return null;
  const audience = r.audience === 'male' || r.audience === 'female' ? r.audience : 'all';
  const dur = Number(r.duration_min);
  return {
    id,
    title,
    subtitle: str(r.subtitle),
    subject: str(r.subject),
    sheikhId: str(r.sheikh_id),
    sheikhName: str(r.sheikh_name),
    sectionId: str(r.section_id),
    sectionTitle: str(r.section_title),
    audience,
    days,
    startTime,
    durationMin: Number.isFinite(dur) && dur > 0 ? Math.round(dur) : null,
    note: str(r.note),
    isActive: r.is_active !== false,
    sortOrder: Number.isFinite(Number(r.sort_order)) ? Number(r.sort_order) : 0,
  };
}

function mapException(raw: unknown): ScheduleException | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const id = str(r.id);
  const itemId = str(r.item_id);
  const occursOn = str(r.occurs_on);
  if (!id || !itemId || !occursOn || !DATE.test(occursOn)) return null;
  if (r.kind !== 'cancelled' && r.kind !== 'moved') return null;
  const newDate = str(r.new_date);
  const newTime = str(r.new_time);
  return {
    id,
    itemId,
    occursOn,
    kind: r.kind,
    newDate: newDate && DATE.test(newDate) ? newDate : null,
    newTime: newTime && HM.test(newTime) ? newTime : null,
    note: str(r.note),
  };
}

export function parseSchedule(raw: unknown): Schedule {
  if (!raw || typeof raw !== 'object') return EMPTY_SCHEDULE;
  const r = raw as Raw;
  return {
    version: str(r.version),
    items: (Array.isArray(r.items) ? r.items : []).map(mapItem).filter((i): i is ScheduleItem => !!i),
    exceptions: (Array.isArray(r.exceptions) ? r.exceptions : [])
      .map(mapException)
      .filter((e): e is ScheduleException => !!e),
    canEdit: r.can_edit === true,
  };
}

export async function getSchedule(): Promise<Schedule> {
  if (USE_MOCK) return EMPTY_SCHEDULE;
  const { data, error } = await supabase.rpc('get_schedule' as never);
  if (error) throw error;
  return parseSchedule(data);
}

// ─── Moderators ───────────────────────────────────────────────────────────────

export type ScheduleItemInput = {
  id?: string;
  title: string;
  subtitle: string | null;
  subject: string | null;
  sheikhId: string | null;
  sheikhName: string | null;
  sectionId: string | null;
  audience: ScheduleAudience;
  days: number[];
  startTime: string;
  durationMin: number | null;
  note: string | null;
  isActive: boolean;
};

const blank = (s: string | null | undefined) => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

export async function saveScheduleItem(input: ScheduleItemInput): Promise<string> {
  const row = {
    title: input.title.trim(),
    subtitle: blank(input.subtitle),
    subject: blank(input.subject),
    sheikh_id: input.sheikhId,
    sheikh_name: input.sheikhId ? null : blank(input.sheikhName),
    section_id: input.sectionId,
    audience: input.audience,
    days: Array.from(new Set(input.days)).sort(),
    start_time: input.startTime,
    duration_min: input.durationMin,
    note: blank(input.note),
    is_active: input.isActive,
  };
  const table = supabase.from('schedule_items' as never) as unknown as {
    insert: (r: unknown) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> } };
    update: (r: unknown) => { eq: (c: string, v: string) => { select: (c: string) => { single: () => Promise<{ data: { id: string } | null; error: unknown }> } } };
  };
  const { data, error } = input.id
    ? await table.update(row).eq('id', input.id).select('id').single()
    : await table.insert(row).select('id').single();
  if (error) throw error;
  return data?.id ?? input.id ?? '';
}

export async function setScheduleItemActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await (supabase.from('schedule_items' as never) as unknown as {
    update: (r: unknown) => { eq: (c: string, v: string) => Promise<{ error: unknown }> };
  })
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteScheduleItem(id: string): Promise<void> {
  const { error } = await (supabase.from('schedule_items' as never) as unknown as {
    delete: () => { eq: (c: string, v: string) => Promise<{ error: unknown }> };
  })
    .delete()
    .eq('id', id);
  if (error) throw error;
}

export type ScheduleExceptionInput = {
  itemId: string;
  occursOn: string;
  kind: 'cancelled' | 'moved';
  newDate: string | null;
  newTime: string | null;
  note: string | null;
};

/** One date of one lesson — replaces any earlier change of that date. */
export async function saveScheduleException(input: ScheduleExceptionInput): Promise<void> {
  const { error } = await (supabase.from('schedule_exceptions' as never) as unknown as {
    upsert: (r: unknown, o: { onConflict: string }) => Promise<{ error: unknown }>;
  }).upsert(
    {
      item_id: input.itemId,
      occurs_on: input.occursOn,
      kind: input.kind,
      new_date: input.kind === 'moved' ? input.newDate : null,
      new_time: input.kind === 'moved' ? input.newTime : null,
      note: blank(input.note),
    },
    { onConflict: 'item_id,occurs_on' },
  );
  if (error) throw error;
}

/** Back to the regular schedule for that date. */
export async function deleteScheduleException(id: string): Promise<void> {
  const { error } = await (supabase.from('schedule_exceptions' as never) as unknown as {
    delete: () => { eq: (c: string, v: string) => Promise<{ error: unknown }> };
  })
    .delete()
    .eq('id', id);
  if (error) throw error;
}
