/** "Ma journée": worklist for IDEST / coordinators. `db` is the service-role client; every query is tenant-filtered. */
import { computeDeadlines, todayParis, SHORT_LABELS, type Deadline, type Stoppage } from "./rules";
import { computeRisk, type RiskResult } from "./risk";
import { loadCaseFacts } from "./case-facts.server";
import { myDayPlanItems } from "./return-plan.server";

export const STAFF_ROLES = ["MEDECIN_TRAVAIL", "IDEST", "PDP_COORDINATOR", "SPSTI_ADMIN", "EXPERT"];
/** Tables the risk score may read. Never documents, case_events or ai_drafts (medical content). */
export const RISK_TABLES = ["cases", "work_stoppages", "workers", "companies", "case_avis", "coordination_tasks"] as const;

export type MyDayGroup = "EN_RETARD" | "AUJOURDHUI" | "SEMAINE" | "NOUVEAUX" | "DOCUMENTS" | "REPONSES" | "PLAN_TACHES" | "PLAN_ALERTES";
export type MyDayAction = "RDV_LIAISON" | "PLANIFIER_VISITE" | "FAIT" | "VALIDER" | "RELANCER" | "PUBLIER" | "PLAN";
/** Display order; each case appears once, in the first group that applies. */
export const GROUP_PRIORITY: MyDayGroup[] = ["PLAN_ALERTES", "EN_RETARD", "AUJOURDHUI", "PLAN_TACHES", "SEMAINE", "DOCUMENTS", "REPONSES", "NOUVEAUX"];
export type MyDayRow = {
  caseId: string; worker: string; company: string; companyId: string; origin: string | null;
  reason: string; detail?: string; deadlineCode?: string; nextDeadline: { label: string; due: string } | null;
  score: number; topFactors: { libelle: string; points: number }[]; action: MyDayAction;
  alertTaskIds?: string[];
  /** Other issues on the same case (shown as "+N autre(s)"). */
  others: string[];
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

  const days = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const rel = (d: string) => { const n = days(d); return n < 0 ? `en retard de ${-n} jour${n < -1 ? "s" : ""}` : n === 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`; };
  const short = (d: Deadline) => SHORT_LABELS[d.code] ?? d.label;
  const actionFor = (d: Deadline): MyDayAction =>
    d.code === "RDV_LIAISON" ? "RDV_LIAISON" : d.code === "PRE_REPRISE" || d.code === "VISITE_REPRISE" ? "PLANIFIER_VISITE" : d.kind === "OBLIGATION" ? "FAIT" : "RELANCER";
  const fromDeadline = (d: Deadline) => ({ reason: `${short(d)} · ${rel(d.due!)}`, detail: `${d.label} — ${d.legalRef} (à valider juridiquement)`, deadlineCode: d.code, action: actionFor(d) });

  for (const c of cases ?? []) {
    // Only active items: done obligations, closed optional windows and passed informative dates are excluded.
    const dl: Deadline[] = computeDeadlines((st.data ?? []).filter((s: any) => s.case_id === c.id), c.origin, today, facts.get(c.id))
      .filter((d) => d.due && (d.status === "A_VENIR" || d.status === "EN_COURS" || d.status === "DEPASSEE"));
    const upcoming = [...dl].sort((a, b) => a.due!.localeCompare(b.due!));
    const next = upcoming.find((d) => d.status !== "DEPASSEE") ?? upcoming[0] ?? null;
    const risk = scores.get(c.id) ?? { score: 0, factors: [] };
    const base = {
      caseId: c.id as string, worker: `${c.workers?.last_name ?? ""} ${c.workers?.first_name ?? ""}`.trim(), company: (c.companies?.name ?? "") as string,
      companyId: c.company_id as string, origin: (c.origin ?? null) as string | null,
      nextDeadline: next ? { label: short(next), due: next.due! } : null,
      score: risk.score, topFactors: risk.factors.slice(0, 2).map((f) => ({ libelle: f.libelle, points: f.points })),
    };
    // First matching issue is the row; the others are listed under "+N autre(s)".
    let placed: MyDayRow | null = null;
    const pick = (g: MyDayGroup, row: Omit<MyDayRow, keyof typeof base | "others">) => {
      if (placed) { if (!placed.others.includes(row.reason)) placed.others.push(row.reason); return; }
      placed = { ...base, ...row, others: [] }; groups[g].push(placed);
    };
    const pa = plan.alerts.filter((t: any) => t.case_id === c.id);
    if (pa.length) pick("PLAN_ALERTES", { reason: `Suivi de reprise · ${pa[0].outcome === "RECHUTE" ? "rechute signalée" : "difficultés signalées"}`, detail: pa.map((t: any) => t.title).join(", "), action: "PLAN", alertTaskIds: pa.map((t: any) => t.id as string) });
    // Only legal obligations can be overdue.
    const overdue = upcoming.filter((d) => d.status === "DEPASSEE" && d.kind === "OBLIGATION");
    for (const d of overdue) pick("EN_RETARD", fromDeadline(d));
    const todayD = upcoming.find((d) => d.status !== "DEPASSEE" && d.due === today);
    if (todayD) pick("AUJOURDHUI", fromDeadline(todayD));
    const pd = plan.due.filter((t: any) => t.case_id === c.id);
    if (pd.length) pick("PLAN_TACHES", { reason: `${pd[0].title} · ${rel(pd[0].due_date)}`, detail: pd.map((t: any) => t.title).join(", "), action: "PLAN" });
    for (const d of upcoming.filter((d) => d.status !== "DEPASSEE" && d.due! > today && d.due! <= week)) pick("SEMAINE", fromDeadline(d));
    const dm = docMap.get(c.id);
    if (dm?.draft_facts) pick("DOCUMENTS", { reason: `${dm.draft_facts} fait${dm.draft_facts > 1 ? "s" : ""} à valider dans la chronologie`, action: "VALIDER" });
    else if (dm?.publishable) pick("DOCUMENTS", { reason: `${dm.publishable} document${dm.publishable > 1 ? "s" : ""} prêt${dm.publishable > 1 ? "s" : ""} à publier`, action: "PUBLIER" });
    const rep = (replies.data ?? []).filter((r: any) => r.case_id === c.id);
    if (rep.length) pick("REPONSES", { reason: `Document reçu ${rep.some((r: any) => r.source === "EMPLOYER") ? "de l'employeur" : "du salarié"}`, action: "VALIDER" });
    if (String(c.opened_at) >= weekAgo) pick("NOUVEAUX", { reason: `Nouveau dossier · ouvert ${rel(String(c.opened_at)).replace("en retard de", "il y a")}`, action: "RDV_LIAISON" });
  }
  for (const g of Object.values(groups)) g.sort((a, b) => b.score - a.score);
  const todo = new Set([...groups.EN_RETARD, ...groups.AUJOURDHUI, ...groups.NOUVEAUX, ...groups.DOCUMENTS, ...groups.REPONSES, ...groups.PLAN_TACHES, ...groups.PLAN_ALERTES].map((r) => r.caseId));
  return { today, toHandleToday: todo.size, groups };
}

/** Dated items (deadlines + open plan tasks) for the agenda and the médecin's "Visites à préparer". No medical tables read. */
export type AgendaItem = { date: string; caseId: string; worker: string; company: string; label: string; kind: "ECHEANCE" | "PLAN" | "VISITE"; code: string; visit: boolean; overdue: boolean; visitId?: string; time?: string };
const VISIT_CODES = new Set(["PRE_REPRISE", "VISITE_REPRISE", "CONTESTATION_AVIS", "INAPTITUDE_SALARY_RESUMES"]);
export async function buildAgenda(db: any, userId: string, today = todayParis(), days = 30): Promise<{ today: string; items: AgendaItem[] }> {
  const tenantId = await assertStaff(db, userId);
  const { data: cases } = await db.from("cases")
    .select("id, origin, workers(first_name, last_name), companies(name)").eq("tenant_id", tenantId).eq("status", "OPEN");
  const ids = (cases ?? []).map((c: any) => c.id as string);
  const until = addDays(today, days);
  const { upcomingVisits } = await import("./visits.server");
  const { VISIT_KIND_LABELS } = await import("./message-templates");
  const { parisDate } = await import("./case-facts.server");
  const [facts, st, tasks, visits] = await Promise.all([
    loadCaseFacts(db, ids),
    ids.length ? db.from("work_stoppages").select("case_id, start_date, end_date, origin, kind").in("case_id", ids) : { data: [] },
    ids.length ? db.from("plan_tasks").select("case_id, code, title, due_date").eq("tenant_id", tenantId).in("case_id", ids).eq("status", "TODO").lte("due_date", until) : { data: [] },
    upcomingVisits(db, tenantId, ids),
  ]);
  const items: AgendaItem[] = [];
  for (const c of cases ?? []) {
    const base = { caseId: c.id as string, worker: `${c.workers?.last_name ?? ""} ${c.workers?.first_name ?? ""}`.trim(), company: (c.companies?.name ?? "") as string };
    for (const d of computeDeadlines((st.data ?? []).filter((s: any) => s.case_id === c.id), c.origin, today, facts.get(c.id))) {
      if (!d.due || d.due > until || !["A_VENIR", "EN_COURS", "DEPASSEE"].includes(d.status)) continue;
      items.push({ ...base, date: d.due, label: d.label, kind: "ECHEANCE", code: d.code, visit: VISIT_CODES.has(d.code), overdue: d.status === "DEPASSEE" && d.kind === "OBLIGATION" });
    }
    for (const t of (tasks.data ?? []).filter((t: any) => t.case_id === c.id)) {
      items.push({ ...base, date: t.due_date, label: t.title, kind: "PLAN", code: t.code, visit: t.code === "VISITE_REPRISE", overdue: t.due_date < today });
    }
    for (const v of visits.filter((v) => v.case_id === c.id)) {
      const time = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(v.scheduled_at));
      items.push({ ...base, date: parisDate(v.scheduled_at), label: `${VISIT_KIND_LABELS[v.kind]} à ${time}`, kind: "VISITE", code: v.kind, visit: true, overdue: false, visitId: v.id, time });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
  return { today, items };
}
