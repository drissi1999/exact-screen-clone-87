/**
 * Item 6 (avis) and item 7 (links): only a médecin can enter an avis, and it is logged;
 * a worker link token never lands in simulated_messages. Live database; throw-away data deleted after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { insertAvis } from "../../src/lib/case-facts.server";
import { issueWorkerLink, SECURE_LINK_PLACEHOLDER } from "../../src/lib/worker-links.server";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && ANON && SERVICE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

run("avis and secure links (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts) as any;
  const pwd = `T-${crypto.randomUUID()}`;
  const users: { id: string; sb: SupabaseClient<any> }[] = [];
  let tenant = "", caseId = "", coord: (typeof users)[0], medecin: (typeof users)[0], adminUser: (typeof users)[0];

  async function mk(label: string) {
    const email = `links.${label}.${Date.now()}@test.fictif`;
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
    medecin = await mk("medecin");
    adminUser = await mk("admin");
    tenant = (await admin.from("profiles").select("tenant_id").eq("user_id", coord.id).single()).data.tenant_id;
    for (const u of [medecin, adminUser]) {
      const oldT = (await admin.from("profiles").select("tenant_id").eq("user_id", u.id).single()).data.tenant_id;
      await admin.from("user_roles").delete().eq("user_id", u.id);
      await admin.from("profiles").update({ tenant_id: tenant }).eq("user_id", u.id);
      await admin.from("tenants").delete().eq("id", oldT);
    }
    await admin.from("user_roles").delete().eq("user_id", coord.id);
    await admin.from("user_roles").insert([
      { user_id: coord.id, tenant_id: tenant, role: "PDP_COORDINATOR" },
      { user_id: medecin.id, tenant_id: tenant, role: "MEDECIN_TRAVAIL" },
      { user_id: adminUser.id, tenant_id: tenant, role: "SPSTI_ADMIN" },
    ]);
    const companyId = (await admin.from("companies").insert({ tenant_id: tenant, name: "Entreprise Fictive" }).select("id").single()).data.id;
    const w = (await admin.from("workers").insert({ tenant_id: tenant, company_id: companyId, last_name: "Test", first_name: "Fictif", phone: "0600000000" }).select("id").single()).data;
    caseId = (await admin.from("cases").insert({ tenant_id: tenant, worker_id: w.id, company_id: companyId, opened_at: "2026-01-01" }).select("id").single()).data.id;
  }, 60_000);

  afterAll(async () => {
    if (tenant) {
      for (const t of ["audit_log", "simulated_messages", "worker_links", "case_avis", "cases", "workers", "companies", "user_roles", "profiles"]) await admin.from(t).delete().eq("tenant_id", tenant);
      await admin.from("tenants").delete().eq("id", tenant);
    }
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it("a coordinator cannot enter an avis", async () => {
    await expect(insertAvis(admin, coord.id, caseId, "INAPTITUDE", "2026-02-01")).rejects.toThrow(/médecin/);
    expect((await admin.from("case_avis").select("id").eq("case_id", caseId)).data).toHaveLength(0);
    // Nor directly through the API.
    const direct = await coord.sb.from("case_avis").insert({ tenant_id: tenant, case_id: caseId, avis_type: "INAPTITUDE", avis_date: "2026-02-01", created_by: coord.id });
    expect(direct.error).not.toBeNull();
  });

  it("a médecin can, and it is logged", async () => {
    const id = await insertAvis(admin, medecin.id, caseId, "INAPTITUDE", "2026-02-01");
    expect((await admin.from("case_avis").select("avis_type").eq("id", id).single()).data.avis_type).toBe("INAPTITUDE");
    const log = (await admin.from("audit_log").select("action, user_id").eq("entity_id", id)).data;
    expect(log).toEqual([{ action: "AVIS_CREATE", user_id: medecin.id }]);
  });

  it("after creating a worker link, no staff member can read the token from simulated_messages", async () => {
    const { link } = await issueWorkerLink(admin, coord.sb, caseId, coord.id, "https://exemple.fictif");
    const token = link.split("/salarie/")[1];
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    for (const u of [coord, medecin, adminUser]) {
      const { data, error } = await u.sb.from("simulated_messages").select("body, subject, to_address").eq("case_id", caseId);
      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(JSON.stringify(data)).not.toContain(token);
      expect(data![0].body).toContain(SECURE_LINK_PLACEHOLDER);
    }
    // Stored links table keeps only the hash, and is closed to clients.
    expect(JSON.stringify((await admin.from("worker_links").select("*").eq("case_id", caseId)).data)).not.toContain(token);
    const probe = await adminUser.sb.from("worker_links").select("token_hash");
    expect(probe.data ?? []).toHaveLength(0);
  });
});
