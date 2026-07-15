/**
 * Global Jest setup (runs before every test file).
 *
 * Keeps the two module-level import-time hazards inert:
 *  - src/lib/env.ts throws when the EXPO_PUBLIC_* vars are missing — tests
 *    never talk to a real Supabase project, so dummy values are enough (any
 *    module that would actually use the client must mock '@/lib/supabase').
 *  - AsyncStorage / safe-area-context need their official Jest mocks.
 */
process.env.EXPO_PUBLIC_SUPABASE_URL ??= 'https://test-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Reanimated's native worklets runtime doesn't exist under Jest — its official
// mock keeps Animated components/hooks render-only (BottomNavBar etc.).
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native-safe-area-context', () =>
  // The package's official mock is an ESM default export.
  require('react-native-safe-area-context/jest/mock').default,
);
