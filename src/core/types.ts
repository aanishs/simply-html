// Shared, platform-free types. Importable from both Node (CLI/function) and the browser runtime.

export interface BrandTokens {
  /** Display name shown in the page header / hub. */
  name?: string;
  /** Accent color (hex or CSS color keyword), schema-validated before use. */
  accent?: string;
  /** Body font stack override. */
  font?: string;
  /** Logo: a URL or data:image (raster) reference. */
  logo?: string;
  /** Reading density. */
  density?: "comfortable" | "compact";
}

export interface TocEntry {
  level: 2 | 3;
  id: string;
  text: string;
}

export interface RenderResult {
  /** The sanitized, block-id-stamped body HTML (no <html>/<head> wrapper). */
  html: string;
  /** Right-rail table of contents built from h2/h3. */
  toc: TocEntry[];
  /** Stable block ids in document order. */
  blockIds: string[];
  /** Page title (first h1, or the source filename). */
  title: string;
}

export type PageInput =
  | { kind: "markdown"; source: string }
  | { kind: "html"; source: string };

/** /data wire format (identical local and deployed). */
export interface DataGetOk {
  ok: true;
  key: string;
  value: unknown;
  version: string;
}
export interface DataErr {
  ok: false;
  error: { code: string; message?: string; current?: unknown; version?: string };
}
export type DataGetResponse = DataGetOk | DataErr;
