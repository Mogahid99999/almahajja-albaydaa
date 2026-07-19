/**
 * Backup & Restore hooks — thin wrappers over src/api/backup.
 *
 * useBackupLog   — the audit history list (TanStack Query).
 * useCreateBackup — imperative create with live progress + cancel. Not a
 *   mutation: it must start inside the button's user gesture (showSaveFilePicker
 *   requires it) and streams progress, which the mutation model doesn't fit.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';

import {
  createBackup,
  isBackupSupported,
  listBackupLog,
  type BackupLogRow,
  type BackupProgress,
} from '@/api/backup';
import {
  RESTORE_ENABLED,
  inspectBackup,
  runRestore,
  type BackupInspection,
  type RestoreProgress,
  type RestoreVerification,
} from '@/api/backupRestore';
import { supabase } from '@/lib/supabase';
import type { BackupMode } from '@/lib/backupFormat';

export function useBackupLog(limit = 20) {
  return useQuery<BackupLogRow[]>({
    queryKey: ['backup-log', limit],
    queryFn: () => listBackupLog(limit),
    staleTime: 30_000,
  });
}

export type CreateBackupState =
  | { status: 'idle' }
  | { status: 'running'; progress: BackupProgress }
  | { status: 'success'; fileName: string; sizeBytes: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

export function useCreateBackup() {
  const qc = useQueryClient();
  const [state, setState] = useState<CreateBackupState>({ status: 'idle' });
  const cancelRef = useRef<null | (() => void)>(null);

  /**
   * Start a backup. Sets state for the progress UI AND returns a promise that
   * resolves on success / rejects on failure — so a caller (e.g. the pre-restore
   * safety backup) can `await` it and gate the next step. Must run synchronously
   * in the gesture: createBackup calls showSaveFilePicker before any await.
   */
  const start = useCallback((mode: BackupMode = 'full'): Promise<{ fileName: string; sizeBytes: number }> => {
    if (!isBackupSupported()) {
      const message = 'المتصفح الحالي لا يدعم إنشاء النسخ الاحتياطية. استخدم Chrome أو Edge على جهاز كمبيوتر.';
      setState({ status: 'error', message });
      return Promise.reject(new Error(message));
    }
    const handle = createBackup((progress) => setState({ status: 'running', progress }), mode);
    cancelRef.current = handle.cancel;
    return handle.promise
      .then((res) => {
        setState({ status: 'success', fileName: res.fileName, sizeBytes: res.sizeBytes });
        qc.invalidateQueries({ queryKey: ['backup-log'] });
        return res;
      })
      .catch((e: Error) => {
        if (e.message === 'cancelled') setState({ status: 'cancelled' });
        else setState({ status: 'error', message: e.message });
        qc.invalidateQueries({ queryKey: ['backup-log'] });
        throw e;
      })
      .finally(() => {
        cancelRef.current = null;
      });
  }, [qc]);

  const cancel = useCallback(() => {
    cancelRef.current?.();
  }, []);

  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { state, start, cancel, reset };
}

// ─── Restore ─────────────────────────────────────────────────────────────────

export { RESTORE_ENABLED };

export type RestoreState =
  | { status: 'idle' }
  | { status: 'inspecting' }
  | { status: 'inspected'; inspection: BackupInspection }
  | { status: 'reauth' | 'confirm'; inspection: BackupInspection }
  | { status: 'running'; progress: RestoreProgress; inspection: BackupInspection }
  | { status: 'success'; verification: RestoreVerification }
  | { status: 'error'; message: string };

/** The typed phrase the admin must enter to confirm a destructive restore. */
export const RESTORE_CONFIRM_PHRASE = 'استعادة';

export function useRestore() {
  const qc = useQueryClient();
  const [state, setState] = useState<RestoreState>({ status: 'idle' });
  const cancelRef = useRef<null | (() => void)>(null);

  /** Step 1: inspect a picked file (read + validate header, verify DB checksums). */
  const inspect = useCallback(async (file: File) => {
    setState({ status: 'inspecting' });
    try {
      const inspection = await inspectBackup(file);
      setState({ status: 'inspected', inspection });
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
    }
  }, []);

  /** Step 2: re-authenticate the admin (destructive-action gate, §19). */
  const reauthenticate = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('فشلت إعادة المصادقة — تحقّق من كلمة المرور.');
  }, []);

  /** Step 3: run the restore against the already-inspected file. */
  const execute = useCallback(
    (file: File, inspection: BackupInspection) => {
      const handle = runRestore(file, inspection, (progress) =>
        setState({ status: 'running', progress, inspection }),
      );
      cancelRef.current = handle.cancel;
      handle.promise
        .then(({ verification }) => setState({ status: 'success', verification }))
        .catch((e: Error) => setState({ status: 'error', message: e.message }))
        .finally(() => {
          cancelRef.current = null;
          qc.invalidateQueries({ queryKey: ['backup-log'] });
        });
    },
    [qc],
  );

  const cancel = useCallback(() => cancelRef.current?.(), []);
  const reset = useCallback(() => setState({ status: 'idle' }), []);
  const setStage = useCallback((s: RestoreState) => setState(s), []);

  return { state, inspect, reauthenticate, execute, cancel, reset, setStage };
}
