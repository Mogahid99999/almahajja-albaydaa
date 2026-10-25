// Pure request validation for the mushaf-pack function (no Deno/npm imports —
// unit-tested under jest in tests/functions/).

/** Where the Madinah print pack lives in the R2 bucket. */
export const MUSHAF_PREFIX = "mushaf/";
const VERSION_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const PATH_RE = /^(p\d{3}\.ttf|glyphs\.json)\.gz$/;
export const MAX_SIGN = 50;

export type PackRequest =
  | { action: "manifest" }
  | { action: "sign"; version: string; paths: string[] };

/** Parse the JSON body; returns an error string for anything not allowed. */
export function parsePackRequest(body: unknown): PackRequest | string {
  if (!body || typeof body !== "object") return "invalid body";
  const b = body as Record<string, unknown>;
  if (b.action === "manifest") return { action: "manifest" };
  if (b.action !== "sign") return "unknown action";
  if (typeof b.version !== "string" || !VERSION_RE.test(b.version)) return "invalid version";
  if (!Array.isArray(b.paths) || b.paths.length === 0 || b.paths.length > MAX_SIGN) return "invalid paths";
  for (const p of b.paths) if (typeof p !== "string" || !PATH_RE.test(p)) return "invalid path";
  return { action: "sign", version: b.version, paths: b.paths as string[] };
}

/** R2 key of one pack object — only ever inside mushaf/<version>/. */
export const packKey = (version: string, path: string) => `${MUSHAF_PREFIX}${version}/${path}`;
export const isValidVersion = (v: unknown): v is string => typeof v === "string" && VERSION_RE.test(v);
