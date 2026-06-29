/** Sheikh lookup (for the upload form select + chips). */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import type { SheikhOption } from './types';

export type { SheikhOption } from './types';

export async function getSheikhs(): Promise<SheikhOption[]> {
  if (USE_MOCK) return mock.getSheikhs();
  const { data, error } = await supabase
    .from('sheikhs')
    .select('id, name')
    .order('name');
  if (error) throw error;
  return data ?? [];
}
