/** "Ma journée": overdue grouping, staff-only access, and a risk score that never reads medical rows. Live database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildMyDay, scoreCases, RISK_TABLES } from "../../src/lib/my-day.server";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && ANON && SERVICE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const TODAY = "2026-09-30";

run("Ma journée (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts) as any;
  const pwd = `T-${crypto.randomUUID()}`;
  const users: { id: string; sb: SupabaseClient<any> }[] = [];
  let tenant = "", companyId = "", overdueCase = "", calmCase = "", coord: (typeof users)[0], employer: (typeof users)[0];

  async function mk(label: string) {
    const email = `day.${label}.${Date.now()}@test.fictif`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: pwd, email_confirm: true });
    if (error) throw error;
    const sb = createClient(URL!, ANON!, opts);
    await sb.auth.signInWithPassword({ email, password: pwd });
    const u = { id: data.user.id as string, sb };
    users.push(u);
    return u;
  }

  beforeAll(async () => {
    coord = await mk("coord");
    employer = await mk("rh");
    tenant = (await admin.from("profiles").select("tenant_id").eq("user_id", coord.id).single()).data.tenant_id;
    const oldT = (await admin.from("profiles").select("tenant_id").eq("user_id", employer.id).single()).data.tenant_id;
    await admin.from("user_roles").delete().in("user_id", [coord.id, employer.id]);
    companyId = (await admin.from("companies").insert({ tenant_id: tenant, name: "Transports Fictifs", headcount: 8 }).select("id").single()).data.id;
    await admin.from("profiles").update({ tenant_id: tenant, company_id: companyId }).eq("user_id", employer.id);
    await admin.from("tenants").delete().eq("id", oldT);
    await admin.from("user_roles").insert([
      { user_id: coord.id, tenant_id: tenant, role: "PDP_COORDINATOR" },
      { user_id: employer.id, tenant_id: tenant, role: "EMPLOYER_HR" },
    ]);
    const w1 = (await admin.from("workers").insert({ tenant_id: tenant, company_id: companyId, last_name: "Retard", first_name: "Fictif", job_title: "Cariste", birth_date: "1965-03-03" }).select("id").single()).data;
    const w2 = (await admin.from("workers").insert({ tenant_id: tenant, company_id: companyId, last_name: "Calme", first_name: "Fictif" }).select("id").single()).data;
    overdueCase = (await admin.from("cases").insert({ tenant_id: tenant, worker_id: w1.id, company_id: companyId, opened_at: "2026-06-01", origin: "AT" }).select("id").single()).data.id;
    calmCase = (await admin.from("cases").insert({ tenant_id: tenant, worker_id: w2.id, company_id: companyId, opened_at: "2026-09-20", origin: "MALADIE" }).select("id").single()).data.id;
    await admin.from("work_stoppages").insert([
      // AT since June: the 48h declaration deadline is long past.
      { tenant_id: tenant, worker_id: w1.id, case_id: overdueCase, start_date: "2026-06-01", end_date: null, origin: "AT", kind: "INITIAL", row_hash: `t-${crypto.randomUUID()}` },
      { tenant_id: tenant, worker_id: w2.id, case_id: calmCase, start_date: "2026-09-20", end_date: "2026-10-20", origin: "MALADIE", kind: "INITIAL", row_hash: `t-${crypto.randomUUID()}` },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (tenant) {
      for (const t of ["audit_log", "case_risk_scores", "case_events", "documents", "work_stoppages", "cases", "workers", "user_roles", "profiles", "companies"]) await admin.from(t).delete().eq("tenant_id", tenant);
      await admin.from("tenants").delete().eq("id", tenant);
    }
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it("a case with an overdue deadline appears under En retard; the calm one does not", async () => {
    const day = await buildMyDay(admin, coord.id, TODAY);
    const late = day.groups.EN_RETARD.map((r) => r.caseId);
    expect(late).toContain(overdueCase);
    expect(late).not.toContain(calmCase);
    const row = day.groups.EN_RETARD.find((r) => r.caseId === overdueCase)!;
    expect(row.topFactors).toHaveLength(2);
    expect(row.worker).toBe("Retard Fictif");
    expect(day.toHandleToday).toBeGreaterThanOrEqual(1);
  });

  it("stored factors sum exactly to the stored score", async () => {
    const { data } = await admin.from("case_risk_scores").select("score, factors").eq("tenant_id", tenant);
    expect(data.length).toBe(2);
    for (const r of data) expect(r.factors.reduce((s: number, f: any) => s + f.points, 0)).toBe(r.score);
  });

  it("an employer user is refused, and cannot read stored scores directly", async () => {
    await expect(buildMyDay(admin, employer.id, TODAY)).rejects.toThrow("Accès refusé");
    const { data } = await employer.sb.from("case_risk_scores").select("score");
    expect(data ?? []).toHaveLength(0);
    // The coordinator can.
    expect(((await coord.sb.from("case_risk_scores").select("score")).data ?? []).length).toBe(2);
  });

  it("the score never reads a MEDICAL row", async () => {
    const touched = new Set<string>();
    const spy = new Proxy(admin, { get: (t, p) => (p === "from" ? (name: string) => { touched.add(name); return t.from(name); } : p === "rpc" ? (n: string, a: any) => { touched.add(`rpc:${n}`); return t.rpc(n, a); } : t[p]) });
    const before = (await scoreCases(spy, tenant, [overdueCase], TODAY)).get(overdueCase)!;
    for (const name of touched) expect([...RISK_TABLES, "case_risk_scores"]).toContain(name);
    expect([...touched].some((n) => ["documents", "case_events", "ai_drafts"].includes(n) || n.startsWith("rpc:"))).toBe(false);

    // Adding medical content changes nothing.
    const doc = (await admin.from("documents").insert({ tenant_id: tenant, case_id: overdueCase, filename: "cr.pdf", storage_path: `${tenant}/${overdueCase}/cr.pdf`, confidentiality: "MEDICAL", doc_type: "COMPTE_RENDU", analysis_status: "DONE" }).select("id").single()).data;
    await admin.from("case_events").insert({ tenant_id: tenant, case_id: overdueCase, label: "fait médical fictif", confidentiality: "MEDICAL", source_document_id: doc.id });
    const after = (await scoreCases(admin, tenant, [overdueCase], TODAY)).get(overdueCase)!;
    expect(after).toEqual(before);
  });
});
