/**
 * Admin data access — lecture upload, the section tree, and the unclassified
 * review queue (PRD §14, §15). The Telegram bot (deferred) will feed the same
 * unclassified queue, so nothing here changes when it lands.
 */
/**
 * Admin data access — lecture upload, the section tree, and the unclassified
 * review queue (PRD §14, §15). The Telegram bot (deferred) will feed the same
 * unclassified queue, so nothing here changes when it lands.
 */

import { USE_MOCK } from '@/config';
import type { AppLectureStatus } from '@/config';
import * as mock from '@/mock/api';
import type { AdminLectureRow, UnclassifiedItem } from './types';

export type { AdminLectureRow, UnclassifiedItem } from './types';

const NOT_LIVE = (fn: string) =>
  new Error(`[live mode] ${fn} not wired yet — set USE_MOCK=false work pending`);

/** Lectures awaiting classification (manual upload or, later, the bot). */
export async function getUnclassifiedLectures(): Promise<UnclassifiedItem[]> {
  if (USE_MOCK) return mock.getUnclassifiedLectures();
  throw NOT_LIVE('getUnclassifiedLectures');
}

/** All lectures (any status) for the admin lectures table. */
export async function getAdminLectures(): Promise<AdminLectureRow[]> {
  if (USE_MOCK) return mock.getAdminLectures();
  throw NOT_LIVE('getAdminLectures');
}

/** Create a lecture (direct upload). Defaults to draft until published. */
export async function createLecture(input: {
  title: string;
  sectionId: string | null;
  sheikhId: string | null;
  order: number;
  durationSec?: number | null;
  status: AppLectureStatus;
}) {
  if (USE_MOCK) return mock.createLecture(input);
  throw NOT_LIVE('createLecture');
}

/** Toggle publish state (draft ↔ published) or send back to unclassified. */
export async function setLectureStatus(id: string, status: AppLectureStatus) {
  if (USE_MOCK) return mock.setLectureStatus(id, status);
  throw NOT_LIVE('setLectureStatus');
}

/** Assign an unclassified lecture to a section with an order number. */
export async function classifyLecture(id: string, sectionId: string, order: number) {
  if (USE_MOCK) return mock.classifyLecture(id, sectionId, order);
  throw NOT_LIVE('classifyLecture');
}

/** Create a section / inner item under a parent (null = top-level). */
export async function createSection(input: {
  title: string;
  parentId: string | null;
  description?: string | null;
  coverLetter?: string;
  showHeader?: boolean;
}) {
  if (USE_MOCK) return mock.createSection(input);
  throw NOT_LIVE('createSection');
}
