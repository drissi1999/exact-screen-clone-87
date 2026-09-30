import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadDemo, resetDemo } from "./demo-seed.server";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

/** SPSTI_ADMIN only; deletes the caller's SPSTI business data (never users, roles or other SPSTIs). */
export const resetDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ confirmation: z.string().max(40) }).parse(d))
  .handler(async ({ data, context }) => resetDemo(await admin(), context.userId, data.confirmation));

/** SPSTI_ADMIN only; loads the 12 fictional situations, dated relative to today. */
export const loadDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => loadDemo(await admin(), context.userId));
