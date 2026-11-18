import { act, renderHook } from '@testing-library/react-native';

import { queryKeys } from '@/constants/queryKeys';
import { queryClient } from '@/lib/queryClient';

import { useCurrentUserId } from '../useCurrentUserId';

describe('useCurrentUserId', () => {
  afterEach(() => queryClient.clear());

  it('sees the new account after sign-in clears the query cache', async () => {
    queryClient.setQueryData(queryKeys.currentUser, { id: 'guest' });
    const view = await renderHook(() => useCurrentUserId());
    expect(view.result.current).toBe('guest');
    await act(async () => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.currentUser, { id: 'student' });
    });
    expect(view.result.current).toBe('student');
  });
});
