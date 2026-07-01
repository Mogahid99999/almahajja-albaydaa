/**
 * Native document picker (default platform file; web overrides via `.web.ts`).
 *
 * Importing expo-document-picker on native runs a native-module resolution
 * side-effect that crashes the student app in Expo Go. Picking only ever happens
 * on the web admin, so on native we never import it at module top-level: we
 * `require` it lazily inside the call, which works in a standalone/dev build and
 * is simply never reached in the student app. Metro keeps it in the main bundle
 * (no async chunk), so there is no "Failed to fetch" failure mode here either.
 */
import type { getDocumentAsync as GetDocumentAsync } from 'expo-document-picker';

export const getDocumentAsync: typeof GetDocumentAsync = async (...args) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('expo-document-picker') as typeof import('expo-document-picker');
  return mod.getDocumentAsync(...args);
};
