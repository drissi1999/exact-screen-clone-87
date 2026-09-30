/** Case summary: approved facts only, and every citation checked against the facts actually sent to the AI. */
export const SUMMARY_MODEL = "google/gemini-2.5-flash";

export type SummaryEvent = { id: string; status: string; event_date: string | null; label: string; source_filename: string | null; source_page: number | null; confidentiality: string };
export type SentFact = SummaryEvent & { cite: string };

const citeOf = (e: SummaryEvent) => `[${e.source_filename ?? "?"}, p.${e.source_page ?? "?"}]`;
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Only APPROVED facts ever reach the AI. */
export function approvedFacts(events: SummaryEvent[]): SentFact[] {
  return events.filter((e) => e.status === "APPROVED").map((e) => ({ ...e, cite: citeOf(e) }));
}

export function factsPrompt(facts: SentFact[]): string {
  return facts.map((f, i) => `${i + 1}. ${f.event_date ?? "date à vérifier"} — ${f.label} ${f.cite}`).join("\n");
}

const isHeading = (s: string) => /^#+\s/.test(s) || /^\**[\p{L}' ]{1,40}\**\s*:?$/u.test(s);

/**
 * Keeps sentences whose citations all match a fact that was sent; a sentence with no citation or with
 * an unknown one is removed from the text and listed under "Points à vérifier".
 */
export function verifyCitations(text: string, facts: SentFact[]): { text: string; flagged: string[] } {
  const allowed = new Set(facts.map((f) => norm(f.cite)));
  const kept: string[] = [];
  const flagged: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) { kept.push(""); continue; }
    if (isHeading(line.replace(/^[-*•]\s*/, ""))) {
      if (!/points à vérifier/i.test(line)) kept.push(rawLine);
      continue;
    }
    const bullet = /^[-*•]\s*/.exec(line)?.[0] ?? "";
    const sentences = line.slice(bullet.length).split(/(?<=[.!?])\s+(?=[^\s[])/);
    const ok: string[] = [];
    for (const s of sentences) {
      const cites = s.match(/\[[^\]]*\]/g) ?? [];
      if (cites.length > 0 && cites.every((c) => allowed.has(norm(c)))) ok.push(s);
      else flagged.push(s.trim());
    }
    if (ok.length) kept.push(bullet + ok.join(" "));
  }
  let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (flagged.length) out += `\n\nPoints à vérifier\n${flagged.map((f) => `- ${f}`).join("\n")}`;
  return { text: out, flagged };
}
