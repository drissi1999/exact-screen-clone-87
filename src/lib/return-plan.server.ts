/** Return-to-work plan. `db` is the service-role client; every function checks tenant and role itself. */
import { todayParis } from "./rules";
import { addDays } from "./plan-templates";
import {
  FOLLOWUPS, PLAN_EDITORS, PLAN_TEMPLATES, SCENARIO_LABELS, STATUS_LABELS, OUTCOME_LABELS, milestonesFor,
  type Outcome, type PlanStatus, type Scenario,
} from "./plan-templates";
import { assertStaff } from "./my-day.server";

const FOLLOWUP_CODES = FOLLOWUPS.map((f) => f.code);
const frd = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR");
export type Partner = { label: string; contact: string };

async function caseTenant(db: any, caseId: string) {
  const { data } = await db.from("cases").select("tenant_id").eq("id", caseId).maybeSingle();
  if (!data) throw new Error("Dossier introuvable");
  return data.tenant_id as string;
}

/** Coordinator, IDEST or médecin of the case's tenant. */
export async function assertPlanEditor(db: any, userId: string, caseId: string): Promise<string> {
  const tenantId = await caseTenant(db, caseId);
  const { data: p } = await db.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
  if (!p || p.tenant_id !== tenantId) throw new Error("Accès refusé");
  const { data: r } = await db.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId).in("role", PLAN_EDITORS as unknown as string[]);
  if (!(r ?? []).length) throw new Error("Seuls le coordinateur, l'IDEST ou le médecin peuvent modifier le plan");
  return tenantId;
}

async function fact(db: any, userId: string | null, caseId: string, label: string) {
  const { error } = await db.rpc("add_plan_event", { _actor: userId, _case: caseId, _label: label });
  if (error) throw new Error("Chronologie : écriture refusée");
}

async function planOf(db: any, caseId: string) {
  const { data } = await db.from("return_plans").select("*").eq("case_id", caseId).maybeSingle();
  return data;
}

export async function getPlan(db: any, userId: string, caseId: string) {
  const tenantId = await assertStaff(db, userId);
  if ((await caseTenant(db, caseId)) !== tenantId) throw new Error("Accès refusé");
  const plan = await planOf(db, caseId);
  if (!plan) return { plan: null, tasks: [] as any[] };
  const { data: tasks } = await db.from("plan_tasks")
    .select("id, code, kind, title, owner_role, partner_label, due_date, due_end, requires_document, document_id, status, outcome, done_at, alert_ack_at, alert_ack_note, on_behalf_note")
    .eq("plan_id", plan.id).order("due_date");
  return {
    plan: {
      id: plan.id as string, targetDate: plan.target_date as string, actualReturnDate: (plan.actual_return_date ?? null) as string | null,
      scenario: plan.scenario as Scenario, status: plan.status as PlanStatus, notes: (plan.notes ?? "") as string,
      partners: (plan.partners ?? []) as Partner[],
    },
    tasks: (tasks ?? []) as any[],
  };
}

export async function createPlan(db: any, userId: string, i: { caseId: string; targetDate: string; scenario: Scenario; notes?: string | undefined }) {
  const tenantId = await assertPlanEditor(db, userId, i.caseId);
  if (await planOf(db, i.caseId)) throw new Error("Ce dossier a déjà un plan de retour");
  const partners: Partner[] = PLAN_TEMPLATES[i.scenario].partners.map((label) => ({ label, contact: "" }));
  const { data: plan, error } = await db.from("return_plans")
    .insert({ tenant_id: tenantId, case_id: i.caseId, target_date: i.targetDate, scenario: i.scenario, notes: i.notes ?? null, partners, created_by: userId })
    .select("id").single();
  if (error) throw new Error("Création impossible");
  await insertMilestones(db, tenantId, plan.id, i.caseId, i.scenario, i.targetDate);
  await fact(db, userId, i.caseId, `Plan de retour créé — ${SCENARIO_LABELS[i.scenario]}, reprise visée le ${frd(i.targetDate)}`);
  return { id: plan.id as string };
}

async function insertMilestones(db: any, tenantId: string, planId: string, caseId: string, scenario: Scenario, target: string, skipFollowups = false) {
  const rows = milestonesFor(scenario, target)
    .filter((m) => !(skipFollowups && FOLLOWUP_CODES.includes(m.code)))
    .map((m) => ({ ...m, tenant_id: tenantId, plan_id: planId, case_id: caseId, kind: "MILESTONE" }));
  if (rows.length) {
    const { error } = await db.from("plan_tasks").insert(rows);
    if (error) throw new Error("Création des tâches impossible");
  }
}

export async function updatePlan(db: any, userId: string, i: { caseId: string; targetDate?: string | undefined; scenario?: Scenario | undefined; status?: PlanStatus | undefined; notes?: string | undefined; partners?: Partner[] | undefined }) {
  const tenantId = await assertPlanEditor(db, userId, i.caseId);
  const plan = await planOf(db, i.caseId);
  if (!plan) throw new Error("Aucun plan pour ce dossier");
  const patch: Record<string, unknown> = {};
  const target = i.targetDate ?? plan.target_date;

  if (i.scenario && i.scenario !== plan.scenario) {
    patch["scenario"] = i.scenario;
    // Open milestones are replaced by the new template; done tasks stay as history.
    await db.from("plan_tasks").delete().eq("plan_id", plan.id).eq("kind", "MILESTONE").eq("status", "TODO");
    await insertMilestones(db, tenantId, plan.id, i.caseId, i.scenario, target, !!plan.actual_return_date);
    await fact(db, userId, i.caseId, `Plan de retour : scénario changé (${SCENARIO_LABELS[plan.scenario as Scenario]} → ${SCENARIO_LABELS[i.scenario]})`);
  }
  if (i.targetDate && i.targetDate !== plan.target_date) {
    patch["target_date"] = i.targetDate;
    if (!i.scenario || i.scenario === plan.scenario) {
      // Move every open milestone with the target date, keeping its offset.
      const { data: open } = await db.from("plan_tasks").select("id, offset_days, offset_end_days").eq("plan_id", plan.id).eq("kind", "MILESTONE").eq("status", "TODO");
      for (const t of open ?? []) {
        await db.from("plan_tasks").update({
          due_date: addDays(i.targetDate, t.offset_days),
          due_end: t.offset_end_days != null ? addDays(i.targetDate, t.offset_end_days) : null,
        }).eq("id", t.id);
      }
    }
    await fact(db, userId, i.caseId, `Plan de retour : date de reprise visée déplacée du ${frd(plan.target_date)} au ${frd(i.targetDate)}`);
  }
  if (i.status && i.status !== plan.status) {
    patch["status"] = i.status;
    await fact(db, userId, i.caseId, `Plan de retour : statut « ${STATUS_LABELS[i.status]} »`);
  }
  if (i.notes !== undefined) patch["notes"] = i.notes;
  if (i.partners) patch["partners"] = i.partners.map((p) => ({ label: p.label.slice(0, 80), contact: p.contact.slice(0, 200) }));
  if (Object.keys(patch).length) await db.from("return_plans").update(patch).eq("id", plan.id);
  return { ok: true };
}

/** Records the actual return date and creates the J+7 / J+30 / J+90 follow-ups. */
export async function setActualReturn(db: any, userId: string, i: { caseId: string; date: string }) {
  const tenantId = await assertPlanEditor(db, userId, i.caseId);
  const plan = await planOf(db, i.caseId);
  if (!plan) throw new Error("Aucun plan pour ce dossier");
  if (plan.actual_return_date) throw new Error("La date de reprise effective est déjà enregistrée");
  // Template follow-up points (relative to the target) are replaced by points relative to the actual date.
  await db.from("plan_tasks").delete().eq("plan_id", plan.id).eq("status", "TODO").in("code", FOLLOWUP_CODES);
  const rows = milestonesFor(plan.scenario, i.date, FOLLOWUPS).map((m) => ({ ...m, tenant_id: tenantId, plan_id: plan.id, case_id: i.caseId, kind: "FOLLOWUP" }));
  await db.from("plan_tasks").insert(rows);
  await db.from("return_plans").update({ actual_return_date: i.date, status: "EN_COURS" }).eq("id", plan.id);
  await fact(db, userId, i.caseId, `Reprise effective le ${frd(i.date)} — suivis planifiés à J+7, J+30 et J+90`);
  return { ok: true };
}

export const ON_BEHALF_LABEL = { EMPLOYER_HR: "Fait pour le compte de l'employeur", WORKER: "Fait pour le compte du salarié" } as const;

/** Staff completion. Follow-ups need an outcome; tasks that require a document need one from the case.
 *  Employer/worker tasks completed by staff need a mandatory note, carry the "pour le compte de" mention and are audited. */
export async function completePlanTask(db: any, userId: string, i: { taskId: string; documentId?: string | null | undefined; outcome?: Outcome | null | undefined; note?: string | null | undefined }) {
  const { data: t } = await db.from("plan_tasks").select("*").eq("id", i.taskId).maybeSingle();
  if (!t) throw new Error("Tâche introuvable");
  await assertPlanEditor(db, userId, t.case_id);
  if (t.status === "DONE") throw new Error("Tâche déjà terminée");
  if (t.kind === "MILESTONE" && FOLLOWUP_CODES.includes(t.code)) throw new Error("Ce point de suivi sera planifié à la reprise effective");
  if (t.kind === "FOLLOWUP" && !i.outcome) throw new Error("Indiquez le résultat du suivi");
  const onBehalf = t.owner_role === "EMPLOYER_HR" || t.owner_role === "WORKER";
  const note = (i.note ?? "").trim();
  if (onBehalf && note.length < 3) throw new Error("Une note est obligatoire pour agir pour le compte de l'employeur ou du salarié");
  if (t.requires_document) {
    if (!i.documentId) throw new Error("Cette tâche nécessite un document");
    const { data: d } = await db.from("documents").select("id").eq("id", i.documentId).eq("case_id", t.case_id).maybeSingle();
    if (!d) throw new Error("Document introuvable dans ce dossier");
  }
  const mention = onBehalf ? ON_BEHALF_LABEL[t.owner_role as "EMPLOYER_HR" | "WORKER"] : null;
  await db.from("plan_tasks").update({
    status: "DONE", done_at: new Date().toISOString(), done_by: userId, outcome: t.kind === "FOLLOWUP" ? i.outcome : null,
    document_id: i.documentId ?? null, on_behalf_note: onBehalf ? `${mention} — ${note.slice(0, 1000)}` : null,
  }).eq("id", t.id);
  if (onBehalf) {
    await db.from("audit_log").insert({ tenant_id: t.tenant_id, user_id: userId, action: "PLAN_TASK_ON_BEHALF", entity: "plan_tasks", entity_id: t.id, case_id: t.case_id });
  }
  await fact(db, userId, t.case_id, `Tâche du plan terminée : ${t.title}${mention ? ` (${mention.toLowerCase()})` : ""}${t.kind === "FOLLOWUP" ? ` — ${OUTCOME_LABELS[i.outcome!]}` : ""}`);
  return { ok: true };
}

/** Portal tasks: title, date and status only. */
export type PortalPlanTask = { id: string; caseId: string; title: string; due: string; status: string; requiresDocument: boolean };
export async function portalPlanTasks(db: any, caseIds: string[], owner: "EMPLOYER_HR" | "WORKER"): Promise<PortalPlanTask[]> {
  if (!caseIds.length) return [] as { id: string; caseId: string; title: string; due: string; status: string; requiresDocument: boolean }[];
  const { data } = await db.from("plan_tasks").select("id, case_id, title, due_date, status, requires_document").in("case_id", caseIds).eq("owner_role", owner).order("due_date");
  return (data ?? []).map((t: any) => ({ id: t.id as string, caseId: t.case_id as string, title: t.title as string, due: t.due_date as string, status: t.status as string, requiresDocument: !!t.requires_document }));
}

/** Employer/worker completion: a task requiring a document needs a file they sent after the task was created. */
export async function completePortalPlanTask(db: any, i: { taskId: string; owner: "EMPLOYER_HR" | "WORKER"; caseIds: string[]; actorId?: string | null }) {
  const { data: t } = await db.from("plan_tasks").select("id, case_id, title, owner_role, status, requires_document, created_at").eq("id", i.taskId).maybeSingle();
  if (!t || t.owner_role !== i.owner || !i.caseIds.includes(t.case_id)) throw new Error("Accès refusé");
  if (t.status === "DONE") return { ok: true };
  let documentId: string | null = null;
  if (t.requires_document) {
    const { data: d } = await db.from("documents").select("id").eq("case_id", t.case_id).eq("source", i.owner === "WORKER" ? "WORKER" : "EMPLOYER").gte("created_at", t.created_at).order("created_at", { ascending: false }).limit(1);
    if (!d?.length) throw new Error("Envoyez d'abord le document demandé");
    documentId = d[0].id;
  }
  await db.from("plan_tasks").update({ status: "DONE", done_at: new Date().toISOString(), done_by: i.actorId ?? null, document_id: documentId }).eq("id", t.id);
  await fact(db, i.actorId ?? null, t.case_id, `Tâche du plan terminée (${i.owner === "WORKER" ? "salarié" : "employeur"}) : ${t.title}`);
  return { ok: true };
}

/** "Pris en charge": closes one follow-up alert with a mandatory note (who, when, note; audited). */
export async function acknowledgeAlert(db: any, userId: string, i: { taskId: string; note: string }) {
  const note = i.note.trim();
  if (note.length < 3) throw new Error("Une note est obligatoire");
  const { data: t } = await db.from("plan_tasks").select("id, case_id, tenant_id, outcome, alert_ack_at").eq("id", i.taskId).maybeSingle();
  if (!t || !["DIFFICULTES", "RECHUTE"].includes(t.outcome)) throw new Error("Alerte introuvable");
  await assertPlanEditor(db, userId, t.case_id);
  if (t.alert_ack_at) throw new Error("Alerte déjà prise en charge");
  await db.from("plan_tasks").update({ alert_ack_at: new Date().toISOString(), alert_ack_by: userId, alert_ack_note: note.slice(0, 1000) }).eq("id", t.id);
  await db.from("audit_log").insert({ tenant_id: t.tenant_id, user_id: userId, action: "PLAN_ALERT_ACK", entity: "plan_tasks", entity_id: t.id, case_id: t.case_id });
  return { ok: true };
}

/** "Ma journée": open plan tasks due today or overdue, and unacknowledged follow-up alerts (difficultés / rechute). */
export async function myDayPlanItems(db: any, tenantId: string, caseIds: string[], today = todayParis()) {
  if (!caseIds.length) return { due: [] as any[], alerts: [] as any[] };
  const [due, alerts] = await Promise.all([
    db.from("plan_tasks").select("case_id, title, due_date, owner_role").eq("tenant_id", tenantId).in("case_id", caseIds).eq("status", "TODO").lte("due_date", today).order("due_date"),
    db.from("plan_tasks").select("id, case_id, title, outcome, done_at").eq("tenant_id", tenantId).in("case_id", caseIds).in("outcome", ["DIFFICULTES", "RECHUTE"]).is("alert_ack_at", null),
  ]);
  return { due: due.data ?? [], alerts: alerts.data ?? [] };
}
