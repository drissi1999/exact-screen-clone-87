import type { CaseFacts } from "./rules";

/** Loads the facts the deadline rules need (employer knowledge date, CPAM investigation, latest avis) for several cases. */
export async function loadCaseFacts(db: any, caseIds: string[]): Promise<Map<string, CaseFacts>> {
  const out = new Map<string, CaseFacts>();
  if (!caseIds.length) return out;
  const [{ data: cases }, { data: avis }] = await Promise.all([
    db.from("cases").select("id, employer_known_at, cpam_investigation").in("id", caseIds),
    db.from("case_avis").select("case_id, avis_type, avis_date, created_at").in("case_id", caseIds).order("avis_date", { ascending: false }).order("created_at", { ascending: false }),
  ]);
  for (const c of cases ?? []) out.set(c.id, { employerKnownAt: c.employer_known_at, cpamInvestigation: !!c.cpam_investigation, avis: null });
  for (const a of avis ?? []) {
    const f = out.get(a.case_id);
    if (f && !f.avis) f.avis = { type: a.avis_type, date: a.avis_date };
  }
  return out;
}
