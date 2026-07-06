import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { searchContent } from '@/api/search';
import { queryKeys } from '@/constants/queryKeys';

/** Debounced lecture/section search — same 350ms pattern as useBuddySearch. */
export function useContentSearch(query: string) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  return useQuery({
    queryKey: queryKeys.contentSearch(debounced),
    queryFn: () => searchContent(debounced),
    enabled: debounced.trim() !== '',
  });
}
