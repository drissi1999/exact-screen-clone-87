/**
 * Item 2: no direct client writes, approval only via review functions, server-only audit,
 * audited MEDICAL reads. Live database; throw-away tenant, users and case, all deleted after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && ANON && SERVICE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

run("integrity and audited medical reads (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts) as any;
  const pwd = `T-${crypto.randomUUID()}`;
  const users: { id: string; sb: SupabaseClient<any> }[] = [];
  let tenant = "", coord: (typeof users)[0], medecin: (typeof users)[0];
  let caseId = "", docId = "", letterId = "", eventId = "";

  async function mk(label: string) {
    const email = `integrity.${label}.${Date.now()}@test.fictif`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: pwd, email_confirm: true });
    if (error) throw error;
    const sb = createClient(URL!, ANON!, opts);
    await sb.auth.signInWithPassword({ email, password: pwd });
    const u = { id: data.user.id as string, sb };
    users.push(u);
    return u;
  }
  const auditCount = async (entityId: string) =>
    (await admin.from("audit_log").select("id", { count: "exact", head: true }).eq("entity_id", entityId)).count ?? 0;

  beforeAll(async () => {
    coord = await mk("coord");
    medecin = await mk("medecin");
    tenant = (await admin.from("profiles").select("tenant_id").eq("user_id", coord.id).single()).data.tenant_id;
    const oldT = (await admin.from("profiles").select("tenant_id").eq("user_id", medecin.id).single()).data.tenant_id;
    await admin.from("user_roles").delete().in("user_id", [coord.id, medecin.id]);
    await admin.from("profiles").update({ tenant_id: tenant }).eq("user_id", medecin.id);
    await admin.from("tenants").delete().eq("id", oldT);
    await admin.from("user_roles").insert([
      { user_id: coord.id, tenant_id: tenant, role: "PDP_COORDINATOR" },
      { user_id: medecin.id, tenant_id: tenant, role: "MEDECIN_TRAVAIL" },
    ]);
    const co = (await admin.from("companies").insert({ tenant_id: tenant, name: "Entreprise Fictive" }).select("id").single()).data;
    const w = (await admin.from("workers").insert({ tenant_id: tenant, company_id: co.id, last_name: "Test", first_name: "Fictif" }).select("id").single()).data;
    caseId = (await admin.from("cases").insert({ tenant_id: tenant, worker_id: w.id, company_id: co.id, opened_at: "2026-01-01" }).select("id").single()).data.id;
    docId = (await admin.from("documents").insert({ tenant_id: tenant, case_id: caseId, filename: "certificat.pdf", storage_path: `${tenant}/${caseId}/x.pdf`, doc_type: "CERTIFICAT_MEDICAL", confidentiality: "MEDICAL", analysis_status: "DONE" }).select("id").single()).data.id;
    eventId = (await admin.from("case_events").insert({ tenant_id: tenant, case_id: caseId, label: "fait médical", confidentiality: "MEDICAL", source_document_id: docId }).select("id").single()).data.id;
    letterId = (await admin.from("ai_drafts").insert({ tenant_id: tenant, case_id: caseId, kind: "COURRIER_EMPLOYEUR", confidentiality: "EMPLOYER_VISIBLE", draft_text: "Madame, Monsieur…", required_role: "MEDECIN_TRAVAIL" }).select("id").single()).data.id;
  }, 60_000);

  afterAll(async () => {
    if (tenant) {
      for (const t of ["audit_log", "ai_drafts", "case_events", "documents", "cases", "workers", "companies", "user_roles", "profiles"]) await admin.from(t).delete().eq("tenant_id", tenant);
      await admin.from("tenants").delete().eq("id", tenant);
    }
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it("coordinator cannot approve the employer letter by direct update", async () => {
    const { data: visible } = await coord.sb.from("ai_drafts").select("id").eq("id", letterId);
    expect(visible).toHaveLength(1); // they can see it…
    const { error } = await coord.sb.from("ai_drafts").update({ status: "APPROVED", approved_text: "faux" }).eq("id", letterId);
    expect(error).not.toBeNull(); // …but cannot write it
    expect((await admin.from("ai_drafts").select("status").eq("id", letterId).single()).data.status).toBe("DRAFT");
  });
  it("even a privileged direct update cannot approve (database trigger)", async () => {
    const { error } = await admin.from("ai_drafts").update({ status: "APPROVED" }).eq("id", letterId);
    expect(error?.message).toMatch(/approval only through review/);
    const { error: e2 } = await admin.from("ai_drafts").insert({ tenant_id: tenant, case_id: caseId, kind: "X", confidentiality: "EMPLOYER_VISIBLE", draft_text: "x", required_role: "MEDECIN_TRAVAIL", status: "APPROVED" });
    expect(e2?.message).toMatch(/approval only through review/);
  });
  it("review path: coordinator refused, médecin approves and it is audited", async () => {
    const { error: denied } = await admin.rpc("review_draft", { _draft: letterId, _actor: coord.id, _status: "APPROVED", _text: null });
    expect(denied?.message).toMatch(/required role/);
    const { error } = await admin.rpc("review_draft", { _draft: letterId, _actor: medecin.id, _status: "APPROVED", _text: null });
    expect(error).toBeNull();
    const row = (await admin.from("ai_drafts").select("status, approved_by, approved_text").eq("id", letterId).single()).data;
    expect(row).toMatchObject({ status: "APPROVED", approved_by: medecin.id, approved_text: "Madame, Monsieur…" });
    expect(await auditCount(letterId)).toBe(1);
  });
  it("coordinator cannot validate a medical event through the review path", async () => {
    const { error } = await admin.rpc("review_event", { _event: eventId, _actor: coord.id, _status: "APPROVED" });
    expect(error?.message).toMatch(/required role/);
  });
  it("staff cannot insert a fake audit row", async () => {
    for (const u of [coord, medecin]) {
      const { error } = await u.sb.from("audit_log").insert({ tenant_id: tenant, user_id: u.id, action: "FAKE", entity: "documents" });
      expect(error).not.toBeNull();
    }
    expect((await admin.from("audit_log").select("id").eq("action", "FAKE").eq("tenant_id", tenant)).data).toEqual([]);
  });
  it("staff cannot insert, update or delete documents, events or drafts directly", async () => {
    expect((await medecin.sb.from("documents").insert({ tenant_id: tenant, case_id: caseId, filename: "f", storage_path: `${tenant}/${caseId}/f`, doc_type: "AUTRE", confidentiality: "ADMINISTRATIVE" })).error).not.toBeNull();
    expect((await medecin.sb.from("case_events").insert({ tenant_id: tenant, case_id: caseId, label: "f", confidentiality: "ADMINISTRATIVE" })).error).not.toBeNull();
    expect((await coord.sb.from("ai_drafts").delete().eq("id", letterId)).error).not.toBeNull();
  });
  it("médecin reading a medical document by direct query gets nothing", async () => {
    expect((await medecin.sb.from("documents").select("id, filename, extracted_text").eq("id", docId)).data).toEqual([]);
    expect((await medecin.sb.from("case_events").select("id").eq("id", eventId)).data).toEqual([]);
  });
  it("médecin reading it through the app gets it and creates an audit row", async () => {
    const before = await auditCount(docId);
    const { data, error } = await admin.rpc("staff_document", { _actor: medecin.id, _doc: docId, _purpose: "READ" });
    expect(error).toBeNull();
    expect(data.filename).toBe("certificat.pdf");
    expect(await auditCount(docId)).toBe(before + 1);
    const { data: items } = await admin.rpc("staff_case_items", { _actor: medecin.id, _case: caseId });
    expect(items.documents.map((d: any) => d.id)).toContain(docId);
    expect(await auditCount(docId)).toBe(before + 2);
  });
  it("coordinator gets no medical rows even through the app, and nothing is logged", async () => {
    const before = await auditCount(docId);
    expect((await admin.rpc("staff_document", { _actor: coord.id, _doc: docId, _purpose: "READ" })).error).not.toBeNull();
    const { data: items } = await admin.rpc("staff_case_items", { _actor: coord.id, _case: caseId });
    expect(items.documents).toEqual([]);
    expect(items.drafts.map((d: any) => d.id)).toEqual([letterId]);
    expect(await auditCount(docId)).toBe(before);
  });
  it("the audited read functions cannot be called from a browser session", async () => {
    expect((await medecin.sb.rpc("staff_document", { _actor: medecin.id, _doc: docId, _purpose: "READ" })).error).not.toBeNull();
    expect((await coord.sb.rpc("review_draft", { _draft: letterId, _actor: medecin.id, _status: "REJECTED", _text: null })).error).not.toBeNull();
  });
});
