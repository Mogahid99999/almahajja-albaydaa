import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  adminListReports,
  adminSetReportStatus,
  reportContent,
  type ReportContentType,
  type ReportStatus,
} from '@/api/reports';
import { queryKeys } from '@/constants/queryKeys';

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.reports() });
    },
  });
}
