// =============================================================================
// send-certificate-email (0180): sends one certificate email through Resend.
// Called only by the certificate service (vps/certs) with the service-role key; the Resend key
// stays here as the RESEND_API_KEY secret. The sender is fixed; one recipient per call.
// The message itself (HTML, inline image, PDF) is built by the service.
// =============================================================================
const FROM = "المَحجّة البَيْضَاء <no-reply@almahajja.app>";
const MAX_BYTES = 6_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Deployed with --no-verify-jwt: production's service key is the new non-JWT format
// (sb_secret_…), which the gateway's JWT check rejects. Instead the caller's key is accepted
// only if Supabase itself accepts it for an admin-only call (legacy service_role JWT or secret key).
// Only the certificate service holds such a key.
async function isServiceKey(key: string): Promise<boolean> {
  if (!key) return false;
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/users?per_page=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    await r.body?.cancel();
    return r.ok;
  } catch {
    return false;
  }
}

type Attachment = { filename: string; content: string; content_id?: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  // Read the body before any early answer: a large unread request body (the PDF) stalls the
  // gateway until the caller times out, instead of returning the 403/503.
  const raw = await req.text();
  const key = req.headers.get("apikey") ?? (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!(await isServiceKey(key))) return json({ error: "forbidden" }, 403);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ error: "no_resend_key" }, 503);

  if (raw.length > MAX_BYTES) return json({ error: "too large" }, 413);
  let p: {
    to?: string; subject?: string; html?: string; text?: string;
    idempotency_key?: string; attachments?: Attachment[];
  };
  try {
    p = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const to = String(p.to ?? "").trim();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to) || !p.subject || !p.html) {
    return json({ error: "invalid message" }, 400);
  }
  const attachments = (p.attachments ?? []).slice(0, 5).map((a) => ({
    filename: String(a.filename),
    content: String(a.content),
    ...(a.content_id ? { content_id: String(a.content_id) } : {}),
  }));

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      ...(p.idempotency_key ? { "Idempotency-Key": String(p.idempotency_key).slice(0, 256) } : {}),
    },
    body: JSON.stringify({ from: FROM, to: [to], subject: p.subject, html: p.html, text: p.text, attachments }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await r.text();
  if (!r.ok) return json({ error: "resend", status: r.status, detail: body.slice(0, 300) }, 502);
  return json({ ok: true, id: (() => { try { return JSON.parse(body).id; } catch { return null; } })() });
});
