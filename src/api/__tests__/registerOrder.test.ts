/**
 * register() — email/password ordering (iOS data-minimisation regression).
 *
 * On iOS there is no phone: the email is the ONLY identifier. GoTrue refuses to
 * set a password on an anonymous user that still has no email AND no phone
 * ("Updating password of an anonymous user without an email or phone is not
 * allowed") — and because that message contains the word "password" it surfaced
 * to the user as a bogus «كلمة المرور ضعيفة أو غير صالحة». So on the no-phone
 * path the email MUST be attached (register-set-email edge fn) BEFORE the
 * password update. On Android the phone is sent inline with the password, so the
 * email stays a best-effort step AFTER.
 *
 * These tests pin the call ORDER at the supabase seam (per Stack conventions,
 * src/api/* unit tests mock @/lib/supabase, not the network).
 */

// Order of calls, recorded across both mocked supabase entry points.
const mockCalls: string[] = [];

const mockUpdateUser: jest.Mock = jest.fn(async () => {
  mockCalls.push('updateUser');
  return { data: { user: mockUser }, error: null };
});
const mockInvoke: jest.Mock = jest.fn(async () => {
  mockCalls.push('register-set-email');
  return { data: { ok: true }, error: null };
});
const mockRpc: jest.Mock = jest.fn(async () => ({ data: null, error: null }));

let mockUser: Record<string, unknown>;

jest.mock('@/lib/supabase', () => ({
  LAST_SESSION_KEY: 'last-session',
  supabase: {
    auth: {
      updateUser: (...a: unknown[]) => mockUpdateUser(...a),
      getSession: async () => ({ data: { session: null } }),
    },
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => {}),
  getItem: jest.fn(async () => null),
  removeItem: jest.fn(async () => {}),
}));

import { register } from '../auth';

beforeEach(() => {
  mockCalls.length = 0;
  mockUpdateUser.mockClear();
  mockInvoke.mockClear();
  mockRpc.mockClear();
  mockUser = {
    id: 'u1',
    email: '',
    phone: '',
    is_anonymous: false,
    user_metadata: { display_name: 'محمد' },
  };
});

describe('iOS (no phone): email is set BEFORE the password', () => {
  test('register-set-email runs before updateUser', async () => {
    await register('محمد', '', '249', 'ios@example.com', 'password123', null);
    // The email (identifier) must land first so GoTrue accepts the password.
    expect(mockCalls).toEqual(['register-set-email', 'updateUser']);
    // No phone in the password-set call, no gender in metadata.
    expect(mockUpdateUser).toHaveBeenCalledWith({
      password: 'password123',
      data: { display_name: 'محمد' },
    });
  });

  test('a failed email save is FATAL on the no-phone path (would leave the account unreachable)', async () => {
    mockInvoke.mockImplementationOnce(async () => {
      mockCalls.push('register-set-email');
      return { data: null, error: new Error('function down') };
    });
    mockInvoke.mockImplementationOnce(async () => {
      mockCalls.push('register-set-email');
      return { data: null, error: new Error('function down') };
    });
    await expect(
      register('محمد', '', '249', 'ios@example.com', 'password123', null),
    ).rejects.toThrow('function down');
    // Password is never set on an account whose email failed to attach.
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe('Android (phone present): phone+password first, email best-effort after', () => {
  test('updateUser (with phone) runs before register-set-email', async () => {
    await register('محمد', '0912345678', '249', 'a@example.com', 'password123', 'male');
    expect(mockCalls).toEqual(['updateUser', 'register-set-email']);
    expect(mockUpdateUser).toHaveBeenCalledWith({
      phone: '249912345678',
      password: 'password123',
      data: { display_name: 'محمد', gender: 'male' },
    });
  });

  test('a failed email save is NON-fatal when a phone identifier exists', async () => {
    mockInvoke.mockImplementation(async () => {
      mockCalls.push('register-set-email');
      return { data: null, error: new Error('function down') };
    });
    // Registration still succeeds — the phone is the identifier.
    await expect(
      register('محمد', '0912345678', '249', 'a@example.com', 'password123', 'male'),
    ).resolves.toMatchObject({ isGuest: false });
  });
});
