// URL polyfill must be imported before the supabase client on React Native.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { Database } from '@/types/database';
import { env } from './env';

/**
 * The single Supabase client for the whole app.
 *
 * - Sessions are persisted with AsyncStorage (works on native and web).
 * - `detectSessionInUrl` is only enabled on web, where OAuth/magic-link
 *   redirects come back through the URL.
 *
 * Components must NOT import this directly — all data access goes through
 * `src/api/*` (see CLAUDE.md › Stack conventions).
 */
export const supabase = createClient<Database>(
  env.supabaseUrl,
  env.supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  },
);
