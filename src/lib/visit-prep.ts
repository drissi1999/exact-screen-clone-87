/** Pure helpers for "Préparer la visite": gap detection and fallback questions. */

export type PrepEvent = { id: string; event_date: string | null; label: string; status: string; source_filename?: string | null; source_page?: number | null };
export type Gap = { code: "FICHE_POSTE" | "ARRET" | "FAITS_A_VALIDER" | "DATE_CONFLIT"; text: string };

const FR_DATE = /(\d{2})\/(\d{2})\/(\d{4})/g;
const toIso = (d: string, m: string, y: string) => `${y}-${m}-${d}`;
const fr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Missing documents, unvalidated facts and conflicting return dates. */
export function computeGaps(input: { docTypes: string[]; events: PrepEvent[]; episodeEnd: string | null }): Gap[] {
  const gaps: Gap[] = [];
  if (!input.docTypes.includes("FICHE_POSTE")) gaps.push({ code: "FICHE_POSTE", text: "Fiche de poste manquante" });
  if (!input.docTypes.includes("ARRET_TRAVAIL")) gaps.push({ code: "ARRET", text: "Aucun avis d'arrêt de travail au dossier" });
  const drafts = input.events.filter((e) => e.status === "DRAFT").length;
  if (drafts) gaps.push({ code: "FAITS_A_VALIDER", text: `${drafts} fait${drafts > 1 ? "s" : ""} de la chronologie non validé${drafts > 1 ? "s" : ""}` });
  if (input.episodeEnd) {
    for (const e of input.events) {
      if (!/reprise/i.test(e.label)) continue;
      for (const m of e.label.matchAll(FR_DATE)) {
        const d = toIso(m[1]!, m[2]!, m[3]!);
        if (d !== input.episodeEnd && d > input.episodeEnd) {
          const src = e.source_filename ? ` (${e.source_filename}${e.source_page ? `, p.${e.source_page}` : ""})` : "";
          gaps.push({ code: "DATE_CONFLIT", text: `Dates de reprise différentes : ${fr(d)}${src} contre une fin d'arrêt au ${fr(input.episodeEnd)}` });
          break;
        }
      }
    }
  }
  return gaps;
}

/** Template questions used when the AI is unavailable; always 3 to 5. */
export function fallbackQuestions(gaps: Gap[]): string[] {
  const q: string[] = [];
  for (const g of gaps) {
    if (g.code === "FICHE_POSTE") q.push("Pouvez-vous décrire vos tâches principales et les efforts physiques de votre poste ?");
    if (g.code === "DATE_CONFLIT") q.push("Quelle date de reprise vous a été indiquée par votre médecin traitant ou votre chirurgien ?");
    if (g.code === "ARRET") q.push("Pouvez-vous nous transmettre votre dernier avis d'arrêt de travail ?");
  }
  q.push("Comment envisagez-vous votre retour au travail ?", "Quelles difficultés anticipez-vous sur votre poste ?", "Avez-vous échangé avec votre employeur depuis le début de l'arrêt ?");
  return [...new Set(q)].slice(0, 5);
}

/** Parses AI output into 3–5 trimmed questions, or null when unusable. */
export function parseQuestions(raw: string): string[] | null {
  try {
    const j = JSON.parse(raw);
    const list = (Array.isArray(j) ? j : j.questions) as unknown;
    if (!Array.isArray(list)) return null;
    const q = list.map((x) => String(x).trim()).filter((x) => x.length > 5 && x.length < 300);
    return q.length >= 3 ? q.slice(0, 5) : null;
  } catch {
    return null;
  }
}
