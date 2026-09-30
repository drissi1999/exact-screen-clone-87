// Server-only: turns validated rows into Companies, Workers, WorkStoppages and Cases.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  stringifyRaw,
  rowFingerprint,
  sha256,
  type NormalizedRow,
} from "./import-core";
import { episodeDuration, episodes, todayParis } from "./rules";

type Client = SupabaseClient<any, any, any>;

export interface CommitCounts {
  rowsTotal: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsFailed: number;
  workersCreated: number;
  companiesCreated: number;
  casesCreated: number;
  errors: { rowNumber: number; errors: string[]; raw: Record<string, string> }[];
}

export interface CommitOptions {
  filename: string;
  source?: "FILE" | "API";
  importProfileId?: string | null;
  fileHash?: string | null;
  invalidRows?: { rowNumber: number; errors: string[]; raw: Record<string, string> }[];
}

export async function commitRows(
  client: Client,
  tenantId: string,
  rows: NormalizedRow[],
  options: CommitOptions,
): Promise<CommitCounts & { importRunId: string }> {
  const invalid = options.invalidRows ?? [];
  const counts: CommitCounts = {
    rowsTotal: rows.length + invalid.length,
    rowsImported: 0,
    rowsSkipped: 0,
    rowsFailed: invalid.length,
    workersCreated: 0,
    companiesCreated: 0,
    casesCreated: 0,
    errors: [...invalid],
  };

  const { data: run, error: runError } = await client
    .from("import_runs")
    .insert({
      tenant_id: tenantId,
      filename: options.filename,
      file_hash: options.fileHash ?? null,
      import_profile_id: options.importProfileId ?? null,
      source: options.source ?? "FILE",
      status: "RUNNING",
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message ?? "Impossible de créer l'exécution d'import");

  const companyCache = new Map<string, string>();
  const workerCache = new Map<string, string>();
  const touchedWorkers = new Set<string>();

  for (const row of rows) {
    try {
      const companyId = await resolveCompany(client, tenantId, row, companyCache, counts);
      const workerId = await resolveWorker(client, tenantId, companyId, row, workerCache, counts);
      const hash = await sha256(`${tenantId}|${rowFingerprint(row)}`);

      const { data: existing } = await client
        .from("work_stoppages")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("row_hash", hash)
        .maybeSingle();
      if (existing) {
        touchedWorkers.add(workerId);
        counts.rowsSkipped += 1;
        continue;
      }

      touchedWorkers.add(workerId);

      const { error: stoppageError } = await client.from("work_stoppages").insert({
        tenant_id: tenantId,
        worker_id: workerId,
        case_id: null, // attached by reconcileWorkerCases once the whole episode is known
        start_date: row.start_date,
        end_date: row.end_date,
        origin: row.origin,
        kind: row.kind,
        row_hash: hash,
        import_run_id: run.id,
      });
      if (stoppageError) {
        if (stoppageError.code === "23505") {
          counts.rowsSkipped += 1;
          continue;
        }
        throw new Error(stoppageError.message);
      }
      counts.rowsImported += 1;
    } catch (error) {
      counts.rowsFailed += 1;
      counts.errors.push({
        rowNumber: row.rowNumber,
        errors: [error instanceof Error ? error.message : "Erreur inconnue"],
        raw: stringifyRaw(row as unknown as Record<string, unknown>),
      });
    }
  }

  for (const workerId of touchedWorkers) {
    counts.casesCreated += await reconcileWorkerCases(client, tenantId, workerId);
  }

  if (counts.errors.length) {
    await client.from("import_row_errors").insert(
      counts.errors.slice(0, 500).map((e) => ({
        tenant_id: tenantId,
        import_run_id: run.id,
        row_number: e.rowNumber,
        errors: e.errors,
        raw: e.raw,
      })),
    );
  }

  await client
    .from("import_runs")
    .update({
      status: "DONE",
      rows_total: counts.rowsTotal,
      rows_imported: counts.rowsImported,
      rows_skipped: counts.rowsSkipped,
      rows_failed: counts.rowsFailed,
      workers_created: counts.workersCreated,
      cases_created: counts.casesCreated,
    })
    .eq("id", run.id);

  return { ...counts, importRunId: run.id };
}

async function resolveCompany(
  client: Client,
  tenantId: string,
  row: NormalizedRow,
  cache: Map<string, string>,
  counts: CommitCounts,
): Promise<string> {
  const key = (row.company_siret ?? row.company_name).toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let query = client.from("companies").select("id").eq("tenant_id", tenantId).limit(1);
  query = row.company_siret ? query.eq("siret", row.company_siret) : query.ilike("name", row.company_name);
  const { data: found } = await query.maybeSingle();
  if (found) {
    cache.set(key, found.id);
    return found.id;
  }

  const { data: created, error } = await client
    .from("companies")
    .insert({ tenant_id: tenantId, name: row.company_name, siret: row.company_siret })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Création de l'entreprise impossible");
  counts.companiesCreated += 1;
  cache.set(key, created.id);
  return created.id;
}

async function resolveWorker(
  client: Client,
  tenantId: string,
  companyId: string,
  row: NormalizedRow,
  cache: Map<string, string>,
  counts: CommitCounts,
): Promise<string> {
  const key = [companyId, row.last_name, row.first_name, row.birth_date ?? ""].join("|").toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  let query = client
    .from("workers")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("company_id", companyId)
    .ilike("last_name", row.last_name)
    .ilike("first_name", row.first_name)
    .limit(1);
  query = row.birth_date ? query.eq("birth_date", row.birth_date) : query.is("birth_date", null);
  const { data: found } = await query.maybeSingle();
  if (found) {
    cache.set(key, found.id);
    return found.id;
  }

  const { data: created, error } = await client
    .from("workers")
    .insert({
      tenant_id: tenantId,
      company_id: companyId,
      last_name: row.last_name,
      first_name: row.first_name,
      birth_date: row.birth_date,
      email: row.email,
      phone: row.phone,
      job_title: row.job_title,
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Création du salarié impossible");
  counts.workersCreated += 1;
  cache.set(key, created.id);
  return created.id;
}

/**
 * Groups every stoppage of the worker into episodes (same contiguity rule as the deadlines).
 * A qualifying episode (continuous >= 30 days, or AT/MP) gets a case: an existing one linked to
 * any of its stoppages or opened inside its dates, else a new one. Every case-less stoppage of the
 * episode is attached to it. Idempotent. Returns the number of cases opened.
 */
export async function reconcileWorkerCases(client: Client, tenantId: string, workerId: string, today = todayParis()): Promise<number> {
  const [{ data: stops }, { data: cases }, { data: worker }] = await Promise.all([
    client.from("work_stoppages").select("id, case_id, start_date, end_date, origin, kind").eq("tenant_id", tenantId).eq("worker_id", workerId),
    client.from("cases").select("id, opened_at").eq("tenant_id", tenantId).eq("worker_id", workerId),
    client.from("workers").select("company_id").eq("id", workerId).single(),
  ]);
  let opened = 0;
  for (const ep of episodes((stops ?? []) as any[])) {
    const members = ep.stoppages as any[];
    const origin = members.find((m) => m.origin === "AT" || m.origin === "MP")?.origin ?? members[0].origin;
    if (!(origin === "AT" || origin === "MP" || episodeDuration(ep, today) >= 30)) continue;
    const epEnd = ep.end ?? "9999-12-31";
    let caseId: string | undefined =
      members.find((m) => m.case_id)?.case_id ?? (cases ?? []).find((c: any) => c.opened_at >= ep.start && c.opened_at <= epEnd)?.id;
    if (!caseId) {
      const { data: created, error } = await client
        .from("cases")
        .insert({ tenant_id: tenantId, worker_id: workerId, company_id: worker!.company_id, status: "OPEN", origin, opened_at: ep.start })
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "Ouverture du dossier impossible");
      caseId = created.id as string;
      opened += 1;
    }
    const loose = members.filter((m) => !m.case_id).map((m) => m.id);
    if (loose.length) {
      const { error } = await client.from("work_stoppages").update({ case_id: caseId }).in("id", loose);
      if (error) throw new Error(error.message);
    }
  }
  return opened;
}
