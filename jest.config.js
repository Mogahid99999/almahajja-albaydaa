/**
 * Jest + React Native Testing Library (audit phase 12).
 *
 * Two test roots, one convention (documented in CLAUDE.md › Testing):
 *  - "src/<module>/__tests__/<name>.test.ts(x)" — colocated unit tests for pure logic.
 *  - "tests/screens/<screen>.test.tsx" — component tests for app/ route screens.
 *    Screen tests CANNOT live inside app/: Expo Router treats every file in
 *    app/ as a route, so a colocated test file would become a broken screen.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // react-native-worklets has no native runtime under Jest; its shipped
  // resolver redirects to the JS implementations (needed by reanimated).
  resolver: 'react-native-worklets/jest/resolver.js',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  moduleNameMapper: {
    // Mirror tsconfig.json's `@/*` → `./src/*` alias.
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts?(x)', '<rootDir>/tests/**/*.test.ts?(x)'],
  // jest-expo's transformIgnorePatterns already whitelists expo/react-native
  // packages; keep the default.
  clearMocks: true,
};
