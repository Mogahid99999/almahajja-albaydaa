/**
 * Regression for item 9 — offline cold-start hang.
 *
 * A native cold start that is offline for a long time, or "connected but with no
 * internet data", used to hang FOREVER on the boot loader: neither a session nor
 * an error ever settled, so the readiness predicate never became true. These
 * tests pin the invariant that boot resolves via the hard timeout even when
 * `hasUser` stays false and `ensureErrored` never fires — while keeping the web
 * branch a pure `!isLoading` check that the timeout never influences.
 */
import { deriveBootReady } from '@/lib/bootReady';

describe('deriveBootReady — offline cold-start (item 9)', () => {
  const nativeNothingSettled = {
    isWeb: false,
    isLoading: true, // session read still pending
    hasUser: false, // no session resolved
    ensureErrored: false, // anon sign-in stalled, never errored
  };

  it('holds the boot loader while nothing has settled and the timeout has NOT fired', () => {
    expect(deriveBootReady({ ...nativeNothingSettled, timedOut: false })).toBe(false);
  });

  it('falls through the moment the hard boot timeout fires, even with no session and no error', () => {
    // The core fix: connected-but-no-internet, where hasUser + ensureErrored can
    // both stall indefinitely. The timeout is the only thing that resolves boot.
    expect(deriveBootReady({ ...nativeNothingSettled, timedOut: true })).toBe(true);
  });

  it('is ready as soon as a (persisted) session resolves, without waiting for the timeout', () => {
    expect(
      deriveBootReady({ isWeb: false, isLoading: false, hasUser: true, ensureErrored: false, timedOut: false }),
    ).toBe(true);
  });

  it('is ready as soon as the anon sign-in errors (fresh install offline)', () => {
    expect(
      deriveBootReady({ isWeb: false, isLoading: true, hasUser: false, ensureErrored: true, timedOut: false }),
    ).toBe(true);
  });

  describe('web branch is untouched by the timeout', () => {
    it('readiness is just !isLoading — not ready while the auth check runs', () => {
      expect(
        deriveBootReady({ isWeb: true, isLoading: true, hasUser: false, ensureErrored: false, timedOut: true }),
      ).toBe(false);
    });

    it('ready once the auth check finishes, with no silent session', () => {
      expect(
        deriveBootReady({ isWeb: true, isLoading: false, hasUser: false, ensureErrored: false, timedOut: false }),
      ).toBe(true);
    });
  });
});
