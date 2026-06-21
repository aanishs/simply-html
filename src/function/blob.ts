// Shared Vercel Blob helpers, used by both the /data store and the /llm durable caps.
// Loaded only on the --db/--llm paths (the function dynamic-imports @vercel/blob there).
import { text } from "node:stream/consumers";

/** ETags come back quoted (`"abc"`); the raw value is needed for ifMatch, the bare value for clients. */
export const strip = (etag: string): string => etag.replace(/^"|"$/g, "");

/** Read a stream (web ReadableStream or node Readable) to a string — stdlib handles both. */
export const streamToString = (stream: unknown): Promise<string> =>
  text(stream as Parameters<typeof text>[0]);

/** The slice of the @vercel/blob 2.x surface we use (loosely typed at the dynamic-import seam). */
export interface BlobApi {
  head: (p: string, o?: Record<string, unknown>) => Promise<{ etag: string }>;
  get: (p: string, o?: Record<string, unknown>) => Promise<{ statusCode: number; stream?: unknown } | null>;
  put: (p: string, b: string, o: Record<string, unknown>) => Promise<{ url: string }>;
}
