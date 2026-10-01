import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const markDeadlineDoneFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid(), code: z.string().max(60), doneOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { markDeadlineDone } = await import("./deadlines.server");
    return markDeadlineDone(supabaseAdmin, context.userId, data.caseId, data.code, data.doneOn);
  });

/** Public "Demander une démo" form: stored only, no email sent. */
export const submitDemoRequest = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({
    fullName: z.string().trim().min(2).max(100),
    organisation: z.string().trim().min(2).max(150),
    email: z.string().trim().email().max(255),
    message: z.string().trim().max(1000).optional().default(""),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("demo_requests").insert({ full_name: data.fullName, organisation: data.organisation, email: data.email, message: data.message || null });
    if (error) throw new Error("Envoi impossible, réessayez");
    return { ok: true };
  });
