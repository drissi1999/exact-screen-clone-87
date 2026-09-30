/**
 * Import gap: stoppages grouped into contiguous episodes; a qualifying episode opens one case and
 * every stoppage of it is attached. File import (commitRows) and the public API behave the same.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { commitRows } from "../../src/lib/import-engine.server";
import { sha256, type NormalizedRow } from "../../src/lib/import-core";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && SERVICE ? describe : describe.skip;
const APP = "http://localhost:8080";

run("import episodes (live database)", () => {
  const admin = createClient(URL!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  let tenant = "";
  let apiKey = "";

  const row = (last: string, start: string, end: string, kind: "INITIAL" | "PROLONGATION", n: number): NormalizedRow => ({
    rowNumber: n, company_name: "Entreprise Fictive Import", company_siret: null, last_name: last, first_name: "Fictif",
    birth_date: "1980-01-01", email: null, phone: null, job_title: null, start_date: start, end_date: end, origin: "MALADIE", kind,
  });
  const contiguous = (last: string) => [
    row(last, "2026-01-01", "2026-01-15", "INITIAL", 1), // 15 d
    row(last, "2026-01-16", "2026-01-30", "PROLONGATION", 2), // +15 d
    row(last, "2026-01-31", "2026-02-19", "PROLONGATION", 3), // +20 d = 50 d
  ];
  const gapped = (last: string) => [
    row(last, "2026-01-01", "2026-01-15", "INITIAL", 1),
    row(last, "2026-01-17", "2026-02-05", "PROLONGATION", 2), // 1-day gap, 20 d
  ];
  async function state(last: string) {
    const w = (await admin.from("workers").select("id").eq("tenant_id", tenant).eq("last_name", last)).data ?? [];
    if (!w.length) return { workers: 0, cases: [] as any[], stoppages: [] as any[] };
    const ids = w.map((x: any) => x.id);
    const cases = (await admin.from("cases").select("id, opened_at").in("worker_id", ids)).data;
    const stoppages = (await admin.from("work_stoppages").select("id, case_id, start_date").in("worker_id", ids).order("start_date")).data;
    return { workers: w.length, cases, stoppages };
  }
  const postApi = async (rows: NormalizedRow[]) => {
    const res = await fetch(`${APP}/api/public/ingest/stoppages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ source: "test", stoppages: rows.map(({ rowNumber, ...r }) => r) }),
    });
    expect(res.status).toBe(200);
    return res.json();
  };

  beforeAll(async () => {
    tenant = (await admin.from("tenants").insert({ name: "Tenant test import" }).select("id").single()).data.id;
    apiKey = `rk_test_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.from("api_keys").insert({ tenant_id: tenant, label: "test", key_hash: await sha256(apiKey), key_prefix: apiKey.slice(0, 12) });
  });
  afterAll(async () => {
    for (const t of ["import_row_errors", "work_stoppages", "import_runs", "cases", "workers", "companies", "api_keys"]) await admin.from(t).delete().eq("tenant_id", tenant);
    await admin.from("tenants").delete().eq("id", tenant);
  }, 60_000);

  it("file: 15 + 15 + 20 contiguous days opens one case with 3 stoppages, even when imported one by one", async () => {
    const rows = contiguous("Contigu");
    for (const r of rows) await commitRows(admin, tenant, [r], { filename: "t.csv" }); // worst case: separate imports
    const s = await state("Contigu");
    expect(s.cases).toHaveLength(1);
    expect(s.cases[0].opened_at).toBe("2026-01-01");
    expect(s.stoppages.map((x: any) => x.case_id)).toEqual([s.cases[0].id, s.cases[0].id, s.cases[0].id]);
  });

  it("file: 15 days, a 1-day gap, then 20 days opens nothing", async () => {
    const res = await commitRows(admin, tenant, gapped("Coupure"), { filename: "t.csv" });
    expect(res.casesCreated).toBe(0);
    const s = await state("Coupure");
    expect(s.cases).toHaveLength(0);
    expect(s.stoppages.every((x: any) => x.case_id === null)).toBe(true);
  });

  it("file: re-import changes nothing", async () => {
    const before = await state("Contigu");
    const res = await commitRows(admin, tenant, contiguous("Contigu"), { filename: "t.csv" });
    expect(res.rowsSkipped).toBe(3);
    expect(res.casesCreated).toBe(0);
    expect(await state("Contigu")).toEqual(before);
  });

  it("API ingestion behaves the same", async () => {
    const a = await postApi(contiguous("ApiContigu"));
    expect(a.cases_created).toBe(1);
    const s = await state("ApiContigu");
    expect(s.cases).toHaveLength(1);
    expect(s.stoppages.every((x: any) => x.case_id === s.cases[0].id)).toBe(true);
    expect(s.stoppages).toHaveLength(3);

    const b = await postApi(gapped("ApiCoupure"));
    expect(b.cases_created).toBe(0);
    expect((await state("ApiCoupure")).cases).toHaveLength(0);

    const again = await postApi(contiguous("ApiContigu"));
    expect(again.skipped_duplicates).toBe(3);
    expect(again.cases_created).toBe(0);
    expect(await state("ApiContigu")).toEqual(s);
  });
}, 120_000);
