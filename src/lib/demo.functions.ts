import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadDemo, resetDemo, RESET_CONFIRMATION } from "./demo-seed.server";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

/**
 * SPSTI_ADMIN only (checked in resetDemo/loadDemo and in SQL): one-click reset + reload of the 12 situations.
 * Deletes only the caller's SPSTI business data, never users, roles or other SPSTIs.
 */
export const restartDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin();
    const removed = await resetDemo(db, context.userId, RESET_CONFIRMATION);
    const loaded = await loadDemo(db, context.userId);
    return { removedCases: removed.cases, cases: loaded.cases, situations: loaded.situations };
  });
