// PIN brute-force throttle.
//
// For writable / spend-capable pages (--db/--llm, which provision a Blob store) the attempt
// counter is DURABLE in Vercel Blob with ETag CAS, so it survives cold starts and coordinates
// across concurrent lambda instances — the only way a short PIN guarding a writable store is
// actually defensible. Read-only pages have no Blob store, so they fall back to a best-effort
// per-instance counter, which a read-only doc behind a 4-digit PIN tolerates.
//
//   fails   action
//   < 6     counted, no delay
//   6..19   escalating lockout: min(60s, 2^(n-6) s)
//   >= 20   10-minute lockout
import { strip, streamToString, type BlobApi } from "./blob.js";

interface Attempts { n: number; until: number }

function nextUntil(n: number, now: number): number {
  if (n >= 20) return now + 10 * 60_000;
  if (n >= 6) return now + Math.min(60_000, 2 ** (n - 6) * 1000);
  return 0;
}

// --- best-effort, per warm instance (read-only pages) ---
const mem = new Map<string, Attempts>();

// --- durable, Blob-backed (writable pages) ---
const PRIVATE = { access: "private" as const };
const blobPath = (pageId: string) => `sh/${pageId}/_pin_attempts.json`;

async function getBlob(): Promise<BlobApi | null> {
  try { return (await import("@vercel/blob")) as unknown as BlobApi; } catch { return null; }
}

async function readDurable(blob: BlobApi, pageId: string): Promise<{ a: Attempts; etag: string | null }> {
  try {
    const etag = strip((await blob.head(blobPath(pageId), PRIVATE)).etag);
    const g = await blob.get(blobPath(pageId), PRIVATE);
    if (g && g.statusCode === 200 && g.stream) {
      const s = JSON.parse(await streamToString(g.stream)) as Attempts;
      return { a: { n: s.n || 0, until: s.until || 0 }, etag };
    }
    return { a: { n: 0, until: 0 }, etag };
  } catch {
    return { a: { n: 0, until: 0 }, etag: null };
  }
}

async function writeDurable(blob: BlobApi, pageId: string, a: Attempts, etag: string | null): Promise<void> {
  await blob.put(blobPath(pageId), JSON.stringify(a), {
    ...PRIVATE,
    allowOverwrite: true,
    contentType: "application/json",
    ...(etag ? { ifMatch: `"${etag}"` } : {}),
  });
}

/** Is this page currently locked out? */
export async function isThrottled(pageId: string, now: number, durable: boolean): Promise<boolean> {
  const blob = durable ? await getBlob() : null;
  if (!blob) { const a = mem.get(pageId); return !!a && a.until > now; }
  const { a } = await readDurable(blob, pageId);
  return a.until > now;
}

/** Record a failed PIN attempt (advances the lockout). */
export async function recordFail(pageId: string, now: number, durable: boolean): Promise<void> {
  const blob = durable ? await getBlob() : null;
  if (!blob) {
    const a = mem.get(pageId) || { n: 0, until: 0 };
    a.n += 1;
    a.until = nextUntil(a.n, now) || a.until;
    mem.set(pageId, a);
    return;
  }
  for (let i = 0; i < 3; i++) {
    const { a, etag } = await readDurable(blob, pageId);
    const n = a.n + 1;
    try { await writeDurable(blob, pageId, { n, until: nextUntil(n, now) }, etag); return; }
    catch (e) { if ((e as Error)?.name === "BlobPreconditionFailedError") continue; return; }
  }
}

/** Clear attempts after a correct PIN. */
export async function recordOk(pageId: string, durable: boolean): Promise<void> {
  const blob = durable ? await getBlob() : null;
  if (!blob) { mem.delete(pageId); return; }
  try { await writeDurable(blob, pageId, { n: 0, until: 0 }, null); } catch { /* best effort */ }
}
