// One-line stdout logging (`docker logs almahajja-media-worker`).
// Format: `<iso-ts> <LEVEL> <event> key=value …`. Callers must never pass
// secrets; values are JSON-quoted when they contain spaces or quotes.

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type Logger = (level: LogLevel, event: string, fields?: LogFields) => void;

function fmt(value: string | number | boolean | null): string {
  const s = String(value);
  return /[\s"=]/.test(s) || s === '' ? JSON.stringify(s) : s;
}

export function formatLine(level: LogLevel, event: string, fields: LogFields = {}, now = new Date()): string {
  const parts = [now.toISOString(), level.toUpperCase(), event];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    parts.push(`${k}=${fmt(v)}`);
  }
  return parts.join(' ');
}

export const consoleLogger: Logger = (level, event, fields) => {
  const line = formatLine(level, event, fields);
  if (level === 'error') console.error(line);
  else console.log(line);
};

export const silentLogger: Logger = () => {};

/** Error → short single-line message (no stack), capped to `max` chars. */
export function errorMessage(err: unknown, max = 500): string {
  let msg: string;
  if (err instanceof Error) msg = err.message || err.name;
  else if (typeof err === 'string') msg = err;
  else {
    try {
      msg = JSON.stringify(err);
    } catch {
      msg = String(err);
    }
  }
  msg = msg.replace(/\s+/g, ' ').trim() || 'unknown error';
  return msg.length > max ? `${msg.slice(0, max - 1)}…` : msg;
}
