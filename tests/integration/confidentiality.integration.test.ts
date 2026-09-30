/**
 * Item 3: clinical documents forced to MEDICAL, lowering médecin-only and logged, employer portal
 * without filenames, coordination task text immutable. Live database; throw-away data deleted after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildEmployerPortal } from "../../src/lib/employer-portal.server";
import { renderTemplate } from "../../src/lib/message-templates";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && ANON && SERVICE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

run("confidentiality and templated coordination (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts) as any;
  const pwd = `T-${crypto.randomUUID()}`;
  const users: { id: string; sb: SupabaseClient<any> }[] = [];
  let tenant = "", companyId = "", caseId = "", coord: (typeof users)[0], medecin: (typeof users)[0];

  async function mk(label: string) {
    const email = `conf.${label}.${Date.now()}@test.fictif`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: pwd, email_confirm: true });
    if (error) throw error;
    const sb = createClient(URL!, ANON!, opts);
    await sb.auth.signInWithPassword({ email, password: pwd });
    const u = { id: data.user.id as string, sb };
    users.push(u);
    return u;
  }
  const canWrite = async (actor: string, level: string) =>
    (await admin.rpc("can_write_case", { _actor: actor, _case: caseId, _level: level })).data === true;

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
    companyId = (await admin.from("companies").insert({ tenant_id: tenant, name: "Entreprise Fictive" }).select("id").single()).data.id;
    const w = (await admin.from("workers").insert({ tenant_id: tenant, company_id: companyId, last_name: "Test", first_name: "Fictif" }).select("id").single()).data;
    caseId = (await admin.from("cases").insert({ tenant_id: tenant, worker_id: w.id, company_id: companyId, opened_at: "2026-01-01" }).select("id").single()).data.id;
  }, 60_000);

  afterAll(async () => {
    if (tenant) {
      for (const t of ["audit_log", "coordination_tasks", "ai_drafts", "case_events", "documents", "cases", "workers", "companies", "user_roles", "profiles"]) await admin.from(t).delete().eq("tenant_id", tenant);
      await admin.from("tenants").delete().eq("id", tenant);
    }
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it("clinical report uploaded as 'Visible employeur' ends MEDICAL with its events, and leaves the employer portal", async () => {
    // Upload path used by registerDocument: coordinator allowed at EMPLOYER_VISIBLE.
    expect(await canWrite(coord.id, "EMPLOYER_VISIBLE")).toBe(true);
    const doc = (await admin.from("documents").insert({ tenant_id: tenant, case_id: caseId, filename: "cr-hospitalisation-dupont.pdf", storage_path: `${tenant}/${caseId}/cr.pdf`, confidentiality: "EMPLOYER_VISIBLE", doc_type: "AUTRE", uploaded_by: coord.id }).select("id").single()).data;
    // Early event extracted before classification (worst case ordering).
    const ev = (await admin.from("case_events").insert({ tenant_id: tenant, case_id: caseId, label: "fait extrait", confidentiality: "EMPLOYER_VISIBLE", source_document_id: doc.id }).select("id").single()).data;
    let portal = await buildEmployerPortal(admin, tenant, companyId);
    expect(portal.cases[0].documents.map((d: any) => d.id)).toContain(doc.id);

    // What analyzeDocument writes after AI classification.
    const cls = await admin.from("documents").update({ doc_type: "COMPTE_RENDU", analysis_status: "DONE" }).eq("id", doc.id);
    expect(cls.error).toBeNull();
    const late = (await admin.from("case_events").insert({ tenant_id: tenant, case_id: caseId, label: "fait tardif", confidentiality: "EMPLOYER_VISIBLE", source_document_id: doc.id }).select("id").single()).data;

    expect((await admin.from("documents").select("confidentiality").eq("id", doc.id).single()).data.confidentiality).toBe("MEDICAL");
    const evs = (await admin.from("case_events").select("confidentiality").in("id", [ev.id, late.id])).data;
    expect(evs.map((e: any) => e.confidentiality)).toEqual(["MEDICAL", "MEDICAL"]);

    portal = await buildEmployerPortal(admin, tenant, companyId);
    expect(portal.cases[0].documents.map((d: any) => d.id)).not.toContain(doc.id);
  });

  it("automatic changes never lower: direct lowering is rejected even with full database rights", async () => {
    const doc = (await admin.from("documents").select("id").eq("tenant_id", tenant).eq("confidentiality", "MEDICAL").limit(1).single()).data;
    const { error } = await admin.from("documents").update({ confidentiality: "EMPLOYER_VISIBLE" }).eq("id", doc.id);
    expect(error?.message).toMatch(/MEDECIN_TRAVAIL/);
    // Events of a MEDICAL document are pinned to MEDICAL whatever is written.
    await admin.from("case_events").update({ confidentiality: "ADMINISTRATIVE" }).eq("source_document_id", doc.id);
    const evs = (await admin.from("case_events").select("confidentiality").eq("source_document_id", doc.id)).data;
    expect(evs.length).toBeGreaterThan(0);
    expect(evs.every((e: any) => e.confidentiality === "MEDICAL")).toBe(true);
  });

  it("a coordinator cannot lower a document's level; a médecin can, and it is logged", async () => {
    const doc = (await admin.from("documents").select("id").eq("tenant_id", tenant).eq("confidentiality", "MEDICAL").limit(1).single()).data;
    // The function is server-only: not callable from a signed-in browser session.
    const { error: direct } = await coord.sb.rpc("lower_document_confidentiality" as any, { _actor: coord.id, _doc: doc.id, _level: "PDP_SHARED" });
    expect(direct).not.toBeNull();
    // Through the server path with the coordinator as actor: refused.
    const { error: refused } = await admin.rpc("lower_document_confidentiality", { _actor: coord.id, _doc: doc.id, _level: "PDP_SHARED" });
    expect(refused?.message).toMatch(/role/);
    expect((await admin.from("documents").select("confidentiality").eq("id", doc.id).single()).data.confidentiality).toBe("MEDICAL");
    // Médecin: allowed and audited.
    const { error: ok } = await admin.rpc("lower_document_confidentiality", { _actor: medecin.id, _doc: doc.id, _level: "PDP_SHARED" });
    expect(ok).toBeNull();
    expect((await admin.from("documents").select("confidentiality").eq("id", doc.id).single()).data.confidentiality).toBe("PDP_SHARED");
    const logs = (await admin.from("audit_log").select("action, user_id").eq("entity_id", doc.id).like("action", "CONF_LOWER%")).data;
    expect(logs).toEqual([{ action: "CONF_LOWER_MEDICAL_TO_PDP_SHARED", user_id: medecin.id }]);
  });

  it("the employer portal never returns a filename", async () => {
    const fp = (await admin.from("documents").insert({ tenant_id: tenant, case_id: caseId, filename: "fiche-poste-secret-nom.pdf", storage_path: `${tenant}/${caseId}/fp.pdf`, confidentiality: "EMPLOYER_VISIBLE", doc_type: "FICHE_POSTE", analysis_status: "DONE" }).select("id").single()).data;
    expect((await admin.rpc("release_document", { _actor: medecin.id, _doc: fp.id })).error).toBeNull();
    const portal = await buildEmployerPortal(admin, tenant, companyId);
    const json = JSON.stringify(portal);
    expect(json).not.toMatch(/filename|\.pdf|secret-nom|cr-hospitalisation/);
    expect(portal.cases[0].documents.map((d: any) => d.title)).toContain("Fiche de poste");
  });

  it("a coordinator cannot create or edit an employer task directly; the server cannot edit its text either", async () => {
    const tpl = renderTemplate("DOC_FICHE_POSTE", {});
    const task = (await admin.from("coordination_tasks").insert({ tenant_id: tenant, case_id: caseId, purpose: "DOC_FICHE_POSTE", ...tpl }).select("id, message").single()).data;

    const upd = await coord.sb.from("coordination_tasks").update({ message: "Texte modifié" }).eq("id", task.id).select("id");
    expect(upd.error ?? (upd.data?.length === 0 ? "no rows" : null)).not.toBeNull();
    const ins = await coord.sb.from("coordination_tasks").insert({ tenant_id: tenant, case_id: caseId, purpose: "X", recipient: "EMPLOYER_HR", channel: "EMAIL", message: "libre" });
    expect(ins.error).not.toBeNull();
    const del = await coord.sb.from("coordination_tasks").delete().eq("id", task.id).select("id");
    expect(del.error ?? (del.data?.length === 0 ? "no rows" : null)).not.toBeNull();

    const { error: srv } = await admin.from("coordination_tasks").update({ message: "Texte modifié" }).eq("id", task.id);
    expect(srv?.message).toMatch(/cannot be edited/);
    const { error: noTpl } = await admin.from("coordination_tasks").insert({ tenant_id: tenant, case_id: caseId, purpose: "X", recipient: "WORKER", channel: "SMS", message: "libre" });
    expect(noTpl?.message).toMatch(/template/);
    // Status changes (send, done) still work through the server.
    const { error: st } = await admin.from("coordination_tasks").update({ status: "SENT" }).eq("id", task.id);
    expect(st).toBeNull();
    expect((await admin.from("coordination_tasks").select("message").eq("id", task.id).single()).data.message).toBe(task.message);
  });

  it("a staff document marked 'Visible employeur' stays hidden before analysis, after FAILED, and before release", async () => {
    const inPortal = async (id: string) => (await buildEmployerPortal(admin, tenant, companyId)).cases[0].documents.some((d: any) => d.id === id);
    const doc = (await admin.from("documents").insert({ tenant_id: tenant, case_id: caseId, filename: "courrier.pdf", storage_path: `${tenant}/${caseId}/c.pdf`, confidentiality: "EMPLOYER_VISIBLE", doc_type: "AUTRE", uploaded_by: coord.id, released_at: new Date().toISOString() }).select("id, released_at, analysis_status").single()).data;
    expect(doc.released_at).toBeNull(); // cannot be pre-released on insert
    expect(await inPortal(doc.id)).toBe(false); // before analysis

    await admin.from("documents").update({ analysis_status: "FAILED" }).eq("id", doc.id);
    expect(await inPortal(doc.id)).toBe(false); // FAILED
    expect((await admin.rpc("release_document", { _actor: medecin.id, _doc: doc.id })).error?.message).toMatch(/analysis/);

    await admin.from("documents").update({ analysis_status: "DONE", doc_type: "COURRIER_EMPLOYEUR" }).eq("id", doc.id);
    expect(await inPortal(doc.id)).toBe(false); // analysed but not released
    // Direct release is blocked even with full database rights; coordinator cannot release.
    expect((await admin.from("documents").update({ released_at: new Date().toISOString() }).eq("id", doc.id)).error?.message).toMatch(/release_document/);
    expect((await admin.rpc("release_document", { _actor: coord.id, _doc: doc.id })).error?.message).toMatch(/role/);
    const { error: direct } = await coord.sb.rpc("release_document" as any, { _actor: medecin.id, _doc: doc.id });
    expect(direct).not.toBeNull();
    expect(await inPortal(doc.id)).toBe(false);

    expect((await admin.rpc("release_document", { _actor: medecin.id, _doc: doc.id })).error).toBeNull();
    expect(await inPortal(doc.id)).toBe(true);
    const logs = (await admin.from("audit_log").select("action, user_id").eq("entity_id", doc.id).like("action", "RELEASE%")).data;
    expect(logs).toEqual([{ action: "RELEASE_EMPLOYER_VISIBLE", user_id: medecin.id }]);

    // Reclassified as clinical: raised to MEDICAL, release withdrawn, hidden again.
    await admin.from("documents").update({ doc_type: "COMPTE_RENDU" }).eq("id", doc.id);
    const after = (await admin.from("documents").select("confidentiality, released_at").eq("id", doc.id).single()).data;
    expect(after).toEqual({ confidentiality: "MEDICAL", released_at: null });
    expect(await inPortal(doc.id)).toBe(false);
  });

  it("documents the employer uploaded stay visible to them without release", async () => {
    const own = (await admin.from("documents").insert({ tenant_id: tenant, case_id: caseId, filename: "ma-fiche.pdf", storage_path: `${tenant}/${caseId}/own.pdf`, confidentiality: "EMPLOYER_VISIBLE", doc_type: "FICHE_POSTE", source: "EMPLOYER" }).select("id").single()).data;
    const portal = await buildEmployerPortal(admin, tenant, companyId);
    expect(portal.cases[0].documents.some((d: any) => d.id === own.id)).toBe(true);
  });

  it("deadlines use the case's stoppages only, not other stoppages of the worker", async () => {
    const w = (await admin.from("cases").select("worker_id").eq("id", caseId).single()).data.worker_id;
    await admin.from("work_stoppages").insert([
      { tenant_id: tenant, worker_id: w, case_id: null, start_date: "2020-01-01", end_date: "2020-06-30", origin: "MALADIE", kind: "INITIAL", row_hash: `old-${caseId}` },
      { tenant_id: tenant, worker_id: w, case_id: caseId, start_date: "2026-01-01", end_date: "2026-01-10", origin: "MALADIE", kind: "INITIAL", row_hash: `new-${caseId}` },
    ]);
    const portal = await buildEmployerPortal(admin, tenant, companyId);
    expect(portal.cases[0].periods).toEqual([{ start: "2026-01-01", end: "2026-01-10" }]);
    expect(portal.cases[0].deadlines).toEqual([]);
    await admin.from("work_stoppages").delete().eq("tenant_id", tenant);
  });
});
