import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  FIELDS,
  FIELD_KEYS,
  suggestMappingFuzzy,
  validateRows,
  type FieldKey,
  type Mapping,
  type MappingSuggestion,
} from "./import-core";

const rowSchema = z.record(z.string(), z.unknown());
const mappingSchema = z.record(z.string(), z.string().nullable());

async function tenantOf(supabase: any, userId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
  if (error || !data) throw new Error("Profil introuvable");
  return data.tenant_id as string;
}

/* ------------------------------ mapping wizard ------------------------------ */

async function llmMapping(
  unresolved: string[],
  sampleRows: Record<string, unknown>[],
): Promise<Record<string, FieldKey | null>> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey || unresolved.length === 0) return {};

  const samples = unresolved.map((header) => ({
    header,
    values: sampleRows.slice(0, 3).map((r) => String(r[header] ?? "")),
  }));

  const prompt = `Tu associes des colonnes d'un fichier RH français à des champs cibles.
Champs cibles possibles: ${FIELD_KEYS.join(", ")}.
Colonnes à associer (avec exemples de valeurs): ${JSON.stringify(samples)}.
Réponds uniquement avec un objet JSON {"nom de colonne": "champ_cible_ou_null"}. Aucun texte autour.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      input: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok || !response.body) {
    console.error("[import] mapping LLM indisponible", response.status);
    return {};
  }

  let text = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
      } catch {
        /* ignore partial frames */
      }
    }
  }

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]) as Record<string, string | null>;
    const result: Record<string, FieldKey | null> = {};
    for (const header of unresolved) {
      const value = parsed[header];
      result[header] = value && (FIELD_KEYS as string[]).includes(value) ? (value as FieldKey) : null;
    }
    return result;
  } catch {
    return {};
  }
}

export const suggestMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ headers: z.array(z.string()), sampleRows: z.array(rowSchema).max(20) }).parse(data),
  )
  .handler(async ({ data }): Promise<{ suggestions: MappingSuggestion[]; fields: typeof FIELDS }> => {
    const suggestions = suggestMappingFuzzy(data.headers);
    const unresolved = suggestions.filter((s) => !s.field).map((s) => s.header);
    if (unresolved.length) {
      const taken = new Set(suggestions.map((s) => s.field).filter(Boolean) as FieldKey[]);
      const llm = await llmMapping(unresolved, data.sampleRows);
      for (const suggestion of suggestions) {
        const guess = llm[suggestion.header];
        if (guess && !taken.has(guess)) {
          taken.add(guess);
          suggestion.field = guess;
          suggestion.confidence = 0.6;
          suggestion.source = "llm";
        }
      }
    }
    return { suggestions, fields: FIELDS };
  });

/* --------------------------------- validation -------------------------------- */

export const validateImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ rows: z.array(rowSchema).max(5000), mapping: mappingSchema }).parse(data))
  .handler(async ({ data }) => {
    const results = validateRows(data.rows, data.mapping as Mapping);
    return {
      valid: results.filter((r) => r.errors.length === 0).length,
      invalid: results
        .filter((r) => r.errors.length > 0)
        .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors, raw: r.raw })),
    };
  });

/* ----------------------------------- import ---------------------------------- */

export const runImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        filename: z.string().min(1).max(255),
        fileHash: z.string().max(128).nullable().optional(),
        rows: z.array(rowSchema).max(5000),
        mapping: mappingSchema,
        importProfileId: z.string().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { commitRows } = await import("./import-engine.server");
    const tenantId = await tenantOf(context.supabase, context.userId);
    const results = validateRows(data.rows, data.mapping as Mapping);
    const valid = results.filter((r) => r.normalized).map((r) => r.normalized!);
    const invalid = results
      .filter((r) => r.errors.length > 0)
      .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors, raw: r.raw }));

    return commitRows(context.supabase, tenantId, valid, {
      filename: data.filename,
      fileHash: data.fileHash ?? null,
      importProfileId: data.importProfileId ?? null,
      source: "FILE",
      invalidRows: invalid,
    });
  });

/* ------------------------------ import profiles ------------------------------ */

export const listImportProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("import_profiles")
      .select("id, name, mapping, updated_at")
      .order("updated_at", { ascending: false });
    return data ?? [];
  });

export const saveImportProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ name: z.string().trim().min(2).max(120), mapping: mappingSchema }).parse(data))
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context.supabase, context.userId);
    const { data: existing } = await context.supabase
      .from("import_profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .ilike("name", data.name)
      .maybeSingle();

    if (existing) {
      await context.supabase.from("import_profiles").update({ mapping: data.mapping }).eq("id", existing.id);
      return { id: existing.id as string };
    }
    const { data: created, error } = await context.supabase
      .from("import_profiles")
      .insert({ tenant_id: tenantId, name: data.name, mapping: data.mapping })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: created!.id as string };
  });

/* --------------------------------- run history -------------------------------- */

export const listImportRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("import_runs")
      .select(
        "id, filename, source, status, rows_total, rows_imported, rows_skipped, rows_failed, workers_created, cases_created, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(30);
    return data ?? [];
  });

export const getRunErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ runId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("import_row_errors")
      .select("row_number, errors, raw")
      .eq("import_run_id", data.runId)
      .order("row_number");
    return rows ?? [];
  });

/* --------------------------------- dashboard --------------------------------- */

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const countOf = async (table: string, filter?: (q: any) => any) => {
      let query = (context.supabase as any).from(table).select("id", { count: "exact", head: true });
      if (filter) query = filter(query);
      const { count } = await query;
      return count ?? 0;
    };
    const [companies, workers, stoppages, openCases] = await Promise.all([
      countOf("companies"),
      countOf("workers"),
      countOf("work_stoppages"),
      countOf("cases", (q: any) => q.eq("status", "OPEN")),
    ]);
    return { companies, workers, stoppages, openCases };
  });

export const listCases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("cases")
      .select("id, status, origin, opened_at, workers(last_name, first_name), companies(name)")
      .order("opened_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

/* ----------------------------------- API keys --------------------------------- */

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("api_keys")
      .select("id, label, key_prefix, revoked, created_at, last_used_at")
      .order("created_at", { ascending: false });
    return data ?? [];
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ label: z.string().trim().min(2).max(80) }).parse(data))
  .handler(async ({ data, context }) => {
    const { sha256 } = await import("./import-core");
    const tenantId = await tenantOf(context.supabase, context.userId);
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const secret = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const key = `rpk_${secret}`;
    const { error } = await context.supabase.from("api_keys").insert({
      tenant_id: tenantId,
      label: data.label,
      key_hash: await sha256(key),
      key_prefix: key.slice(0, 12),
    });
    if (error) throw new Error(error.message);
    return { key };
  });
