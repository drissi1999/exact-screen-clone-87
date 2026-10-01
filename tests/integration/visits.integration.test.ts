/** Visit booking, preparation and outcome: planned deadline, employer isolation, médecin-only outcome. Live database. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bookVisit, buildVisitPrep, generateVisitQuestions, recordVisitOutcome } from "../../src/lib/visits.server";
import { buildEmployerPortal } from "../../src/lib/employer-portal.server";
import { loadCaseFacts } from "../../src/lib/case-facts.server";
import { computeDeadlines, todayParis } from "../../src/lib/rules";
import { buildMyDay } from "../../src/lib/my-day.server";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && ANON && SERVICE ? describe : describe.skip;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

run("Visites (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts) as any;
  const pwd = `T-${crypto.randomUUID()}`;
  const users: { id: string; sb: SupabaseClient<any> }[] = [];
  let tenant = "", companyId = "", caseId = "", visitId = "";
  let medecin: (typeof users)[0], idest: (typeof users)[0], coord: (typeof users)[0], employer: (typeof users)[0];
  const today = todayParis();
  const SECRET = "Lombalgie fictive secrète";

  async function mk(label: string) {
    const email = `visit.${label}.${Date.now()}@test.fictif`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: pwd, email_confirm: true });
    if (error) throw error;
    const sb = createClient(URL!, ANON!, opts);
    await sb.auth.signInWithPassword({ email, password: pwd });
    const u = { id: data.user.id as string, sb };
    users.push(u);
    return u;
  }

  beforeAll(async () => {
    medecin = await mk("med"); idest = await mk("idest"); coord = await mk("coord"); employer = await mk("rh");
    tenant = (await admin.from("profiles").select("tenant_id").eq("user_id", medecin.id).single()).data.tenant_id;
    companyId = (await admin.from("companies").insert({ tenant_id: tenant, name: "Visites Fictives SA" }).select("id").single()).data.id;
    for (const u of [idest, coord, employer]) {
      const old = (await admin.from("profiles").select("tenant_id").eq("user_id", u.id).single()).data.tenant_id;
      await admin.from("user_roles").delete().eq("user_id", u.id);
      await admin.from("profiles").update({ tenant_id: tenant, company_id: u === employer ? companyId : null }).eq("user_id", u.id);
      await admin.from("tenants").delete().eq("id", old);
    }
    await admin.from("user_roles").delete().eq("user_id", medecin.id);
    await admin.from("user_roles").insert([
      { user_id: medecin.id, tenant_id: tenant, role: "MEDECIN_TRAVAIL" },
      { user_id: idest.id, tenant_id: tenant, role: "IDEST" },
      { user_id: coord.id, tenant_id: tenant, role: "PDP_COORDINATOR" },
      { user_id: employer.id, tenant_id: tenant, role: "EMPLOYER_HR" },
    ]);
    const w = (await admin.from("workers").insert({ tenant_id: tenant, company_id: companyId, last_name: "Visite", first_name: "Fictif", job_title: "Cariste" }).select("id").single()).data.id;
    caseId = (await admin.from("cases").insert({ tenant_id: tenant, worker_id: w, company_id: companyId, opened_at: addDays(today, -80), origin: "MALADIE" }).select("id").single()).data.id;
    // 70-day leave ended 10 days ago: visite de reprise 2 days late.
    await admin.from("work_stoppages").insert({ tenant_id: tenant, worker_id: w, case_id: caseId, start_date: addDays(today, -80), end_date: addDays(today, -10), origin: "MALADIE", kind: "INITIAL", row_hash: crypto.randomUUID() });
    const doc = (await admin.from("documents").insert({ tenant_id: tenant, case_id: caseId, filename: "cr-secret.pdf", storage_path: `${tenant}/${caseId}/cr.pdf`, confidentiality: "MEDICAL", doc_type: "COMPTE_RENDU", analysis_status: "DONE" }).select("id").single()).data;
    const ev = (await admin.from("case_events").insert({ tenant_id: tenant, case_id: caseId, label: SECRET, confidentiality: "MEDICAL", source_document_id: doc.id, event_date: addDays(today, -20) }).select("id").single()).data;
    await admin.rpc("review_event", { _event: ev.id, _actor: medecin.id, _status: "APPROVED" });
  }, 90_000);
  afterAll(async () => {
    if (tenant) await admin.from("tenants").delete().eq("id", tenant);
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  }, 60_000);

  it("booking marks the deadline as planned, and the case leaves En retard", async () => {
    const before = await buildMyDay(admin, coord.id, today);
    expect(before.groups.EN_RETARD.map((r) => r.caseId)).toContain(caseId);
    await expect(bookVisit(admin, employer.id, { caseId, kind: "VISITE_REPRISE", practitionerId: medecin.id, scheduledAt: new Date().toISOString() })).rejects.toThrow();
    await expect(bookVisit(admin, coord.id, { caseId, kind: "VISITE_REPRISE", practitionerId: coord.id, scheduledAt: new Date().toISOString() })).rejects.toThrow("Praticien");
    // Booked for earlier today so the outcome can be entered below.
    const at = new Date(Date.now() - 60 * 60_000).toISOString();
    visitId = (await bookVisit(admin, coord.id, { caseId, kind: "VISITE_REPRISE", practitionerId: medecin.id, scheduledAt: at })).id;
    const facts = (await loadCaseFacts(admin, [caseId])).get(caseId);
    const st = (await admin.from("work_stoppages").select("start_date, end_date, origin, kind").eq("case_id", caseId)).data;
    const d = computeDeadlines(st, "MALADIE", today, facts).find((x) => x.code === "VISITE_REPRISE")!;
    expect(d.status).toBe("PLANIFIEE");
    const after = await buildMyDay(admin, coord.id, today);
    expect(after.groups.EN_RETARD.map((r) => r.caseId)).not.toContain(caseId);
    expect((await admin.from("audit_log").select("action").eq("case_id", caseId).eq("action", "VISIT_BOOK")).data).toHaveLength(1);
  });

  it("the preparation is for médecin / IDEST only and the employer never receives it", async () => {
    const prep = await buildVisitPrep(admin, medecin.id, visitId);
    expect(prep.lastFacts.map((f) => f.label)).toContain(SECRET);
    expect(prep.gaps.map((g) => g.code)).toContain("FICHE_POSTE");
    const q = await generateVisitQuestions(admin, idest.id, visitId);
    expect(q.text.split("\n").length).toBeGreaterThanOrEqual(3);
    await expect(buildVisitPrep(admin, coord.id, visitId)).rejects.toThrow();
    await expect(buildVisitPrep(admin, employer.id, visitId)).rejects.toThrow();
    // Employer payload: booked date only.
    const portal = JSON.stringify(await buildEmployerPortal(admin, tenant, companyId));
    expect(portal).toContain("Visite de reprise");
    for (const leak of [SECRET, "cr-secret", "Fiche de poste manquante", q.text.split("\n")[0]!.slice(2, 30)]) expect(portal).not.toContain(leak);
    // Direct reads are refused too.
    expect(((await employer.sb.from("visits").select("id")).data ?? []).length).toBe(0);
    expect(((await employer.sb.from("ai_drafts").select("id").eq("kind", "QUESTIONS_VISITE")).data ?? []).length).toBe(0);
  }, 60_000);

  it("only the médecin can enter the outcome; avis and letter wait for approval, then reach the employer", async () => {
    await expect(recordVisitOutcome(admin, idest.id, { visitId, avisType: "APTITUDE_AMENAGEMENTS", restrictions: "x" }, today)).rejects.toThrow("médecin");
    await expect(recordVisitOutcome(admin, coord.id, { visitId, avisType: "APTITUDE_AMENAGEMENTS", restrictions: "x" }, today)).rejects.toThrow();
    const r = await recordVisitOutcome(admin, medecin.id, { visitId, avisType: "APTITUDE_AMENAGEMENTS", restrictions: "Pas de port de charges de plus de 10 kg pendant 1 mois." }, today);
    const drafts = (await admin.from("ai_drafts").select("id, status, confidentiality").in("id", [r.avisDraftId, r.letterDraftId])).data;
    expect(drafts.every((d: any) => d.status === "DRAFT" && d.confidentiality === "EMPLOYER_VISIBLE")).toBe(true);
    expect(JSON.stringify(await buildEmployerPortal(admin, tenant, companyId))).not.toContain("10 kg");
    expect((await admin.from("case_avis").select("id").eq("case_id", caseId)).data).toHaveLength(0);
    // A coordinator cannot approve; the médecin can.
    expect((await admin.rpc("review_draft", { _draft: r.avisDraftId, _actor: coord.id, _status: "APPROVED", _text: null })).error).toBeTruthy();
    expect((await admin.rpc("review_draft", { _draft: r.avisDraftId, _actor: medecin.id, _status: "APPROVED", _text: null })).error).toBeNull();
    const { onDraftApproved } = await import("../../src/lib/visits.server");
    await onDraftApproved(admin, r.avisDraftId);
    expect((await admin.from("case_avis").select("avis_type").eq("case_id", caseId)).data).toEqual([{ avis_type: "APTITUDE_AMENAGEMENTS" }]);
    const portal = JSON.stringify(await buildEmployerPortal(admin, tenant, companyId));
    expect(portal).toContain("Apte avec aménagements");
    expect(portal).toContain("10 kg");
    expect(portal).not.toContain(SECRET);
    // Visite de reprise recorded as done on the visit date.
    expect((await admin.from("case_deadline_done").select("code").eq("case_id", caseId)).data).toEqual([{ code: "VISITE_REPRISE" }]);
  }, 60_000);
});
