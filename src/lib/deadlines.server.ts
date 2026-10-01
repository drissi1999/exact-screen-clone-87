/** "Marquer comme fait" for legal obligations. `db` is the service-role client. */
import { OBLIGATION_CODES, todayParis } from "./rules";

export async function markDeadlineDone(db: any, actor: string, caseId: string, code: string, doneOn: string, today = todayParis()) {
  if (!(OBLIGATION_CODES as readonly string[]).includes(code)) throw new Error("Seules les obligations légales peuvent être marquées comme faites");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn) || doneOn > today) throw new Error("Date invalide (pas de date future)");
  const { data: c } = await db.from("cases").select("tenant_id").eq("id", caseId).maybeSingle();
  if (!c) throw new Error("Dossier introuvable");
  const { data: ok } = await db.rpc("can_write_case", { _actor: actor, _case: caseId, _level: "ADMINISTRATIVE" });
  if (ok !== true) throw new Error("Accès refusé");
  const { data: row, error } = await db.from("case_deadline_done")
    .upsert({ tenant_id: c.tenant_id, case_id: caseId, code, done_on: doneOn, done_by: actor }, { onConflict: "case_id,code" }).select("id").single();
  if (error) throw new Error("Enregistrement impossible");
  await db.from("audit_log").insert({ tenant_id: c.tenant_id, user_id: actor, action: `DEADLINE_DONE_${code}`, entity: "case_deadline_done", entity_id: row.id, case_id: caseId });
  return { ok: true };
}
