/** Accepted upload formats, recognised from the file's real first bytes (never the declared type or extension). */
export type AcceptedMime = "application/pdf" | "image/jpeg" | "image/png" | "image/heic";

const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

export function detectFileType(bytes: Uint8Array): AcceptedMime | null {
  if (starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return "image/heic";
  return null;
}

export const UPLOAD_REFUSED = "Format refusé : seuls les fichiers PDF, JPEG, PNG et HEIC sont acceptés.";

/** Throws when the content is not one of the accepted formats; returns the real MIME type to store. */
export function assertAcceptedFile(bytes: Uint8Array): AcceptedMime {
  const mime = detectFileType(bytes);
  if (!mime) throw new Error(UPLOAD_REFUSED);
  return mime;
}

export const UPLOAD_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic";
