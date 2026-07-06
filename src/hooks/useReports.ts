import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminListReports,
  adminSetReportStatus,
  reportContent,
  type AdminReportRow,
  type ReportContentType,
  type ReportStatus,
} from '@/api/reports';
import { queryKeys } from '@/constants/queryKeys';

const REPORTS_ROOT = ['admin', 'reports'] as const;

export function useReportContent() {
  return useMutation({
    mutationFn: (vars: { contentType: ReportContentType; contentId: string; reason?: string }) =>
      reportContent(vars.contentType, vars.contentId, vars.reason),
  });
}

// ─── Admin moderation ─────────────────────────────────────────────────────────

export function useAdminReports(status?: ReportStatus, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports(status),
    queryFn: () => adminListReports(status),
    enabled,
  });
}

export function useAdminSetReportStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { reportId: string; status: ReportStatus }) =>
      adminSetReportStatus(vars.reportId, vars.status),
    // Optimistic: update the row across every status filter's cache so the
    // report leaves «مفتوحة» the instant it's actioned.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: REPORTS_ROOT });
      const snapshots = qc.getQueriesData<AdminReportRow[]>({ queryKey: REPORTS_ROOT });
      qc.setQueriesData<AdminReportRow[]>({ queryKey: REPORTS_ROOT }, (rows) =>
        rows?.map((r) => (r.id === vars.reportId ? { ...r, status: vars.status } : r)),
      );
      return { snapshots };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: REPORTS_ROOT });
    },
  });
}
