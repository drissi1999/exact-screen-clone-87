/** "Ma journée": worklist for IDEST / coordinators. `db` is the service-role client; every query is tenant-filtered. */
import { computeDeadlines, todayParis, type Deadline, type Stoppage } from "./rules";
import { computeRisk, type RiskResult } from "./risk";
import { loadCaseFacts } from "./case-facts.server";
import { myDayPlanItems } from "./return-plan.server";

export const STAFF_ROLES = ["MEDECIN_TRAVAIL", "IDEST", "PDP_COORDINATOR", "SPSTI_ADMIN", "EXPERT"];
/** Tables the risk score may read. Never documents, case_events or ai_drafts (medical content). */
export const RISK_TABLES = ["cases", "work_stoppages", "workers", "companies", "case_avis", "coordination_tasks"] as const;

export type MyDayGroup = "EN_RETARD" | "AUJOURDHUI" | "SEMAINE" | "NOUVEAUX" | "DOCUMENTS" | "REPONSES" | "PLAN_TACHES" | "PLAN_ALERTES";
export type MyDayAction = "RDV_LIAISON" | "VALIDER" | "RELANCER" | "PUBLIER" | "PLAN";
export type MyDayRow = {
  caseId: string; worker: string; company: string; companyId: string; origin: string | null;
  reason: string; nextDeadline: { label: string; due: string } | null;
  score: number; topFactors: { libelle: string; points: number }[]; action: MyDayAction;
  alertTaskIds?: string[];
};

export async function assertStaff(db: any, userId: string): Promise<string> {
  const { data: p } = await db.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
  if (!p) throw new Error("Accès refusé");
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", p.tenant_id).in("role", STAFF_ROLES);
  if (!(roles ?? []).length) throw new Error("Accès refusé");
  return p.tenant_id as string;
}

/** Computes and stores the risk score of each case. Reads only RISK_TABLES. */
export async function scoreCases(db: any, tenantId: string, caseIds: string[], today = todayParis()): Promise<Map<string, RiskResult>> {
  const out = new Map<string, RiskResult>();
  if (!caseIds.length) return out;
  const { data: cases } = await db.from("cases").select("id, origin, worker_id, company_id").eq("tenant_id", tenantId).in("id", caseIds);
  const workerIds = [...new Set((cases ?? []).map((c: any) => c.worker_id))];
  const companyIds = [...new Set((cases ?? []).map((c: any) => c.company_id))];
  const [st, workers, companies, staff, avis, tasks] = await Promise.all([
    db.from("work_stoppages").select("worker_id, case_id, start_date, end_date, origin, kind").eq("tenant_id", tenantId).in("worker_id", workerIds),
    db.from("workers").select("id, birth_date, job_title").eq("tenant_id", tenantId).in("id", workerIds),
    db.from("companies").select("id, headcount").eq("tenant_id", tenantId).in("id", companyIds),
    db.from("workers").select("company_id").eq("tenant_id", tenantId).in("company_id", companyIds),
    db.from("case_avis").select("case_id, avis_type, avis_date, created_at").eq("tenant_id", tenantId).in("case_id", caseIds).order("avis_date", { ascending: false }),
    db.from("coordination_tasks").select("case_id, status, sent_at, created_at").eq("tenant_id", tenantId).in("case_id", caseIds).eq("recipient", "WORKER").in("status", ["SENT", "DONE"]),
  ]);
  const byId = <T,>(rows: any[] | null) => new Map<string, T>((rows ?? []).map((r) => [r.id, r]));
  const wk = byId<any>(workers.data), co = byId<any>(companies.data);
  const count = new Map<string, number>();
  for (const w of staff.data ?? []) count.set(w.company_id, (count.get(w.company_id) ?? 0) + 1);
  const rows: any[] = [];
  for (const c of cases ?? []) {
    const ws: Stoppage[] = (st.data ?? []).filter((s: any) => s.worker_id === c.worker_id);
    const last = (tasks.data ?? []).filter((t: any) => t.case_id === c.id).map((t: any) => String(t.sent_at ?? t.created_at)).sort().at(-1) ?? null;
    const w = wk.get(c.worker_id), comp = co.get(c.company_id);
    const r = computeRisk({
      caseStoppages: ws.filter((s: any) => s.case_id === c.id),
      workerStoppages: ws,
      origin: c.origin,
      birthDate: w?.birth_date ?? null,
      jobTitle: w?.job_title ?? null,
      avisType: (avis.data ?? []).find((a: any) => a.case_id === c.id)?.avis_type ?? null,
      lastWorkerContact: last,
      companyHeadcount: comp?.headcount ?? count.get(c.company_id) ?? null,
    }, today);
    out.set(c.id, r);
    rows.push({ case_id: c.id, tenant_id: tenantId, score: r.score, factors: r.factors, computed_at: new Date().toISOString() });
  }
  if (rows.length) await db.from("case_risk_scores").upsert(rows, { onConflict: "case_id" });
  return out;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function buildMyDay(db: any, userId: string, today = todayParis()) {
  const tenantId = await assertStaff(db, userId);
  const { data: cases } = await db.from("cases")
    .select("id, origin, opened_at, created_at, company_id, workers(first_name, last_name), companies(name)")
    .eq("tenant_id", tenantId).eq("status", "OPEN");
  const ids = (cases ?? []).map((c: any) => c.id as string);
  const weekAgo = addDays(today, -7);
  const [scores, facts, st, docs, replies, plan] = await Promise.all([
    scoreCases(db, tenantId, ids, today),
    loadCaseFacts(db, ids),
    ids.length ? db.from("work_stoppages").select("case_id, start_date, end_date, origin, kind").in("case_id", ids) : { data: [] },
    db.rpc("my_day_documents", { _actor: userId }),
    // Replies: files sent by the employer or the worker in the last 7 days (metadata only).
    ids.length ? db.from("documents").select("case_id, source, created_at").eq("tenant_id", tenantId).in("source", ["EMPLOYER", "WORKER"]).gte("created_at", weekAgo).in("case_id", ids) : { data: [] },
    myDayPlanItems(db, tenantId, ids, today),
  ]);
  const docMap = new Map<string, { draft_facts: number; publishable: number }>((docs.data ?? []).map((d: any) => [d.case_id, d]));
  const groups: Record<MyDayGroup, MyDayRow[]> = { EN_RETARD: [], AUJOURDHUI: [], SEMAINE: [], NOUVEAUX: [], DOCUMENTS: [], REPONSES: [], PLAN_TACHES: [], PLAN_ALERTES: [] };
  const week = addDays(today, 7);

  for (const c of cases ?? []) {
    const dl: Deadline[] = computeDeadlines((st.data ?? []).filter((s: any) => s.case_id === c.id), c.origin, today, facts.get(c.id)).filter((d) => d.due && d.status !== "INFO");
    const upcoming = [...dl].sort((a, b) => a.due!.localeCompare(b.due!));
    const next = upcoming.find((d) => d.status !== "DEPASSEE") ?? upcoming[0] ?? null;
    const risk = scores.get(c.id) ?? { score: 0, factors: [] };
    const base = {
      caseId: c.id as string, worker: `${c.workers?.last_name ?? ""} ${c.workers?.first_name ?? ""}`.trim(), company: (c.companies?.name ?? "") as string,
      companyId: c.company_id as string, origin: (c.origin ?? null) as string | null,
      nextDeadline: next ? { label: next.label, due: next.due! } : null,
      score: risk.score, topFactors: risk.factors.slice(0, 2).map((f) => ({ libelle: f.libelle, points: f.points })),
    };
    const deadlineAction = (d: Deadline): MyDayAction => (d.code === "RDV_LIAISON" ? "RDV_LIAISON" : "RELANCER");
    const overdue = dl.filter((d) => d.status === "DEPASSEE");
    if (overdue.length) groups.EN_RETARD.push({ ...base, reason: `En retard : ${overdue.map((d) => d.label).join(", ")}`, action: deadlineAction(overdue[0]!) });
    const todayD = dl.find((d) => d.status !== "DEPASSEE" && d.due === today);
    if (todayD) groups.AUJOURDHUI.push({ ...base, reason: `Échéance aujourd'hui : ${todayD.label}`, action: deadlineAction(todayD) });
    const weekD = dl.find((d) => d.status !== "DEPASSEE" && d.due! > today && d.due! <= week);
    if (weekD) groups.SEMAINE.push({ ...base, reason: `Échéance le ${weekD.due} : ${weekD.label}`, action: deadlineAction(weekD) });
    if (String(c.opened_at) >= weekAgo) groups.NOUVEAUX.push({ ...base, reason: `Nouveau dossier (ouvert le ${c.opened_at})`, action: "RDV_LIAISON" });
    const dm = docMap.get(c.id);
    if (dm?.draft_facts) groups.DOCUMENTS.push({ ...base, reason: `${dm.draft_facts} fait(s) à valider`, action: "VALIDER" });
    else if (dm?.publishable) groups.DOCUMENTS.push({ ...base, reason: `${dm.publishable} document(s) prêt(s) à publier`, action: "PUBLIER" });
    const rep = (replies.data ?? []).filter((r: any) => r.case_id === c.id);
    if (rep.length) groups.REPONSES.push({ ...base, reason: `${rep.length} document(s) reçu(s) ${rep.some((r: any) => r.source === "EMPLOYER") ? "de l'employeur" : "du salarié"}`, action: "VALIDER" });
    const pd = plan.due.filter((t: any) => t.case_id === c.id);
    if (pd.length) groups.PLAN_TACHES.push({ ...base, reason: `Plan de retour : ${pd.map((t: any) => `${t.title} (${t.due_date < today ? "en retard" : "aujourd'hui"})`).join(", ")}`, action: "PLAN" });
    const pa = plan.alerts.filter((t: any) => t.case_id === c.id);
    if (pa.length) groups.PLAN_ALERTES.push({ ...base, reason: `Alerte suivi : ${pa.map((t: any) => `${t.title} — ${t.outcome === "RECHUTE" ? "rechute" : "difficultés"}`).join(", ")}`, action: "PLAN", alertTaskIds: pa.map((t: any) => t.id as string) });
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score);
  const todo = new Set([...groups.EN_RETARD, ...groups.AUJOURDHUI, ...groups.NOUVEAUX, ...groups.DOCUMENTS, ...groups.REPONSES, ...groups.PLAN_TACHES, ...groups.PLAN_ALERTES].map((r) => r.caseId));
  return { today, toHandleToday: todo.size, groups };
}

/** Dated items (deadlines + open plan tasks) for the agenda and the médecin's "Visites à préparer". No medical tables read. */
export type AgendaItem = { date: string; caseId: string; worker: string; company: string; label: string; kind: "ECHEANCE" | "PLAN"; code: string; visit: boolean; overdue: boolean };
const VISIT_CODES = new Set(["PRE_REPRISE", "VISITE_REPRISE", "CONTESTATION_AVIS", "INAPTITUDE_SALARY_RESUMES"]);
export async function buildAgenda(db: any, userId: string, today = todayParis(), days = 30): Promise<{ today: string; items: AgendaItem[] }> {
  const tenantId = await assertStaff(db, userId);
  const { data: cases } = await db.from("cases")
    .select("id, origin, workers(first_name, last_name), companies(name)").eq("tenant_id", tenantId).eq("status", "OPEN");
  const ids = (cases ?? []).map((c: any) => c.id as string);
  const until = addDays(today, days);
  const [facts, st, tasks] = await Promise.all([
    loadCaseFacts(db, ids),
    ids.length ? db.from("work_stoppages").select("case_id, start_date, end_date, origin, kind").in("case_id", ids) : { data: [] },
    ids.length ? db.from("plan_tasks").select("case_id, code, title, due_date").eq("tenant_id", tenantId).in("case_id", ids).eq("status", "TODO").lte("due_date", until) : { data: [] },
  ]);
  const items: AgendaItem[] = [];
  for (const c of cases ?? []) {
    const base = { caseId: c.id as string, worker: `${c.workers?.last_name ?? ""} ${c.workers?.first_name ?? ""}`.trim(), company: (c.companies?.name ?? "") as string };
    for (const d of computeDeadlines((st.data ?? []).filter((s: any) => s.case_id === c.id), c.origin, today, facts.get(c.id))) {
      if (!d.due || d.status === "INFO" || d.due > until) continue;
      items.push({ ...base, date: d.due, label: d.label, kind: "ECHEANCE", code: d.code, visit: VISIT_CODES.has(d.code), overdue: d.status === "DEPASSEE" });
    }
    for (const t of (tasks.data ?? []).filter((t: any) => t.case_id === c.id)) {
      items.push({ ...base, date: t.due_date, label: t.title, kind: "PLAN", code: t.code, visit: t.code === "VISITE_REPRISE", overdue: t.due_date < today });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date));
  return { today, items };
}
