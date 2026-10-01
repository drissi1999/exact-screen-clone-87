/** Demo reset + load: own SPSTI only, never users/roles, repeatable, realistic "Ma journée". Live database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadDemo, resetDemo, RESET_CONFIRMATION } from "../../src/lib/demo-seed.server";
import { buildMyDay } from "../../src/lib/my-day.server";
import { todayParis } from "../../src/lib/rules";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && SERVICE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

run("Démo (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts) as any;
  const ids: string[] = [];
  let tA = "", tB = "", adminA = "", coordA = "", adminB = "", otherCase = "";

  async function mk(label: string) {
    const { data, error } = await admin.auth.admin.createUser({ email: `demo.${label}.${Date.now()}@test.fictif`, password: `T-${crypto.randomUUID()}`, email_confirm: true });
    if (error) throw error;
    ids.push(data.user.id);
    return data.user.id as string;
  }
  const tenantOf = async (u: string) => (await admin.from("profiles").select("tenant_id").eq("user_id", u).single()).data.tenant_id;

  async function snapshot(t: string) {
    const cases = (await admin.from("cases").select("status, opened_at, closed_at, origin, workers(last_name)").eq("tenant_id", t)).data;
    const count = async (table: string) => (await admin.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", t)).count;
    const tasks = (await admin.from("plan_tasks").select("code, due_date, status, outcome").eq("tenant_id", t)).data;
    return {
      cases: cases.map((c: any) => `${c.workers.last_name}|${c.status}|${c.opened_at}|${c.closed_at}|${c.origin}`).sort(),
      workers: await count("workers"), companies: await count("companies"), stoppages: await count("work_stoppages"),
      documents: await count("documents"), events: await count("case_events"), plans: await count("return_plans"),
      tasks: tasks.map((x: any) => `${x.code}|${x.due_date}|${x.status}|${x.outcome}`).sort(),
    };
  }

  beforeAll(async () => {
    adminA = await mk("adminA"); coordA = await mk("coordA"); adminB = await mk("adminB");
    tA = await tenantOf(adminA); tB = await tenantOf(adminB);
    const oldT = await tenantOf(coordA);
    await admin.from("user_roles").delete().eq("user_id", coordA);
    await admin.from("profiles").update({ tenant_id: tA }).eq("user_id", coordA);
    await admin.from("tenants").delete().eq("id", oldT);
    await admin.from("user_roles").insert({ user_id: coordA, tenant_id: tA, role: "PDP_COORDINATOR" });
    // Another SPSTI with its own data.
    const co = (await admin.from("companies").insert({ tenant_id: tB, name: "Autre SPSTI SA" }).select("id").single()).data.id;
    const w = (await admin.from("workers").insert({ tenant_id: tB, company_id: co, last_name: "Autre", first_name: "Fictif" }).select("id").single()).data.id;
    otherCase = (await admin.from("cases").insert({ tenant_id: tB, worker_id: w, company_id: co, opened_at: "2026-09-01" }).select("id").single()).data.id;
  }, 60_000);
  afterAll(async () => {
    for (const t of [tA, tB]) if (t) await admin.from("tenants").delete().eq("id", t);
    for (const id of ids) await admin.auth.admin.deleteUser(id);
  });

  it("only the admin can reset, and only with the typed confirmation", async () => {
    await expect(resetDemo(admin, adminA, "oui")).rejects.toThrow(RESET_CONFIRMATION);
    await expect(resetDemo(admin, coordA, RESET_CONFIRMATION)).rejects.toThrow();
    await expect(loadDemo(admin, coordA)).rejects.toThrow();
  });

  it("load gives a realistic Ma journée", async () => {
    await loadDemo(admin, adminA);
    const snap = await snapshot(tA);
    expect(snap.cases).toHaveLength(11); // the two short leaves open no case
    expect(snap.cases.filter((c) => c.includes("|CLOSED|"))).toHaveLength(1);
    expect(snap.cases.some((c) => c.startsWith("Leroy|"))).toBe(false);
    expect(snap.companies).toBe(4);
    const day = await buildMyDay(admin, coordA, todayParis());
    expect(day.groups.EN_RETARD.length).toBeGreaterThanOrEqual(1);
    expect(day.groups.EN_RETARD.length).toBeLessThanOrEqual(3);
    expect(day.groups.AUJOURDHUI.length + day.groups.PLAN_TACHES.length).toBeGreaterThanOrEqual(1);
    expect(day.groups.SEMAINE.length).toBeGreaterThanOrEqual(2);
    expect(day.groups.PLAN_ALERTES).toHaveLength(1);
    // One line per case: no case appears in two groups.
    const all = Object.values(day.groups).flat().map((r) => r.caseId);
    expect(new Set(all).size).toBe(all.length);
    // Every document is a watermarked PDF.
    const doc = (await admin.from("documents").select("storage_path").eq("tenant_id", tA).limit(1).single()).data;
    const blob = await admin.storage.from("case-documents").download(doc.storage_path);
    const text = new TextDecoder("latin1").decode(new Uint8Array(await blob.data.arrayBuffer()));
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toContain("DOCUMENT FICTIF");
  }, 120_000);

  it("reset never touches another SPSTI, users or roles; reset + load is repeatable", async () => {
    const rolesBefore = (await admin.from("user_roles").select("user_id, tenant_id, role").in("user_id", ids)).data;
    const profilesBefore = (await admin.from("profiles").select("user_id, tenant_id, full_name").in("user_id", ids)).data;
    const first = await snapshot(tA);
    const r = await resetDemo(admin, adminA, RESET_CONFIRMATION);
    expect(r.cases).toBe(11);
    const empty = await snapshot(tA);
    expect(empty).toMatchObject({ cases: [], workers: 0, companies: 0, documents: 0, events: 0, plans: 0, tasks: [] });
    const { data: files } = await admin.storage.from("case-documents").list(tA);
    expect(files ?? []).toHaveLength(0);
    // Other SPSTI, users and roles unchanged; the reset is logged.
    expect((await admin.from("cases").select("id").eq("id", otherCase)).data).toHaveLength(1);
    const sortK = (a: any[]) => a.map((x) => JSON.stringify(x)).sort();
    expect(sortK((await admin.from("user_roles").select("user_id, tenant_id, role").in("user_id", ids)).data)).toEqual(sortK(rolesBefore));
    expect(sortK((await admin.from("profiles").select("user_id, tenant_id, full_name").in("user_id", ids)).data)).toEqual(sortK(profilesBefore));
    for (const id of ids) expect((await admin.auth.admin.getUserById(id)).data.user?.id).toBe(id);
    expect((await admin.from("audit_log").select("action").eq("tenant_id", tA).eq("action", "DEMO_RESET")).data).toHaveLength(1);

    await loadDemo(admin, adminA);
    const second = await snapshot(tA);
    expect(second).toEqual(first);
    await resetDemo(admin, adminA, RESET_CONFIRMATION);
    await loadDemo(admin, adminA);
    expect(await snapshot(tA)).toEqual(first);
  }, 240_000);
});
