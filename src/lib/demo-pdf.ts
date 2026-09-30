/**
 * Minimal one-page PDF generator for fictional demo documents (no dependency).
 * Every page carries a large diagonal "DOCUMENT FICTIF" watermark plus a footer mention.
 */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Latin-1 bytes (WinAnsi covers French accents); unsupported characters become "?". */
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) {
    let c = s.charCodeAt(i);
    if (c === 0x2019) c = 0x27; // ’
    else if (c === 0x2014 || c === 0x2013) c = 0x2d; // — –
    else if (c === 0x0153) c = 0x9c; // œ
    else if (c === 0x20ac) c = 0x80; // €
    out[i] = c < 256 ? c : 0x3f;
  }
  return out;
}

function wrap(line: string, max = 88): string[] {
  const words = line.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  out.push(cur);
  return out;
}

export function buildDemoPdf(title: string, lines: string[]): Uint8Array {
  const body = lines.flatMap((l) => (l === "" ? [""] : wrap(l)));
  let y = 760;
  const text = [
    `BT /F2 16 Tf 60 ${y} Td (${esc(title)}) Tj ET`,
    ...body.map((l) => { y -= 16; return `BT /F1 11 Tf 60 ${y} Td (${esc(l)}) Tj ET`; }),
  ].join("\n");
  const watermark = "q 0.82 g BT /F2 64 Tf 0.7071 0.7071 -0.7071 0.7071 150 230 Tm (DOCUMENT FICTIF) Tj ET Q";
  const footer = "q 0.4 g BT /F1 9 Tf 60 40 Td (DOCUMENT FICTIF - prototype Reprise, aucune personne reelle) Tj ET Q";
  const stream = `${watermark}\n${text}\n${footer}`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${latin1(stream).length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(latin1(pdf).length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = latin1(pdf).length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(pdf);
}
