import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeDeadlines, maxConfidentiality, todayParis } from "./rules";
import { canManageRole, refusalMessage } from "./role-policy";
import { renderTemplate, type TemplateCode } from "./message-templates";

const CONF = z.enum(["MEDICAL", "PDP_SHARED", "ADMINISTRATIVE", "EMPLOYER_VISIBLE", "WORKER_VISIBLE"]);
const ROLE = z.enum(["MEDECIN_TRAVAIL", "IDEST", "PDP_COORDINATOR", "SPSTI_ADMIN", "EMPLOYER_HR", "WORKER", "EXPERT"]);

async function tenantOf(sb: any, userId: string): Promise<string> {
  const { data } = await sb.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Profil introuvable");
  return data.tenant_id;
}
async function hasRole(sb: any, role: string, userId: string): Promise<boolean> {
  const { data } = await sb.from("user_roles").select("role").eq("user_id", userId).eq("role", role).limit(1);
  return (data ?? []).length > 0;
}
async function db(): Promise<any> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}
/** Can the caller write rows of this level on this case? Decided in the database (public.can_write_case). */
async function assertCanWrite(userId: string, caseId: string, level: string) {
  const { data } = await (await db()).rpc("can_write_case", { _actor: userId, _case: caseId, _level: level });
  if (data !== true) throw new Error("Accès refusé");
}
/** Audited document read (public.staff_document writes the audit row). */
async function readDocument(userId: string, documentId: string, purpose: "READ" | "DOWNLOAD" | "AI_ANALYZE"): Promise<any> {
  const { data, error } = await (await db()).rpc("staff_document", { _actor: userId, _doc: documentId, _purpose: purpose });
  if (error || !data) throw new Error("Accès refusé");
  return data;
}
/** Append-only audit trail, written server-side only. Stores ids only, never health data. */
async function audit(_sb: any, tenantId: string, userId: string, action: string, entity: string, entityId: string | null, caseId: string | null) {
  await (await db()).from("audit_log").insert({ tenant_id: tenantId, user_id: userId, action, entity, entity_id: entityId, case_id: caseId });
}

async function callLLM(messages: unknown[], json = true): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("Service IA non configuré");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (res.status === 429) throw new Error("Trop de requêtes IA, réessayez dans un instant.");
  if (res.status === 402) throw new Error("Crédits IA épuisés.");
  if (!res.ok) throw new Error(`Erreur IA (${res.status})`);
  const body: any = await res.json();
  return String(body.choices?.[0]?.message?.content ?? "");
}

/* --------------------------------- roles --------------------------------- */

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    return { userId: context.userId, roles: (data ?? []).map((r: any) => String(r.role)) };
  });

export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      context.supabase.from("profiles").select("user_id, full_name"),
      context.supabase.from("user_roles").select("user_id, role"),
    ]);
    return (profiles ?? []).map((p: any) => ({
      userId: p.user_id as string,
      name: (p.full_name ?? "—") as string,
      roles: (roles ?? []).filter((r: any) => r.user_id === p.user_id).map((r: any) => String(r.role)),
    }));
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid(), role: ROLE, enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    const { data: mine } = await sb.from("user_roles").select("role").eq("user_id", context.userId).eq("tenant_id", tenantId);
    const myRoles = (mine ?? []).map((r: any) => String(r.role));
    if (!canManageRole(myRoles, data.role)) throw new Error(refusalMessage(data.role));
    // The database policy (private.can_manage_role) is the real gate; these calls run as the user.
    if (data.enabled) {
      const { error } = await sb.from("user_roles").insert({ user_id: data.userId, tenant_id: tenantId, role: data.role });
      if (error && !String(error.message).includes("duplicate")) throw new Error(refusalMessage(data.role));
    } else {
      const { data: gone, error } = await sb.from("user_roles").delete().eq("user_id", data.userId).eq("tenant_id", tenantId).eq("role", data.role).select("id");
      if (error || (gone ?? []).length === 0) throw new Error(refusalMessage(data.role));
    }
    await audit(sb, tenantId, context.userId, data.enabled ? "ROLE_GRANT" : "ROLE_REVOKE", "user_roles", data.userId, null);
    return { ok: true };
  });

export const getMedecinBootstrap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data } = await sb.from("tenants").select("medecin_bootstrapped_at").maybeSingle();
    return { available: !!data && !data.medecin_bootstrapped_at };
  });

/** One-time designation of the tenant's first "médecin référent" by the SPSTI admin. */
export const bootstrapMedecin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    if (!(await hasRole(sb, "SPSTI_ADMIN", context.userId))) throw new Error("Réservé à l'administrateur SPSTI.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target } = await supabaseAdmin.from("profiles").select("tenant_id").eq("user_id", data.userId).maybeSingle();
    if (target?.tenant_id !== tenantId) throw new Error("Membre introuvable dans ce SPSTI.");
    // Atomic claim: only succeeds once per tenant.
    const { data: claimed } = await (supabaseAdmin as any)
      .from("tenants").update({ medecin_bootstrapped_at: new Date().toISOString() })
      .eq("id", tenantId).is("medecin_bootstrapped_at", null).select("id");
    if (!claimed || claimed.length === 0) throw new Error("Le médecin référent a déjà été désigné.");
    const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.userId, tenant_id: tenantId, role: "MEDECIN_TRAVAIL" });
    if (error && !String(error.message).includes("duplicate")) throw new Error(error.message);
    await supabaseAdmin.from("audit_log").insert({ tenant_id: tenantId, user_id: context.userId, action: "MEDECIN_BOOTSTRAP", entity: "user_roles", entity_id: data.userId });
    return { ok: true };
  });

export const listAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("audit_log")
      .select("id, user_id, action, entity, entity_id, case_id, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    return (data ?? []).map((r: any) => ({ ...r, id: String(r.id) }));
  });

/* ------------------------------- case detail ------------------------------ */

export const getCaseDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: c } = await sb
      .from("cases")
      .select("id, status, origin, opened_at, closed_at, worker_id, workers(last_name, first_name, job_title, email, phone), companies(name, siret)")
      .eq("id", data.caseId)
      .maybeSingle();
    if (!c) throw new Error("Dossier introuvable");
    const [st, items, tasks] = await Promise.all([
      sb.from("work_stoppages").select("start_date, end_date, origin, kind").eq("worker_id", c.worker_id).order("start_date"),
      // Documents, events and drafts at every level the caller may read; MEDICAL reads are audited in the database.
      db().then((a) => a.rpc("staff_case_items", { _actor: context.userId, _case: c.id })),
      sb.from("coordination_tasks").select("id, recipient, channel, purpose, message, status, due_at, sent_at, escalated_reason").eq("case_id", c.id).order("created_at", { ascending: false }),
    ]);
    if (items.error) throw new Error("Accès refusé");
    const stoppages = st.data ?? [];
    const docs = { data: items.data.documents }, ev = { data: items.data.events }, dr = { data: items.data.drafts };

    return {
      case: {
        id: c.id as string,
        status: c.status as string,
        origin: (c.origin ?? null) as string | null,
        openedAt: c.opened_at as string,
        worker: `${c.workers?.last_name ?? ""} ${c.workers?.first_name ?? ""}`.trim(),
        jobTitle: (c.workers?.job_title ?? null) as string | null,
        company: (c.companies?.name ?? "") as string,
      },
      stoppages: stoppages as { start_date: string; end_date: string | null; origin: string; kind: string }[],
      deadlines: computeDeadlines(stoppages, c.origin),
      documents: (docs.data ?? []) as any[],
      events: (ev.data ?? []) as any[],
      drafts: (dr.data ?? []) as any[],
      tasks: (tasks.data ?? []) as any[],
    };
  });

/* -------------------------------- documents ------------------------------- */

export const registerDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ caseId: z.string().uuid(), filename: z.string().max(255), storagePath: z.string().max(500), mimeType: z.string().max(120), confidentiality: CONF }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    if (!data.storagePath.startsWith(`${tenantId}/${data.caseId}/`)) throw new Error("Chemin invalide");
    await assertCanWrite(context.userId, data.caseId, data.confidentiality);
    const { data: row, error } = await (await db())
      .from("documents")
      .insert({ tenant_id: tenantId, case_id: data.caseId, filename: data.filename, storage_path: data.storagePath, mime_type: data.mimeType, confidentiality: data.confidentiality, uploaded_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(sb, tenantId, context.userId, "CREATE", "documents", row.id, data.caseId);
    return { id: row.id as string };
  });

const DOC_TYPES = ["ARRET_TRAVAIL", "CERTIFICAT_MEDICAL", "COMPTE_RENDU", "COURRIER_EMPLOYEUR", "FICHE_POSTE", "AVIS_APTITUDE", "DECLARATION_AT", "AUTRE"];

export const analyzeDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    const doc = await readDocument(context.userId, data.documentId, "AI_ANALYZE");
    await assertCanWrite(context.userId, doc.case_id, doc.confidentiality);
    const admin = await db();
    const { data: blob, error } = await admin.storage.from("case-documents").download(doc.storage_path);
    if (error || !blob) throw new Error("Fichier illisible");
    const buf = new Uint8Array(await blob.arrayBuffer());
    const mime = doc.mime_type || "application/octet-stream";
    let part: any;
    if (mime.startsWith("text/")) {
      part = { type: "text", text: `Contenu du fichier:\n${new TextDecoder("utf-8").decode(buf).slice(0, 60000)}` };
    } else {
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const url = `data:${mime};base64,${btoa(bin)}`;
      part = mime.startsWith("image/") ? { type: "image_url", image_url: { url } } : { type: "file", file: { filename: doc.filename, file_data: url } };
    }
    const prompt = `Tu es un assistant d'un service de prévention et de santé au travail. Lis ce document (OCR si besoin, en français).
Réponds en JSON strict: {"doc_type": un parmi ${JSON.stringify(DOC_TYPES)}, "page_count": nombre, "text": transcription brute (max 8000 caractères), "events": [{"date": "YYYY-MM-DD" ou null, "label": fait court et factuel, "page": numéro de page}]}.
Règles: n'invente rien; si une date est incertaine mets null; aucun conseil médical; les faits doivent provenir du document.`;
    await admin.from("documents").update({ analysis_status: "RUNNING" }).eq("id", doc.id);
    let parsed: any;
    try {
      const raw = await callLLM([{ role: "user", content: [{ type: "text", text: prompt }, part] }]);
      parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
    } catch (e) {
      await admin.from("documents").update({ analysis_status: "FAILED" }).eq("id", doc.id);
      throw e instanceof Error ? e : new Error("Analyse impossible");
    }
    const docType = DOC_TYPES.includes(parsed.doc_type) ? parsed.doc_type : "AUTRE";
    await admin
      .from("documents")
      .update({ doc_type: docType, page_count: Number(parsed.page_count) || null, extracted_text: String(parsed.text ?? "").slice(0, 20000), analysis_status: "DONE" })
      .eq("id", doc.id);
    const events = (Array.isArray(parsed.events) ? parsed.events : []).slice(0, 60).map((e: any) => ({
      tenant_id: tenantId,
      case_id: doc.case_id,
      event_date: /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) ? e.date : null,
      label: String(e.label ?? "").slice(0, 500) || "à vérifier",
      source_document_id: doc.id,
      source_page: Number(e.page) || null,
      confidentiality: doc.confidentiality,
    }));
    if (events.length) await admin.from("case_events").insert(events);
    return { docType, events: events.length };
  });

export const getDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const doc = await readDocument(context.userId, data.documentId, "DOWNLOAD");
    const { data: signed } = await (await db()).storage.from("case-documents").createSignedUrl(doc.storage_path, 120);
    return { url: (signed?.signedUrl ?? "") as string };
  });

export const reviewEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ eventId: z.string().uuid(), status: z.enum(["APPROVED", "REJECTED"]) }).parse(d))
  .handler(async ({ data, context }) => {
    // Role check, update and audit happen together in public.review_event.
    const { error } = await (await db()).rpc("review_event", { _event: data.eventId, _actor: context.userId, _status: data.status });
    if (error) throw new Error(error.message.includes("role") ? "Vous n'avez pas le rôle requis pour valider ce fait" : "Événement introuvable");
    return { ok: true };
  });

/* --------------------------------- drafts --------------------------------- */

export const generateSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    const { data: items, error: itemsErr } = await (await db()).rpc("staff_case_items", { _actor: context.userId, _case: data.caseId });
    if (itemsErr) throw new Error("Accès refusé");
    const events = (items.events as any[]).filter((e) => e.status !== "REJECTED").map((e) => ({ ...e, documents: { filename: e.source_filename } }));
    if (!events?.length) throw new Error("Aucun fait dans la chronologie. Analysez d'abord des documents.");
    const conf = maxConfidentiality(events.map((e: any) => e.confidentiality));
    const facts = events.map((e: any, i: number) => `${i + 1}. ${e.event_date ?? "date à vérifier"} — ${e.label} [source: ${e.documents?.filename ?? "?"}, p.${e.source_page ?? "?"}]${e.status === "DRAFT" ? " (non validé)" : ""}`).join("\n");
    const text = await callLLM(
      [
        { role: "system", content: "Tu rédiges des synthèses de dossiers de maintien en emploi pour un médecin du travail. Français, factuel, concis. Chaque fait cite sa source entre crochets [fichier, p.X]. Si une information manque ou est incertaine, écris « à vérifier ». Aucun conseil médical, aucun diagnostic nouveau." },
        { role: "user", content: `Faits sourcés:\n${facts}\n\nRédige une synthèse structurée (Contexte, Chronologie clé, Points à vérifier).` },
      ],
      false,
    );
    await assertCanWrite(context.userId, data.caseId, conf);
    const { data: row } = await (await db())
      .from("ai_drafts")
      .insert({ tenant_id: tenantId, case_id: data.caseId, kind: "SYNTHESE", confidentiality: conf, draft_text: text, required_role: conf === "MEDICAL" ? "MEDECIN_TRAVAIL" : "PDP_COORDINATOR", created_by: context.userId })
      .select("id")
      .single();
    await audit(sb, tenantId, context.userId, "AI_DRAFT", "ai_drafts", row?.id ?? null, data.caseId);
    return { ok: true };
  });

/** Employer-facing notice: template-only, never receives medical fields. */
export const generateEmployerNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    const { data: c } = await sb.from("cases").select("worker_id, workers(last_name, first_name, job_title), companies(name)").eq("id", data.caseId).maybeSingle();
    if (!c) throw new Error("Dossier introuvable");
    const { data: st } = await sb.from("work_stoppages").select("start_date, end_date").eq("worker_id", c.worker_id).order("start_date");
    const last = st?.at(-1);
    const fr = (s?: string | null) => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString("fr-FR") : "à préciser");
    const text = `Objet : Accompagnement du retour à l'emploi de ${c.workers?.first_name} ${c.workers?.last_name}

Madame, Monsieur,

Le service de prévention et de santé au travail accompagne ${c.workers?.first_name} ${c.workers?.last_name}${c.workers?.job_title ? `, ${c.workers.job_title},` : ""} dans la préparation de son retour au sein de ${c.companies?.name}.
Période d'absence connue : du ${fr(st?.[0]?.start_date)} au ${fr(last?.end_date)}.

Afin de préparer au mieux cette reprise, nous vous proposons un échange avec la cellule de prévention de la désinsertion professionnelle, notamment pour étudier d'éventuels aménagements de poste. Aucune information médicale ne vous est communiquée, conformément au secret médical.

Nous restons à votre disposition.

Le service de prévention et de santé au travail`;
    await assertCanWrite(context.userId, data.caseId, "EMPLOYER_VISIBLE");
    const { data: row } = await (await db())
      .from("ai_drafts")
      .insert({ tenant_id: tenantId, case_id: data.caseId, kind: "COURRIER_EMPLOYEUR", confidentiality: "EMPLOYER_VISIBLE", draft_text: text, required_role: "MEDECIN_TRAVAIL", created_by: context.userId })
      .select("id")
      .single();
    await audit(sb, tenantId, context.userId, "DRAFT_TEMPLATE", "ai_drafts", row?.id ?? null, data.caseId);
    return { ok: true };
  });

export const reviewDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ draftId: z.string().uuid(), status: z.enum(["APPROVED", "REJECTED"]), text: z.string().max(20000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    // Role check (required_role in the draft's tenant), update and audit happen together in public.review_draft.
    const { error } = await (await db()).rpc("review_draft", { _draft: data.draftId, _actor: context.userId, _status: data.status, _text: data.text ?? null });
    if (error) throw new Error(error.message.includes("role") ? "Vous n'avez pas le rôle requis pour valider ce document" : "Brouillon introuvable");
    return { ok: true };
  });

/* ------------------------------ coordination ------------------------------ */

export const planCoordination = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    const { data: c } = await sb.from("cases").select("worker_id, origin, workers(first_name), companies(name)").eq("id", data.caseId).maybeSingle();
    if (!c) throw new Error("Dossier introuvable");
    const [{ data: st }, { data: docs }, { data: existing }] = await Promise.all([
      sb.from("work_stoppages").select("start_date, end_date, origin, kind").eq("worker_id", c.worker_id),
      db().then((a) => a.from("documents").select("doc_type").eq("case_id", data.caseId).eq("tenant_id", tenantId)), // types only, no content
      sb.from("coordination_tasks").select("purpose").eq("case_id", data.caseId).in("status", ["PENDING", "SENT"]),
    ]);
    const have = new Set((docs ?? []).map((d: any) => d.doc_type));
    const already = new Set((existing ?? []).map((t: any) => t.purpose));
    const today = todayParis();
    const tasks: any[] = [];
    const addT = (code: TemplateCode, due: string | null) => {
      if (!already.has(code)) tasks.push({ tenant_id: tenantId, case_id: data.caseId, purpose: code, due_at: due, ...renderTemplate(code, { firstName: c.workers?.first_name ?? "", due }) });
    };
    if (!have.has("ARRET_TRAVAIL")) addT("DOC_ARRET", today);
    if (!have.has("FICHE_POSTE")) addT("DOC_FICHE_POSTE", today);
    if (c.origin === "AT" && !have.has("DECLARATION_AT")) addT("DOC_DAT", today);
    for (const d of computeDeadlines(st ?? [], c.origin)) {
      if (d.code === "PRE_REPRISE" && d.status === "EN_COURS") addT("RDV_PRE_REPRISE", d.due);
      if (d.code === "VISITE_REPRISE" && d.due) addT("RDV_REPRISE", d.due);
      if (d.status === "DEPASSEE" && !already.has(`ESC_${d.code}`))
        tasks.push({ tenant_id: tenantId, case_id: data.caseId, purpose: `ESC_${d.code}`, recipient: "PDP_COORDINATOR", channel: "INTERNE", message: `Échéance dépassée : ${d.label}. Intervention humaine requise.`, due_at: d.due });
    }
    if (tasks.length) {
      const { error } = await (await db()).from("coordination_tasks").insert(tasks);
      if (error) throw new Error(error.message);
    }
    await audit(sb, tenantId, context.userId, "COORD_PLAN", "coordination_tasks", null, data.caseId);
    return { created: tasks.length };
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taskId: z.string().uuid(), action: z.enum(["SEND", "ESCALATE", "DONE"]), reason: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const patch =
      data.action === "SEND"
        ? { status: "SENT", sent_at: new Date().toISOString() }
        : data.action === "ESCALATE"
          ? { status: "ESCALATED", escalated_reason: data.reason ?? "Escalade manuelle" }
          : { status: "DONE" };
    // RLS read proves the task is in the caller's tenant; the write itself goes through the admin client.
    const { data: own } = await sb.from("coordination_tasks").select("id, case_id").eq("id", data.taskId).maybeSingle();
    if (!own) throw new Error("Tâche introuvable");
    await assertCanWrite(context.userId, own.case_id, "ADMINISTRATIVE");
    const { data: t } = await (await db()).from("coordination_tasks").update(patch).eq("id", own.id).select("id, case_id, recipient, channel, message, purpose, tenant_id").single();
    if (t && data.action === "SEND") {
      const { data: c } = await sb.from("cases").select("workers(first_name, last_name, email, phone), companies(name)").eq("id", t.case_id).maybeSingle();
      const toWorker = t.recipient === "WORKER";
      await sb.from("simulated_messages").insert({
        tenant_id: t.tenant_id,
        case_id: t.case_id,
        recipient_label: toWorker ? `Salarié — ${c?.workers?.first_name ?? ""} ${c?.workers?.last_name ?? ""}` : t.recipient === "EMPLOYER_HR" ? `RH — ${c?.companies?.name ?? ""}` : "Cellule PDP",
        to_address: toWorker ? (t.channel === "SMS" ? c?.workers?.phone : c?.workers?.email) ?? "coordonnées manquantes" : null,
        channel: t.channel,
        subject: t.purpose,
        body: t.message,
        sent_by: context.userId,
      });
    }
    await audit(sb, await tenantOf(sb, context.userId), context.userId, `TASK_${data.action}`, "coordination_tasks", t?.id ?? null, t?.case_id ?? null);
    return { ok: true };
  });

/* --------------------------- confidentiality --------------------------- */

/** Lowering a level: MEDECIN_TRAVAIL only, checked and logged in public.lower_document_confidentiality. */
export const lowerDocumentConfidentiality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ documentId: z.string().uuid(), level: CONF }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (await db()).rpc("lower_document_confidentiality", { _actor: context.userId, _doc: data.documentId, _level: data.level });
    if (error) throw new Error(error.message.includes("role") ? "Seul le médecin du travail peut abaisser la confidentialité" : "Changement refusé");
    return { ok: true };
  });
