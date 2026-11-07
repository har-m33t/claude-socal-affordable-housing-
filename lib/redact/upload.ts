/**
 * Client-side upload gate for Pointer.
 *
 * Accepts PDF, PNG and JPEG only, up to 10 MB. The file's first bytes decide
 * what it is; the file name and the browser-reported MIME type must agree with
 * those bytes, never the other way round. Returns a safe file name for display
 * and later use. Browser-safe: uses only Blob APIs, no network or storage.
 *
 * This is a gate, not a malware scanner: a well-formed PDF can still carry
 * hostile content, which is why PDFs are rendered by pdf.js with scripting off.
 */

export type UploadKind = "pdf" | "png" | "jpeg";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_FILENAME_LENGTH = 100;

export type UploadCheck =
  | { ok: true; safeName: string; kind: UploadKind; size: number }
  | { ok: false; reason: string };

/** A browser `File`, or any Blob with a name (e.g. from a drag-and-drop or a test). */
export type UploadInput = Blob & { readonly name?: string };

const KIND_LABEL: Record<UploadKind, string> = { pdf: "PDF", png: "PNG image", jpeg: "JPEG image" };
const EXTENSIONS: Record<UploadKind, readonly string[]> = {
  pdf: ["pdf"],
  png: ["png"],
  jpeg: ["jpg", "jpeg"],
};
const MIME_TYPES: Record<UploadKind, readonly string[]> = {
  pdf: ["application/pdf", "application/x-pdf"],
  png: ["image/png"],
  jpeg: ["image/jpeg", "image/pjpeg"],
};
const ALLOWED_EXTENSIONS = new Set(Object.values(EXTENSIONS).flat());

const NOT_ALLOWED =
  "Only PDF, PNG and JPEG files can be uploaded, and this file's contents are not one of those.";

/** Identify a file from its first bytes. Returns null for anything we do not accept. */
export function sniffKind(head: Uint8Array): UploadKind | null {
  const starts = (sig: readonly number[]) => sig.every((b, i) => head[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf"; // %PDF-
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts([0xff, 0xd8, 0xff])) return "jpeg";
  return null;
}

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Make a file name safe to show and store: drop any path, control characters
 * and `..`; keep only A-Z a-z 0-9 . _ -; cap the length; end with the right
 * extension for `kind`.
 */
export function sanitizeFilename(name: string, kind: UploadKind): string {
  const base = (name.normalize("NFKD").replace(/\p{M}/gu, "").split(/[\\/]/).pop() ?? "").replace(
    /[\u0000-\u001f\u007f]/g,
    "",
  );
  const ext = extensionOf(base);
  const keepExt = EXTENSIONS[kind].includes(ext) ? ext : EXTENSIONS[kind][0];
  const stemRaw = ALLOWED_EXTENSIONS.has(ext) ? base.slice(0, base.length - ext.length - 1) : base;

  let stem = stemRaw
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/([._-])[._-]+/g, "$1")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (WINDOWS_RESERVED.test(stem)) stem = `file_${stem}`;
  stem = stem.slice(0, MAX_FILENAME_LENGTH - keepExt.length - 1).replace(/[._-]+$/, "");
  return `${stem || "upload"}.${keepExt}`;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Check an upload before any of it is read into the app. Never throws for bad input. */
export async function validateUpload(file: UploadInput): Promise<UploadCheck> {
  const name = typeof file.name === "string" ? file.name : "";
  const size = file.size;

  if (size === 0) return { ok: false, reason: "This file is empty. Please choose the file again." };
  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      reason: `This file is ${formatMb(size)}, over the ${formatMb(MAX_UPLOAD_BYTES)} limit. Please upload a smaller file or split the document.`,
    };
  }

  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  } catch {
    return { ok: false, reason: "This file could not be read. Please choose it again." };
  }

  const kind = sniffKind(head);
  if (!kind) return { ok: false, reason: NOT_ALLOWED };

  const ext = extensionOf(name);
  if (ext && !EXTENSIONS[kind].includes(ext)) {
    return {
      ok: false,
      reason: `The file name ends in .${ext.slice(0, 10)} but the file is a ${KIND_LABEL[kind]}. Please check you picked the right file.`,
    };
  }

  const mime = (file.type || "").toLowerCase().split(";")[0]!.trim();
  if (mime && !MIME_TYPES[kind].includes(mime)) {
    return {
      ok: false,
      reason: `Your browser says this file is "${mime.slice(0, 40)}" but its contents are a ${KIND_LABEL[kind]}. Please check you picked the right file.`,
    };
  }

  return { ok: true, safeName: sanitizeFilename(name, kind), kind, size };
}
