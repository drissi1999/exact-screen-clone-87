import type { CaseFacts } from "./rules";

/** Loads the facts the deadline rules need (employer knowledge date, CPAM investigation, latest avis) for several cases. */
export async function loadCaseFacts(db: any, caseIds: string[]): Promise<Map<string, CaseFacts>> {
  const out = new Map<string, CaseFacts>();
  if (!caseIds.length) return out;
  const [{ data: cases }, { data: avis }, { data: done }] = await Promise.all([
    db.from("cases").select("id, employer_known_at, cpam_investigation").in("id", caseIds),
    db.from("case_avis").select("case_id, avis_type, avis_date, created_at").in("case_id", caseIds).order("avis_date", { ascending: false }).order("created_at", { ascending: false }),
    db.from("case_deadline_done").select("case_id, code, done_on").in("case_id", caseIds),
  ]);
  for (const c of cases ?? []) out.set(c.id, { employerKnownAt: c.employer_known_at, cpamInvestigation: !!c.cpam_investigation, avis: null, done: {} });
  for (const a of avis ?? []) {
    const f = out.get(a.case_id);
    if (f && !f.avis) f.avis = { type: a.avis_type, date: a.avis_date };
  }
  for (const d of done ?? []) { const f = out.get(d.case_id); if (f) f.done![d.code] = d.done_on; }
  return out;
}

/** Avis entry: MEDECIN_TRAVAIL of the case's tenant only, logged. `db` is the service-role client. */
export async function insertAvis(db: any, actor: string, caseId: string, type: string, date: string): Promise<string> {
  const { data: c } = await db.from("cases").select("tenant_id").eq("id", caseId).maybeSingle();
  if (!c) throw new Error("Dossier introuvable");
  const { data: ok } = await db.rpc("can_write_case", { _actor: actor, _case: caseId, _level: "ADMINISTRATIVE" });
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", actor).eq("tenant_id", c.tenant_id).eq("role", "MEDECIN_TRAVAIL");
  if (ok !== true || !(roles ?? []).length) throw new Error("Seul le médecin du travail peut saisir un avis");
  const { data: row, error } = await db.from("case_avis").insert({ tenant_id: c.tenant_id, case_id: caseId, avis_type: type, avis_date: date, created_by: actor }).select("id").single();
  if (error) throw new Error("Enregistrement impossible");
  await db.from("audit_log").insert({ tenant_id: c.tenant_id, user_id: actor, action: "AVIS_CREATE", entity: "case_avis", entity_id: row.id, case_id: caseId });
  return row.id as string;
}
