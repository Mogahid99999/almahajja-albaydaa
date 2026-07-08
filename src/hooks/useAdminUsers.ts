import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  banUser,
  createUser,
  deleteUser,
  getAdminUserDetail,
  getAdminUserList,
  setUserPassword,
  setUserRole,
  unbanUser,
  updateUserEmail,
  updateUserName,
  updateUserPhone,
} from '@/api/adminUsers';
import type { AppRole } from '@/api/auth';
import { queryKeys } from '@/constants/queryKeys';

export function useAdminUsers(search: string) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.adminUsers(search),
    queryFn: ({ pageParam }) => getAdminUserList(search, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    staleTime: 30_000,
  });
  return {
    ...query,
    data: query.data?.pages.flatMap((p) => p.items) ?? [],
  };
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createUser>[0]) => createUser(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

/**
 * Ban any account by id — used by the admin Q&A screen to «block the author»
 * (full account ban, reversible via Users › تفعيل). The Edge Function rejects
 * banning your own account, so an admin can't lock themselves out here.
 */
export function useBanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => banUser(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export function useAdminUserDetail(userId: string) {
  return useQuery({
    queryKey: queryKeys.adminUserDetail(userId),
    queryFn: () => getAdminUserDetail(userId),
    enabled: !!userId,
  });
}

/**
 * All privileged user actions in one mutation object. Every success invalidates
 * the user list + that user's detail so the derived status/role re-reads.
 */
export function useAdminUserActions(userId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    qc.invalidateQueries({ queryKey: queryKeys.adminUserDetail(userId) });
  };

  return {
    ban: useMutation({ mutationFn: () => banUser(userId), onSuccess: invalidate }),
    unban: useMutation({ mutationFn: () => unbanUser(userId), onSuccess: invalidate }),
    setPassword: useMutation({
      mutationFn: (password: string) => setUserPassword(userId, password),
    }),
    setEmail: useMutation({
      mutationFn: (email: string) => updateUserEmail(userId, email),
      onSuccess: invalidate,
    }),
    setPhone: useMutation({
      mutationFn: (phone: string) => updateUserPhone(userId, phone),
      onSuccess: invalidate,
    }),
    setName: useMutation({
      mutationFn: (name: string) => updateUserName(userId, name),
      onSuccess: invalidate,
    }),
    setRole: useMutation({
      mutationFn: (role: AppRole) => setUserRole(userId, role),
      onSuccess: invalidate,
    }),
    // Only invalidates the LIST — the detail query for this (now-gone) user is
    // pointless to refetch; the caller navigates away on success instead.
    deleteUser: useMutation({
      mutationFn: () => deleteUser(userId),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
    }),
  };
}
