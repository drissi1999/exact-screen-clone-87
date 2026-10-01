import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
const srv = () => import("./visits.server");

export const listPractitionersFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => (await srv()).listPractitioners(await admin(), context.userId));

export const listCaseVisitsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await srv()).listCaseVisits(await admin(), context.userId, data.caseId));

export const bookVisitFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    caseId: z.string().uuid(), kind: z.enum(["RDV_LIAISON", "PRE_REPRISE", "VISITE_REPRISE"]), practitionerId: z.string().uuid(), scheduledAt: z.string().max(40),
  }).parse(d))
  .handler(async ({ data, context }) => (await srv()).bookVisit(await admin(), context.userId, data));

export const getVisitPrepFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ visitId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await srv()).buildVisitPrep(await admin(), context.userId, data.visitId));

export const generateVisitQuestionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ visitId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => (await srv()).generateVisitQuestions(await admin(), context.userId, data.visitId));

export const saveVisitQuestionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ visitId: z.string().uuid(), text: z.string().max(4000) }).parse(d))
  .handler(async ({ data, context }) => (await srv()).saveVisitQuestions(await admin(), context.userId, data.visitId, data.text));

export const recordVisitOutcomeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    visitId: z.string().uuid(), avisType: z.enum(["APTITUDE", "APTITUDE_AMENAGEMENTS", "INAPTITUDE"]), restrictions: z.string().max(1000).nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => (await srv()).recordVisitOutcome(await admin(), context.userId, data));
