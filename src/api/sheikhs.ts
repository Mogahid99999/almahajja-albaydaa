/** Sheikh lookup (for the upload form select + chips). */
import { USE_MOCK } from '@/config';
import { supabase } from '@/lib/supabase';
import * as mock from '@/mock/api';
import { createUser } from './adminUsers';
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

/** Admin: add a sheikh. `name` is UNIQUE in the schema → surface a clear error. */
export async function createSheikh(name: string): Promise<SheikhOption> {
  if (USE_MOCK) return mock.createSheikh(name);
  const { data, error } = await supabase
    .from('sheikhs')
    .insert({ name: name.trim() })
    .select('id, name')
    .single();
  if (error || !data) throw error ?? new Error('create sheikh failed');
  return data;
}

/** Admin: rename a sheikh (lectures keep their sheikh_id, so they follow along). */
export async function updateSheikh(id: string, name: string): Promise<void> {
  if (USE_MOCK) return mock.updateSheikh(id, name);
  const { error } = await supabase
    .from('sheikhs')
    .update({ name: name.trim() })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Admin: delete a sheikh. Lectures keep playing — `lectures.sheikh_id` is
 * `ON DELETE SET NULL` (0001), so the chip just disappears, nothing breaks.
 */
export async function deleteSheikh(id: string): Promise<void> {
  if (USE_MOCK) return mock.deleteSheikh(id);
  const { error } = await supabase.from('sheikhs').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Admin (V6): provision a sheikh LOGIN — an auth account with role 'sheikh'
 * (via the admin-users Edge Function, service-role side) linked to a `sheikhs`
 * metadata row through `sheikhs.user_id` (created when no row carries the same
 * name yet). The account lands on /sheikh — the questions inbox.
 */
export async function createSheikhAccount(input: {
  name: string;
  email: string;
  password: string;
}): Promise<void> {
  if (USE_MOCK) throw new Error('غير متاح في الوضع التجريبي');
  const name = input.name.trim();
  const res = await createUser({
    email: input.email,
    password: input.password,
    displayName: name,
    role: 'sheikh',
  });
  const userId = (res?.userId as string | undefined) ?? undefined;
  if (!userId) return;
  const { data: existing, error: exErr } = await supabase
    .from('sheikhs')
    .select('id')
    .eq('name', name)
    .maybeSingle();
  if (exErr) throw exErr;
  if (existing) {
    const { error } = await supabase.from('sheikhs').update({ user_id: userId }).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('sheikhs').insert({ name, user_id: userId });
    if (error) throw error;
  }
}
