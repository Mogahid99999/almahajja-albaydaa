/** Sheikh lookup (for the upload form select + chips). */
import { USE_MOCK } from '@/config';
import * as mock from '@/mock/api';
import type { SheikhOption } from './types';

export type { SheikhOption } from './types';

export async function getSheikhs(): Promise<SheikhOption[]> {
  if (USE_MOCK) return mock.getSheikhs();
  throw new Error('[live mode] getSheikhs not wired yet — set USE_MOCK=false work pending');
}
