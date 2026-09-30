/**
 * src/lib/liveClient.ts — the pure P4 parsers (the SDK itself is never loaded in Jest).
 *  - room metadata {allowRequests}: anything unreadable keeps «طلب التحدث» OPEN
 *    (a moderator closes it explicitly; a parse glitch must not silence the room);
 *  - the server's control data message {t:'rejected'} → «اعتذر المشرف…».
 */
import { parseAllowRequests, parseControlMessage } from '@/lib/liveClient';

const bytes = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

describe('parseAllowRequests', () => {
  test('explicit false closes requests; true / missing / junk keep them open', () => {
    expect(parseAllowRequests('{"allowRequests":false}')).toBe(false);
    expect(parseAllowRequests('{"allowRequests":true}')).toBe(true);
    expect(parseAllowRequests('')).toBe(true);
    expect(parseAllowRequests(undefined)).toBe(true);
    expect(parseAllowRequests('not json')).toBe(true);
    expect(parseAllowRequests('null')).toBe(true);
  });
});

describe('parseControlMessage', () => {
  test('reads t from the reject message; junk → null', () => {
    expect(parseControlMessage(bytes('{"t":"rejected"}'))).toBe('rejected');
    expect(parseControlMessage(bytes('{"x":1}'))).toBeNull();
    expect(parseControlMessage(bytes('\u0000\u0001'))).toBeNull();
  });
});
