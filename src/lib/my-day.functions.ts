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
