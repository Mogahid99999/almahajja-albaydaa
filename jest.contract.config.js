/**
 * Contract tests against the STAGING Supabase project (audit phase 12 task 3).
 * Run explicitly with `npm run test:contract` — needs `.env.staging.local` and
 * network, so it is NOT part of `npm test` or CI. Hard rule: staging only —
 * tests/contract/setup.ts refuses to run against the production project ref.
 */
/** @type {import('jest').Config} */
module.exports = {
  // NOT jest-expo: these tests need Node's real fetch/network, no RN mocks.
  // babel-jest picks up babel.config.js (babel-preset-expo handles TS).
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/contract/setup.ts'],
  testMatch: ['<rootDir>/tests/contract/**/*.contract.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testTimeout: 30000,
};
