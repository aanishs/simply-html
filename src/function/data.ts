// Flag-gated /data store on Vercel Blob (private access + ETag CAS). Only loaded when --db.
// Uses @vercel/blob 2.x: private blobs, head().etag as the version token, and put({ifMatch})
// for atomic compare-and-swap so concurrent PIN-holders can't silently clobber each other.
import { readBody, type VercelRequest, type VercelResponse } from "./http.js";
import { strip, streamToString, type BlobApi } from "./blob.js";

const KEY = /^[a-zA-Z0-9._:-]{1,128}$/;
const dataPath = (pageId: string, key: string) => `sh/${pageId}/data/${key}.json`;

export async function handleData(req: VercelRequest, res: VercelResponse, pageId: string): Promise<void> {
  const url = new URL(req.url || "/", "http://x");
  const key = url.searchParams.get("key") || "";
  if (!KEY.test(key)) { res.status(400).json({ ok: false, error: { code: "BAD_KEY" } }); return; }
  const pathname = dataPath(pageId, key);
  const blob = (await import("@vercel/blob")) as unknown as BlobApi;
  const PRIVATE = { access: "private" as const };

  if (req.method === "GET") {
    let etag: string;
    try {
      etag = (await blob.head(pathname, PRIVATE)).etag;
    } catch {
      res.status(404).json({ ok: false, error: { code: "NOT_FOUND" } });
      return;
    }
    const g = await blob.get(pathname, PRIVATE);
    if (!g || g.statusCode !== 200 || !g.stream) {
      res.status(404).json({ ok: false, error: { code: "NOT_FOUND" } });
      return;
    }
    let value: unknown = null;
    try { value = JSON.parse(await streamToString(g.stream)); } catch { value = null; }
    res.status(200).json({ ok: true, key, value, version: strip(etag) });
    return;
  }

  if (req.method === "PUT") {
    const b = await readBody(req);
    const expected = (b as { expectedVersion?: string }).expectedVersion;
    const value = (b as { value?: unknown }).value ?? null;
    if (JSON.stringify(value).length > 256 * 1024) {
      res.status(413).json({ ok: false, error: { code: "TOO_LARGE" } });
      return;
    }
    let curEtagRaw: string | null = null;
    try { curEtagRaw = (await blob.head(pathname, PRIVATE)).etag; } catch { curEtagRaw = null; }
    // Compare-and-swap: a provided expectedVersion must match the current (stripped) etag.
    if (expected != null && (curEtagRaw == null || strip(curEtagRaw) !== expected)) {
      res.status(409).json({ ok: false, error: { code: "VERSION_CONFLICT", version: curEtagRaw ? strip(curEtagRaw) : null } });
      return;
    }
    try {
      await blob.put(pathname, JSON.stringify(value), {
        ...PRIVATE,
        allowOverwrite: true,
        contentType: "application/json",
        ...(curEtagRaw ? { ifMatch: curEtagRaw } : {}),
      });
    } catch (e) {
      // ifMatch lost the race -> someone wrote between our head and put.
      if ((e as Error)?.name === "BlobPreconditionFailedError") {
        res.status(409).json({ ok: false, error: { code: "VERSION_CONFLICT" } });
        return;
      }
      throw e;
    }
    const newEtag = await blob.head(pathname, PRIVATE).then((h) => strip(h.etag)).catch(() => "");
    res.status(200).json({ ok: true, key, version: newEtag });
    return;
  }
  res.status(405).json({ ok: false, error: { code: "METHOD" } });
}
