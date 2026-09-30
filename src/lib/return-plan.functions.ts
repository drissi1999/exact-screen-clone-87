import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acknowledgeAlert, completePlanTask, createPlan, getPlan, setActualReturn, updatePlan } from "./return-plan.server";

const SCENARIO = z.enum(["MEME_POSTE", "POSTE_AMENAGE", "MI_TEMPS_THERAPEUTIQUE", "ESSAI_ENCADRE", "RECLASSEMENT_INTERNE", "FORMATION_RECONVERSION"]);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;

export const getReturnPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => getPlan(await admin(), context.userId, data.caseId));

export const createReturnPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid(), targetDate: DATE, scenario: SCENARIO, notes: z.string().max(4000).optional() }).parse(d))
  .handler(async ({ data, context }) => createPlan(await admin(), context.userId, data));

export const updateReturnPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    caseId: z.string().uuid(), targetDate: DATE.optional(), scenario: SCENARIO.optional(),
    status: z.enum(["BROUILLON", "EN_COURS", "TERMINE"]).optional(), notes: z.string().max(4000).optional(),
    partners: z.array(z.object({ label: z.string().max(80), contact: z.string().max(200) })).max(10).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => updatePlan(await admin(), context.userId, data));

export const setReturnDate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid(), date: DATE }).parse(d))
  .handler(async ({ data, context }) => setActualReturn(await admin(), context.userId, data));

export const completeReturnPlanTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taskId: z.string().uuid(), documentId: z.string().uuid().nullable().optional(), outcome: z.enum(["MAINTENU", "DIFFICULTES", "RECHUTE"]).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => completePlanTask(await admin(), context.userId, data));

export const acknowledgePlanAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taskId: z.string().uuid(), note: z.string().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => acknowledgeAlert(await admin(), context.userId, data));
