import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sha256, validateRows, FIELD_KEYS, type Mapping } from "@/lib/import-core";

const payloadSchema = z.object({
  source: z.string().max(120).optional(),
  stoppages: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .max(1000),
});

export const Route = createFileRoute("/api/public/ingest/stoppages")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

        const apiKey = request.headers.get("x-api-key");
        if (!apiKey) return json({ error: "Clé d'API manquante (en-tête x-api-key)" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: keyRow } = await supabaseAdmin
          .from("api_keys")
          .select("id, tenant_id, revoked")
          .eq("key_hash", await sha256(apiKey))
          .maybeSingle();
        if (!keyRow || keyRow.revoked) return json({ error: "Clé d'API invalide" }, 401);

        let parsed;
        try {
          parsed = payloadSchema.parse(await request.json());
        } catch {
          return json({ error: "Charge utile invalide" }, 400);
        }

        // The API speaks canonical field names directly.
        const mapping: Mapping = Object.fromEntries(FIELD_KEYS.map((k) => [k, k]));
        const results = validateRows(parsed.stoppages, mapping);
        const valid = results.filter((r) => r.normalized).map((r) => r.normalized!);
        const invalid = results
          .filter((r) => r.errors.length > 0)
          .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors, raw: r.raw }));

        const { commitRows } = await import("@/lib/import-engine.server");
        const counts = await commitRows(supabaseAdmin as any, keyRow.tenant_id, valid, {
          filename: parsed.source ?? "API",
          source: "API",
          invalidRows: invalid,
        });

        await supabaseAdmin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyRow.id);

        return json({
          import_run_id: counts.importRunId,
          received: parsed.stoppages.length,
          imported: counts.rowsImported,
          skipped_duplicates: counts.rowsSkipped,
          failed: counts.rowsFailed,
          cases_created: counts.casesCreated,
          errors: counts.errors.slice(0, 50),
        });
      },
    },
  },
});
