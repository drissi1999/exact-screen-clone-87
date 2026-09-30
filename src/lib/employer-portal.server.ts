import { computeDeadlines } from "./rules";
import { genericDocTitle } from "./message-templates";

const EMPLOYER_DEADLINES = new Set(["DECLARATION_AT", "RDV_LIAISON", "VISITE_REPRISE"]);

/** Employer portal payload, company-scoped, explicit column whitelist, never a filename or medical field. */
export async function buildEmployerPortal(db: any, tenantId: string, companyId: string) {
    const { data: company } = await db.from("companies").select("name").eq("id", companyId).single();
    // Explicit column whitelist: never select origin, diagnosis or medical fields.
    const { data: cases } = await db
      .from("cases")
      .select("id, status, opened_at, closed_at, origin, worker_id, workers(first_name, last_name, job_title)")
      .eq("tenant_id", tenantId)
      .eq("company_id", companyId)
      .order("opened_at", { ascending: false });
    const ids = (cases ?? []).map((c: any) => c.id);
    const workerIds = (cases ?? []).map((c: any) => c.worker_id);
    const [st, docs, drafts, tasks] = await Promise.all([
      db.from("work_stoppages").select("worker_id, start_date, end_date, origin, kind").in("worker_id", workerIds.length ? workerIds : ["00000000-0000-0000-0000-000000000000"]),
      db.from("documents").select("id, case_id, doc_type, created_at").in("case_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("confidentiality", "EMPLOYER_VISIBLE"),
      db.from("ai_drafts").select("id, case_id, kind, approved_text, approved_at").in("case_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("confidentiality", "EMPLOYER_VISIBLE").eq("status", "APPROVED"),
      db.from("coordination_tasks").select("id, case_id, message, status, due_at").in("case_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("recipient", "EMPLOYER_HR").in("status", ["SENT", "DONE"]),
    ]);
    return {
      company: company?.name as string,
      cases: (cases ?? []).map((c: any) => {
        const stops = (st.data ?? []).filter((s: any) => s.worker_id === c.worker_id);
        return {
          id: c.id as string,
          status: c.status as string,
          openedAt: c.opened_at as string,
          worker: `${c.workers?.first_name ?? ""} ${c.workers?.last_name ?? ""}`.trim(),
          jobTitle: (c.workers?.job_title ?? null) as string | null,
          periods: stops.map((s: any) => ({ start: s.start_date as string, end: (s.end_date ?? null) as string | null })),
          deadlines: computeDeadlines(stops, c.origin)
            .filter((d) => EMPLOYER_DEADLINES.has(d.code))
            .map((d) => ({ code: d.code, label: d.label, legalRef: d.legalRef, due: d.due, status: d.status })),
          documents: (docs.data ?? []).filter((d: any) => d.case_id === c.id).map((d: any) => ({ id: d.id as string, title: genericDocTitle(d.doc_type), createdAt: d.created_at as string })),
          letters: (drafts.data ?? []).filter((d: any) => d.case_id === c.id).map((d: any) => ({ id: d.id as string, text: d.approved_text as string, approvedAt: d.approved_at as string })),
          tasks: (tasks.data ?? []).filter((t: any) => t.case_id === c.id).map((t: any) => ({ id: t.id as string, message: t.message as string, status: t.status as string, due: (t.due_at ?? null) as string | null })),
        };
      }),
    };
}
