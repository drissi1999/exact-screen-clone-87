import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildMyDay } from "./my-day.server";

/** Staff only (employers and workers are refused in assertStaff). */
export const getMyDay = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return buildMyDay(supabaseAdmin, context.userId);
  });

/** Staff only: dated deadlines and plan tasks for the next 30 days (and overdue ones). */
export const getAgenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildAgenda } = await import("./my-day.server");
    return buildAgenda(supabaseAdmin, context.userId);
  });
