/**
 * Web admin document picker (platform file: `.web`).
 *
 * On web, expo-document-picker is safe to import eagerly. Using a STATIC import
 * here (instead of a dynamic `await import(...)` at the call site) keeps the
 * module in the main bundle, so Metro never splits it into an on-demand async
 * chunk. That async chunk was the cause of the "Failed to fetch" crash in the
 * web admin's audio/attachment pickers — when Metro restarts (or the page is
 * stale) the chunk URL no longer resolves and the dynamic import rejects.
 */
import { getDocumentAsync } from 'expo-document-picker';

export { getDocumentAsync };
