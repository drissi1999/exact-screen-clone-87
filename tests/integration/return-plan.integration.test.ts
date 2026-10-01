/** Return-to-work plan: dated tasks, portal isolation, follow-up alerts, date moves. Live database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createPlan, updatePlan, setActualReturn, completePlanTask, getPlan, portalPlanTasks, acknowledgeAlert } from "../../src/lib/return-plan.server";
import { buildEmployerPortal } from "../../src/lib/employer-portal.server";
import { buildMyDay } from "../../src/lib/my-day.server";
import { CLINICAL_WORDS, PLAN_TEMPLATES } from "../../src/lib/plan-templates";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && SERVICE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

run("Plan de retour (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts) as any;
  const ids: string[] = [];
  let tenant = "", companyId = "", caseId = "", coord = "", employer = "";

  async function mk(label: string) {
    const { data, error } = await admin.auth.admin.createUser({ email: `plan.${label}.${Date.now()}@test.fictif`, password: `T-${crypto.randomUUID()}`, email_confirm: true });
    if (error) throw error;
    ids.push(data.user.id);
    return data.user.id as string;
  }

  beforeAll(async () => {
    coord = await mk("coord"); employer = await mk("rh");
    tenant = (await admin.from("profiles").select("tenant_id").eq("user_id", coord).single()).data.tenant_id;
    const oldT = (await admin.from("profiles").select("tenant_id").eq("user_id", employer).single()).data.tenant_id;
    await admin.from("user_roles").delete().in("user_id", ids);
    companyId = (await admin.from("companies").insert({ tenant_id: tenant, name: "Plan Fictif" }).select("id").single()).data.id;
    await admin.from("profiles").update({ tenant_id: tenant, company_id: companyId }).eq("user_id", employer);
    await admin.from("tenants").delete().eq("id", oldT);
    await admin.from("user_roles").insert([{ user_id: coord, tenant_id: tenant, role: "PDP_COORDINATOR" }, { user_id: employer, tenant_id: tenant, role: "EMPLOYER_HR" }]);
    const w = (await admin.from("workers").insert({ tenant_id: tenant, company_id: companyId, last_name: "Plan", first_name: "Fictif" }).select("id").single()).data;
    caseId = (await admin.from("cases").insert({ tenant_id: tenant, worker_id: w.id, company_id: companyId, opened_at: "2026-08-01", origin: "MALADIE" }).select("id").single()).data.id;
  });
  afterAll(async () => {
    if (tenant) await admin.from("tenants").delete().eq("id", tenant);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  it("a POSTE_AMENAGE plan creates dated tasks for 3 roles and a PDP_SHARED fact", async () => {
    await createPlan(admin, coord, { caseId, targetDate: "2026-11-02", scenario: "POSTE_AMENAGE" });
    const { tasks } = await getPlan(admin, coord, caseId);
    const roles = new Set(tasks.map((t: any) => t.owner_role));
    for (const r of ["IDEST", "EMPLOYER_HR", "MEDECIN_TRAVAIL"]) expect(roles.has(r)).toBe(true);
    expect(tasks.find((t: any) => t.code === "ETUDE_POSTE").due_date).toBe("2026-10-18");
    expect(tasks.find((t: any) => t.code === "DEVIS_AMENAGEMENT")).toMatchObject({ due_date: "2026-10-23", requires_document: true });
    const ev = (await admin.from("case_events").select("label, confidentiality, status").eq("case_id", caseId)).data;
    expect(ev.some((e: any) => e.label.startsWith("Plan de retour créé") && e.confidentiality === "PDP_SHARED")).toBe(true);
  });

  it("an employer cannot edit the plan", async () => {
    await expect(updatePlan(admin, employer, { caseId, notes: "x" })).rejects.toThrow();
  });

  it("the employer sees only their tasks, with template wording and no clinical word", async () => {
    const portal = await buildEmployerPortal(admin, tenant, companyId);
    const pt = portal.cases.find((c) => c.id === caseId)!.planTasks;
    const wording = PLAN_TEMPLATES.POSTE_AMENAGE.milestones.filter((m) => m.owner === "EMPLOYER_HR").map((m) => m.title);
    expect(pt.map((t) => t.title).sort()).toEqual([...wording].sort());
    for (const t of pt) {
      expect(Object.keys(t).sort()).toEqual(["due", "id", "requiresDocument", "status", "title"]);
      for (const w of CLINICAL_WORDS) expect(t.title.toLowerCase()).not.toContain(w);
    }
  });

  it("the worker sees only theirs", async () => {
    const wt = await portalPlanTasks(admin, [caseId], "WORKER");
    expect(wt.map((t) => t.title)).toEqual(["Confirmer votre date de retour"]);
  });

  it("moving the target date moves the milestones", async () => {
    await updatePlan(admin, coord, { caseId, targetDate: "2026-11-12" });
    const { tasks } = await getPlan(admin, coord, caseId);
    expect(tasks.find((t: any) => t.code === "ETUDE_POSTE").due_date).toBe("2026-10-28");
    expect(tasks.find((t: any) => t.code === "VISITE_REPRISE").due_end).toBe("2026-11-20");
    const ev = (await admin.from("case_events").select("label").eq("case_id", caseId)).data;
    expect(ev.some((e: any) => e.label.includes("déplacée"))).toBe(true);
  });

  it("a 'rechute' follow-up outcome shows up in Ma journée", async () => {
    await setActualReturn(admin, coord, { caseId, date: "2026-09-01" });
    const { tasks } = await getPlan(admin, coord, caseId);
    const f = tasks.filter((t: any) => t.kind === "FOLLOWUP").map((t: any) => t.due_date);
    expect(f).toEqual(["2026-09-08", "2026-10-01", "2026-11-30"]);
    const j7 = tasks.find((t: any) => t.kind === "FOLLOWUP" && t.due_date === "2026-09-08");
    await expect(completePlanTask(admin, coord, { taskId: j7.id })).rejects.toThrow("résultat");
    await completePlanTask(admin, coord, { taskId: j7.id, outcome: "RECHUTE" });
    const day = await buildMyDay(admin, coord, "2026-10-02");
    const row = day.groups.PLAN_ALERTES.find((r) => r.caseId === caseId);
    expect(row?.reason).toContain("rechute");
    // One line per case: the alert takes precedence over the overdue J+30 follow-up of the same case.
    expect(day.groups.PLAN_TACHES.some((r) => r.caseId === caseId)).toBe(false);
  });

  it("'Pris en charge' needs a note, is logged and removes the alert; a new bad outcome creates a new alert", async () => {
    const { tasks } = await getPlan(admin, coord, caseId);
    const j7 = tasks.find((t: any) => t.kind === "FOLLOWUP" && t.due_date === "2026-09-08");
    await expect(acknowledgeAlert(admin, coord, { taskId: j7.id, note: " " })).rejects.toThrow("note");
    await expect(acknowledgeAlert(admin, employer, { taskId: j7.id, note: "appel fait" })).rejects.toThrow();
    await acknowledgeAlert(admin, coord, { taskId: j7.id, note: "Appel au salarié et à l'employeur" });
    const row = (await admin.from("plan_tasks").select("alert_ack_at, alert_ack_by, alert_ack_note").eq("id", j7.id).single()).data;
    expect(row).toMatchObject({ alert_ack_by: coord, alert_ack_note: "Appel au salarié et à l'employeur" });
    expect(row.alert_ack_at).toBeTruthy();
    const log = (await admin.from("audit_log").select("action, user_id").eq("entity_id", j7.id)).data;
    expect(log).toEqual([{ action: "PLAN_ALERT_ACK", user_id: coord }]);
    let day = await buildMyDay(admin, coord, "2026-10-02");
    expect(day.groups.PLAN_ALERTES.some((r) => r.caseId === caseId)).toBe(false);

    const j30 = tasks.find((t: any) => t.kind === "FOLLOWUP" && t.due_date === "2026-10-01");
    await completePlanTask(admin, coord, { taskId: j30.id, outcome: "DIFFICULTES" });
    day = await buildMyDay(admin, coord, "2026-10-02");
    const alert = day.groups.PLAN_ALERTES.find((r) => r.caseId === caseId)!;
    expect(alert.alertTaskIds).toEqual([j30.id]);
    expect(alert.reason).toContain("difficultés");
  });

  it("follow-up outcomes are never visible to the employer or the worker", async () => {
    const emp = JSON.stringify(await buildEmployerPortal(admin, tenant, companyId));
    const wk = JSON.stringify(await portalPlanTasks(admin, [caseId], "WORKER"));
    for (const s of [emp, wk]) {
      for (const w of ["RECHUTE", "DIFFICULTES", "MAINTENU", "outcome", "suivi", "Appel au salarié"]) expect(s.toLowerCase()).not.toContain(w.toLowerCase());
    }
  });

  it("staff can complete an employer/worker task only with a note; the mention is stored and logged", async () => {
    const { tasks } = await getPlan(admin, coord, caseId);
    const v = tasks.find((t: any) => t.code === "VALIDATION_EMPLOYEUR");
    await expect(completePlanTask(admin, coord, { taskId: v.id })).rejects.toThrow("note");
    await expect(completePlanTask(admin, coord, { taskId: v.id, note: "  " })).rejects.toThrow("note");
    await completePlanTask(admin, coord, { taskId: v.id, note: "Accord donné par téléphone" });
    const row = (await admin.from("plan_tasks").select("status, on_behalf_note, done_by").eq("id", v.id).single()).data;
    expect(row).toMatchObject({ status: "DONE", done_by: coord, on_behalf_note: "Fait pour le compte de l'employeur — Accord donné par téléphone" });
    const log = (await admin.from("audit_log").select("action, user_id").eq("entity_id", v.id)).data;
    expect(log).toEqual([{ action: "PLAN_TASK_ON_BEHALF", user_id: coord }]);
    const w = tasks.find((t: any) => t.code === "CONFIRMER_DATE");
    if (w && w.status === "TODO") {
      await completePlanTask(admin, coord, { taskId: w.id, note: "Date confirmée par le salarié" });
      const r = (await admin.from("plan_tasks").select("on_behalf_note").eq("id", w.id).single()).data;
      expect(r.on_behalf_note.startsWith("Fait pour le compte du salarié")).toBe(true);
    }
    // Staff-owned tasks need no note.
    const own = tasks.find((t: any) => t.code === "ETUDE_POSTE");
    await completePlanTask(admin, coord, { taskId: own.id });
    expect((await admin.from("plan_tasks").select("on_behalf_note").eq("id", own.id).single()).data.on_behalf_note).toBeNull();
  });
});
