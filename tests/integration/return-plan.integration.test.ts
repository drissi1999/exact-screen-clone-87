/** Return-to-work plan: dated tasks, portal isolation, follow-up alerts, date moves. Live database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createPlan, updatePlan, setActualReturn, completePlanTask, getPlan, portalPlanTasks } from "../../src/lib/return-plan.server";
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
    // The J+30 follow-up (due 01/10) is overdue on 02/10.
    expect(day.groups.PLAN_TACHES.some((r) => r.caseId === caseId)).toBe(true);
  });
});
