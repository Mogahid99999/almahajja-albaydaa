import { useMutation } from '@tanstack/react-query';

import { submitRating } from '@/api/ratings';

export function useSubmitRating() {
  return useMutation({
    mutationFn: (vars: { stars: number; message?: string }) =>
      submitRating(vars.stars, vars.message),
  });
}
