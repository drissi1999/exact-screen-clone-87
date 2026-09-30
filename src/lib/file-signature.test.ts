import { describe, expect, it } from "vitest";
import { assertAcceptedFile, detectFileType } from "./file-signature";

const enc = (s: string) => new TextEncoder().encode(s);

describe("upload file signature", () => {
  it("refuses an .html file renamed to .pdf (declared type ignored)", () => {
    const html = enc("<!DOCTYPE html><html><script>alert(1)</script></html>");
    expect(detectFileType(html)).toBeNull();
    expect(() => assertAcceptedFile(html)).toThrow(/Format refusé/);
  });
  it("accepts a real PDF", () => {
    const pdf = enc("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n%%EOF");
    expect(assertAcceptedFile(pdf)).toBe("application/pdf");
  });
  it("recognises JPEG, PNG and HEIC; refuses GIF and text", () => {
    expect(detectFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(detectFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectFileType(new Uint8Array([0, 0, 0, 0x18, ...enc("ftypheic"), 0, 0]))).toBe("image/heic");
    expect(detectFileType(enc("GIF89a...."))).toBeNull();
    expect(detectFileType(enc("nom;prenom\n"))).toBeNull();
  });
});
