/**
 * Visit booking, "Préparer la visite" and outcome entry. `db` is the service-role client;
 * every function checks the caller's role in the case's tenant first.
 */
import { episodes, todayParis } from "./rules";
import { parisDate } from "./case-facts.server";
import { computeGaps, fallbackQuestions, parseQuestions, type PrepEvent } from "./visit-prep";
import { renderAvisLetter, renderAvisText, VISIT_KIND_LABELS } from "./message-templates";
import { SUMMARY_MODEL } from "./summary";

export const VISIT_KINDS = ["RDV_LIAISON", "PRE_REPRISE", "VISITE_REPRISE"] as const;
export const AVIS_TYPES = ["APTITUDE", "APTITUDE_AMENAGEMENTS", "INAPTITUDE"] as const;
const PRACTITIONER_ROLES = ["MEDECIN_TRAVAIL", "IDEST"];
const frDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR");

async function tenantOf(db: any, userId: string): Promise<string> {
  const { data } = await db.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Accès refusé");
  return data.tenant_id as string;
}
async function rolesOf(db: any, userId: string, tenantId: string): Promise<string[]> {
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", tenantId);
  return (data ?? []).map((r: any) => r.role as string);
}
async function audit(db: any, tenantId: string, userId: string, action: string, entityId: string, caseId: string) {
  await db.from("audit_log").insert({ tenant_id: tenantId, user_id: userId, action, entity: "visits", entity_id: entityId, case_id: caseId });
}
async function loadVisit(db: any, visitId: string) {
  const { data: v } = await db.from("visits").select("*").eq("id", visitId).maybeSingle();
  if (!v) throw new Error("Visite introuvable");
  return v;
}
/** Médecin or IDEST of the visit's tenant. */
async function assertPractitioner(db: any, actor: string, tenantId: string) {
  if ((await tenantOf(db, actor)) !== tenantId) throw new Error("Accès refusé");
  const roles = await rolesOf(db, actor, tenantId);
  if (!roles.some((r) => PRACTITIONER_ROLES.includes(r))) throw new Error("Réservé au médecin du travail et à l'infirmier(e)");
  return roles;
}

export async function listPractitioners(db: any, actor: string) {
  const t = await tenantOf(db, actor);
  const { data: roles } = await db.from("user_roles").select("user_id, role").eq("tenant_id", t).in("role", PRACTITIONER_ROLES);
  const ids = [...new Set((roles ?? []).map((r: any) => r.user_id))];
  const { data: profiles } = ids.length ? await db.from("profiles").select("user_id, full_name").in("user_id", ids) : { data: [] };
  return ids.map((id) => ({
    id: id as string,
    name: ((profiles ?? []).find((p: any) => p.user_id === id)?.full_name ?? "Praticien") as string,
    role: (roles ?? []).some((r: any) => r.user_id === id && r.role === "MEDECIN_TRAVAIL") ? "Médecin du travail" : "Infirmier(e) santé travail",
  }));
}

/** Books a visit. Staff of the tenant; the practitioner must be a médecin or IDEST of the same tenant. */
export async function bookVisit(db: any, actor: string, input: { caseId: string; kind: string; practitionerId: string; scheduledAt: string }) {
  if (!(VISIT_KINDS as readonly string[]).includes(input.kind)) throw new Error("Type de visite invalide");
  const when = new Date(input.scheduledAt);
  if (Number.isNaN(when.getTime())) throw new Error("Créneau invalide");
  const { data: c } = await db.from("cases").select("tenant_id").eq("id", input.caseId).maybeSingle();
  if (!c) throw new Error("Dossier introuvable");
  const { data: ok } = await db.rpc("can_write_case", { _actor: actor, _case: input.caseId, _level: "ADMINISTRATIVE" });
  if (ok !== true) throw new Error("Accès refusé");
  const pr = await rolesOf(db, input.practitionerId, c.tenant_id);
  if (!pr.some((r) => PRACTITIONER_ROLES.includes(r))) throw new Error("Praticien invalide");
  const { data: v, error } = await db.from("visits").insert({
    tenant_id: c.tenant_id, case_id: input.caseId, kind: input.kind, practitioner_id: input.practitionerId, scheduled_at: when.toISOString(), created_by: actor,
  }).select("id").single();
  if (error) throw new Error("Réservation impossible");
  await audit(db, c.tenant_id, actor, "VISIT_BOOK", v.id, input.caseId);
  await db.rpc("add_plan_event", { _actor: actor, _case: input.caseId, _label: `${VISIT_KIND_LABELS[input.kind]} planifiée le ${frDate(parisDate(when.toISOString()))}` });
  return { id: v.id as string };
}

/** Visits of one case (staff of the tenant). No preparation content. */
export async function listCaseVisits(db: any, actor: string, caseId: string) {
  const { data: c } = await db.from("cases").select("tenant_id").eq("id", caseId).maybeSingle();
  if (!c || (await tenantOf(db, actor)) !== c.tenant_id) throw new Error("Accès refusé");
  const { data: staff } = await db.rpc("can_write_case", { _actor: actor, _case: caseId, _level: "ADMINISTRATIVE" });
  if (staff !== true) throw new Error("Accès refusé");
  const { data } = await db.from("visits").select("id, kind, scheduled_at, status, practitioner_id, avis_type").eq("case_id", caseId).order("scheduled_at", { ascending: false });
  const people = await listPractitioners(db, actor);
  return (data ?? []).map((v: any) => ({
    id: v.id as string, kind: v.kind as string, scheduledAt: v.scheduled_at as string, status: v.status as string, avisType: (v.avis_type ?? null) as string | null,
    practitioner: people.find((p) => p.id === v.practitioner_id)?.name ?? "Praticien",
  }));
}

/** Upcoming visits of the tenant, for the agenda (no preparation content). */
export async function upcomingVisits(db: any, tenantId: string, caseIds: string[]) {
  if (!caseIds.length) return [];
  const { data } = await db.from("visits").select("id, case_id, kind, scheduled_at").eq("tenant_id", tenantId).in("case_id", caseIds).eq("status", "PLANIFIEE");
  return (data ?? []) as { id: string; case_id: string; kind: string; scheduled_at: string }[];
}

/** Preparation view. Médecin / IDEST only; medical reads go through staff_case_items (audited). */
export async function buildVisitPrep(db: any, actor: string, visitId: string) {
  const v = await loadVisit(db, visitId);
  const roles = await assertPractitioner(db, actor, v.tenant_id);
  const { data: items, error } = await db.rpc("staff_case_items", { _actor: actor, _case: v.case_id });
  if (error) throw new Error("Accès refusé");
  const [{ data: c }, { data: st }, { data: avis }, { data: past }, { data: fiche }] = await Promise.all([
    db.from("cases").select("id, origin, workers(first_name, last_name, job_title), companies(name)").eq("id", v.case_id).single(),
    db.from("work_stoppages").select("start_date, end_date, origin, kind").eq("case_id", v.case_id),
    db.from("case_avis").select("avis_type, avis_date").eq("case_id", v.case_id).order("avis_date", { ascending: false }),
    db.from("visits").select("id, kind, scheduled_at, avis_type, restrictions").eq("case_id", v.case_id).eq("status", "REALISEE").neq("id", visitId).order("scheduled_at", { ascending: false }),
    // Job constraints: non-medical job descriptions only.
    db.from("documents").select("id, filename, extracted_text").eq("case_id", v.case_id).eq("doc_type", "FICHE_POSTE").neq("confidentiality", "MEDICAL"),
  ]);
  const events = (items.events ?? []) as PrepEvent[];
  const ep = episodes(st ?? []).at(-1) ?? null;
  const gaps = computeGaps({ docTypes: (items.documents ?? []).map((d: any) => d.doc_type), events, episodeEnd: ep?.end ?? null });
  const summary = (items.drafts ?? []).find((d: any) => d.kind === "SYNTHESE" && d.status === "APPROVED") ?? null;
  const qDraft = v.questions_draft_id ? (items.drafts ?? []).find((d: any) => d.id === v.questions_draft_id) ?? null : null;
  const lastFacts = events.filter((e) => e.status === "APPROVED").sort((a, b) => String(b.event_date ?? "").localeCompare(String(a.event_date ?? ""))).slice(0, 5);
  const outcomeDrafts = (items.drafts ?? []).filter((d: any) => d.id === v.avis_draft_id || d.id === v.letter_draft_id);
  return {
    visit: { id: v.id as string, caseId: v.case_id as string, kind: v.kind as string, scheduledAt: v.scheduled_at as string, status: v.status as string, avisType: (v.avis_type ?? null) as string | null, restrictions: (v.restrictions ?? null) as string | null },
    worker: `${c.workers?.last_name ?? ""} ${c.workers?.first_name ?? ""}`.trim(),
    company: (c.companies?.name ?? "") as string,
    jobTitle: (c.workers?.job_title ?? null) as string | null,
    canEnterOutcome: roles.includes("MEDECIN_TRAVAIL"),
    summary: summary ? { text: String(summary.approved_text ?? summary.draft_text), approvedAt: summary.approved_at as string } : null,
    lastFacts: lastFacts.map((e) => ({ id: e.id, date: e.event_date, label: e.label, source: e.source_filename ? `${e.source_filename}${e.source_page ? `, p.${e.source_page}` : ""}` : null })),
    gaps,
    jobConstraints: (fiche ?? []).map((d: any) => ({ id: d.id as string, text: String(d.extracted_text ?? "").slice(0, 1500) })),
    previousAvis: [
      ...(avis ?? []).map((a: any) => ({ date: a.avis_date as string, type: a.avis_type as string, restrictions: null as string | null })),
      ...(past ?? []).filter((p: any) => p.restrictions).map((p: any) => ({ date: parisDate(p.scheduled_at), type: p.avis_type as string, restrictions: p.restrictions as string })),
    ],
    questions: qDraft ? { id: qDraft.id as string, text: String(qDraft.draft_text) } : null,
    outcomeDrafts: outcomeDrafts.map((d: any) => ({ id: d.id as string, kind: d.kind as string, status: d.status as string, text: String(d.approved_text ?? d.draft_text) })),
  };
}

async function askQuestions(gaps: string[], kind: string): Promise<string[] | null> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Tu aides un médecin du travail à préparer une visite. Propose 3 à 5 questions courtes à poser au salarié, en français simple, uniquement à partir des points manquants fournis. Aucun diagnostic, aucun conseil de traitement. Réponds en JSON : {\"questions\": [\"...\"]}." },
          { role: "user", content: `Type de visite : ${VISIT_KIND_LABELS[kind] ?? kind}\nPoints manquants :\n${gaps.map((g) => `- ${g}`).join("\n") || "- aucun"}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const body: any = await res.json();
    return parseQuestions(String(body.choices?.[0]?.message?.content ?? ""));
  } catch {
    return null;
  }
}

/** Generates 3–5 suggested questions from the gaps, stored as a MEDICAL draft for the médecin. */
export async function generateVisitQuestions(db: any, actor: string, visitId: string) {
  const prep = await buildVisitPrep(db, actor, visitId);
  const v = await loadVisit(db, visitId);
  const qs = (await askQuestions(prep.gaps.map((g) => g.text), v.kind)) ?? fallbackQuestions(prep.gaps);
  const text = qs.map((q) => `- ${q}`).join("\n");
  const { data: d, error } = await db.from("ai_drafts").insert({
    tenant_id: v.tenant_id, case_id: v.case_id, kind: "QUESTIONS_VISITE", confidentiality: "MEDICAL", draft_text: text,
    required_role: "MEDECIN_TRAVAIL", created_by: actor, source_fact_ids: [], model: SUMMARY_MODEL,
  }).select("id").single();
  if (error) throw new Error("Enregistrement impossible");
  await db.from("visits").update({ questions_draft_id: d.id }).eq("id", visitId);
  await db.from("audit_log").insert({ tenant_id: v.tenant_id, user_id: actor, action: "AI_DRAFT", entity: "ai_drafts", entity_id: d.id, case_id: v.case_id });
  return { id: d.id as string, text };
}

/** Saves the edited questions (draft text only; the draft stays a draft). */
export async function saveVisitQuestions(db: any, actor: string, visitId: string, text: string) {
  const v = await loadVisit(db, visitId);
  await assertPractitioner(db, actor, v.tenant_id);
  if (!v.questions_draft_id) throw new Error("Aucune question à enregistrer");
  const { error } = await db.from("ai_drafts").update({ draft_text: text.slice(0, 4000) }).eq("id", v.questions_draft_id).eq("status", "DRAFT");
  if (error) throw new Error("Enregistrement impossible");
  return { ok: true };
}

/**
 * Outcome entry: MEDECIN_TRAVAIL only. Creates the employer avis and letter from fixed templates
 * (inputs: decision type, restrictions in plain words, dates — never a medical field), both DRAFT
 * until the médecin approves them. The avis itself is recorded on approval (onDraftApproved).
 */
export async function recordVisitOutcome(db: any, actor: string, input: { visitId: string; avisType: string; restrictions: string | null }, today = todayParis()) {
  const v = await loadVisit(db, input.visitId);
  const roles = await assertPractitioner(db, actor, v.tenant_id);
  if (!roles.includes("MEDECIN_TRAVAIL")) throw new Error("Seul le médecin du travail peut saisir l'issue de la visite");
  if (!(AVIS_TYPES as readonly string[]).includes(input.avisType)) throw new Error("Type d'avis invalide");
  if (v.status !== "PLANIFIEE") throw new Error("Issue déjà saisie");
  const visitDate = parisDate(v.scheduled_at);
  if (visitDate > today) throw new Error("La visite n'a pas encore eu lieu");
  const restrictions = input.restrictions?.trim().slice(0, 1000) || null;
  const { data: c } = await db.from("cases").select("workers(first_name, last_name, job_title), companies(name)").eq("id", v.case_id).single();
  const vars = { worker: `${c.workers?.first_name ?? ""} ${c.workers?.last_name ?? ""}`.trim(), jobTitle: c.workers?.job_title ?? null, company: c.companies?.name ?? "", visitKind: v.kind, visitDate, avisType: input.avisType, restrictions };
  const draft = (kind: string, text: string) => ({ tenant_id: v.tenant_id, case_id: v.case_id, kind, confidentiality: "EMPLOYER_VISIBLE", draft_text: text, required_role: "MEDECIN_TRAVAIL", created_by: actor, source_fact_ids: [], model: null });
  const { data: rows, error } = await db.from("ai_drafts").insert([draft("AVIS_VISITE", renderAvisText(vars)), draft("COURRIER_AVIS", renderAvisLetter(vars))]).select("id, kind");
  if (error) throw new Error("Enregistrement impossible");
  const avisId = rows.find((r: any) => r.kind === "AVIS_VISITE").id, letterId = rows.find((r: any) => r.kind === "COURRIER_AVIS").id;
  await db.from("visits").update({ status: "REALISEE", avis_type: input.avisType, restrictions, outcome_at: new Date().toISOString(), outcome_by: actor, avis_draft_id: avisId, letter_draft_id: letterId }).eq("id", v.id);
  if (v.kind === "VISITE_REPRISE") {
    await db.from("case_deadline_done").upsert({ tenant_id: v.tenant_id, case_id: v.case_id, code: "VISITE_REPRISE", done_on: visitDate, done_by: actor }, { onConflict: "case_id,code" });
  }
  await audit(db, v.tenant_id, actor, "VISIT_OUTCOME", v.id, v.case_id);
  return { avisDraftId: avisId as string, letterDraftId: letterId as string };
}

/** Called after a successful approval: an approved visit avis becomes the case's avis (deadlines, risk). */
export async function onDraftApproved(db: any, draftId: string) {
  const { data: v } = await db.from("visits").select("id, tenant_id, case_id, scheduled_at, avis_type, outcome_by").eq("avis_draft_id", draftId).maybeSingle();
  if (!v || !v.avis_type) return;
  const { data: row } = await db.from("case_avis").insert({ tenant_id: v.tenant_id, case_id: v.case_id, avis_type: v.avis_type, avis_date: parisDate(v.scheduled_at), created_by: v.outcome_by }).select("id").single();
  await db.from("audit_log").insert({ tenant_id: v.tenant_id, user_id: v.outcome_by, action: "AVIS_CREATE", entity: "case_avis", entity_id: row?.id ?? null, case_id: v.case_id });
}
