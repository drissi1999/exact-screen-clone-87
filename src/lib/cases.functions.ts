import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeDeadlines, maxConfidentiality, todayParis } from "./rules";

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
/** Append-only audit trail. Stores ids only, never health data. */
async function audit(sb: any, tenantId: string, userId: string, action: string, entity: string, entityId: string | null, caseId: string | null) {
  await sb.from("audit_log").insert({ tenant_id: tenantId, user_id: userId, action, entity, entity_id: entityId, case_id: caseId });
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
    if (!(await hasRole(sb, "SPSTI_ADMIN", context.userId))) throw new Error("Réservé à l'administrateur SPSTI");
    const tenantId = await tenantOf(sb, context.userId);
    if (data.enabled) {
      const { error } = await sb.from("user_roles").insert({ user_id: data.userId, tenant_id: tenantId, role: data.role });
      if (error && !String(error.message).includes("duplicate")) throw new Error(error.message);
    } else {
      await sb.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
    }
    await audit(sb, tenantId, context.userId, data.enabled ? "ROLE_GRANT" : "ROLE_REVOKE", "user_roles", data.userId, null);
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
    const [st, docs, ev, dr, tasks] = await Promise.all([
      sb.from("work_stoppages").select("start_date, end_date, origin, kind").eq("worker_id", c.worker_id).order("start_date"),
      sb.from("documents").select("id, filename, doc_type, confidentiality, page_count, analysis_status, created_at").eq("case_id", c.id).order("created_at", { ascending: false }),
      sb.from("case_events").select("id, event_date, label, source_document_id, source_page, confidentiality, status").eq("case_id", c.id).order("event_date", { ascending: true, nullsFirst: false }),
      sb.from("ai_drafts").select("id, kind, confidentiality, draft_text, approved_text, status, required_role, approved_at, created_at").eq("case_id", c.id).order("created_at", { ascending: false }),
      sb.from("coordination_tasks").select("id, recipient, channel, purpose, message, status, due_at, sent_at, escalated_reason").eq("case_id", c.id).order("created_at", { ascending: false }),
    ]);
    const stoppages = st.data ?? [];
    const tenantId = await tenantOf(sb, context.userId);
    const medicalDocs = (docs.data ?? []).filter((d: any) => d.confidentiality === "MEDICAL");
    for (const d of medicalDocs) await audit(sb, tenantId, context.userId, "READ", "documents", d.id, c.id);
    if ((ev.data ?? []).some((e: any) => e.confidentiality === "MEDICAL"))
      await audit(sb, tenantId, context.userId, "READ", "case_events", null, c.id);
    for (const d of (dr.data ?? []).filter((x: any) => x.confidentiality === "MEDICAL"))
      await audit(sb, tenantId, context.userId, "READ", "ai_drafts", d.id, c.id);

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
    if (!data.storagePath.startsWith(`${tenantId}/`)) throw new Error("Chemin invalide");
    const { data: row, error } = await sb
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
    const { data: doc } = await sb.from("documents").select("*").eq("id", data.documentId).maybeSingle();
    if (!doc) throw new Error("Document introuvable");
    const { data: blob, error } = await sb.storage.from("case-documents").download(doc.storage_path);
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
    await sb.from("documents").update({ analysis_status: "RUNNING" }).eq("id", doc.id);
    let parsed: any;
    try {
      const raw = await callLLM([{ role: "user", content: [{ type: "text", text: prompt }, part] }]);
      parsed = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
    } catch (e) {
      await sb.from("documents").update({ analysis_status: "FAILED" }).eq("id", doc.id);
      throw e instanceof Error ? e : new Error("Analyse impossible");
    }
    const docType = DOC_TYPES.includes(parsed.doc_type) ? parsed.doc_type : "AUTRE";
    await sb
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
    if (events.length) await sb.from("case_events").insert(events);
    await audit(sb, tenantId, context.userId, "AI_ANALYZE", "documents", doc.id, doc.case_id);
    return { docType, events: events.length };
  });

export const getDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: doc } = await sb.from("documents").select("id, case_id, storage_path, confidentiality").eq("id", data.documentId).maybeSingle();
    if (!doc) throw new Error("Accès refusé");
    const { data: signed } = await sb.storage.from("case-documents").createSignedUrl(doc.storage_path, 120);
    await audit(sb, await tenantOf(sb, context.userId), context.userId, "DOWNLOAD", "documents", doc.id, doc.case_id);
    return { url: (signed?.signedUrl ?? "") as string };
  });

export const reviewEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ eventId: z.string().uuid(), status: z.enum(["APPROVED", "REJECTED"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: ev } = await sb.from("case_events").select("id, case_id, confidentiality").eq("id", data.eventId).maybeSingle();
    if (!ev) throw new Error("Événement introuvable");
    if (ev.confidentiality === "MEDICAL" && !(await hasRole(sb, "MEDECIN_TRAVAIL", context.userId)) && !(await hasRole(sb, "IDEST", context.userId)))
      throw new Error("Validation réservée au médecin du travail ou à l'IDEST");
    await sb.from("case_events").update({ status: data.status, reviewed_by: context.userId, reviewed_at: new Date().toISOString() }).eq("id", ev.id);
    await audit(sb, await tenantOf(sb, context.userId), context.userId, `EVENT_${data.status}`, "case_events", ev.id, ev.case_id);
    return { ok: true };
  });

/* --------------------------------- drafts --------------------------------- */

export const generateSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const tenantId = await tenantOf(sb, context.userId);
    const { data: events } = await sb
      .from("case_events")
      .select("event_date, label, source_page, confidentiality, status, documents(filename)")
      .eq("case_id", data.caseId)
      .neq("status", "REJECTED")
      .order("event_date");
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
    const { data: row } = await sb
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
    const { data: row } = await sb
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
    const sb = context.supabase as any;
    const { data: dr } = await sb.from("ai_drafts").select("id, case_id, required_role, draft_text").eq("id", data.draftId).maybeSingle();
    if (!dr) throw new Error("Brouillon introuvable");
    if (!(await hasRole(sb, dr.required_role, context.userId))) throw new Error("Vous n'avez pas le rôle requis pour valider ce document");
    await sb
      .from("ai_drafts")
      .update({ status: data.status, approved_text: data.status === "APPROVED" ? (data.text ?? dr.draft_text) : null, approved_by: context.userId, approved_at: new Date().toISOString() })
      .eq("id", dr.id);
    await audit(sb, await tenantOf(sb, context.userId), context.userId, `DRAFT_${data.status}`, "ai_drafts", dr.id, dr.case_id);
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
      sb.from("documents").select("doc_type").eq("case_id", data.caseId),
      sb.from("coordination_tasks").select("purpose").eq("case_id", data.caseId).in("status", ["PENDING", "SENT"]),
    ]);
    const have = new Set((docs ?? []).map((d: any) => d.doc_type));
    const already = new Set((existing ?? []).map((t: any) => t.purpose));
    const today = todayParis();
    const tasks: any[] = [];
    const add = (purpose: string, recipient: string, channel: string, message: string, due: string | null) => {
      if (!already.has(purpose)) tasks.push({ tenant_id: tenantId, case_id: data.caseId, purpose, recipient, channel, message, due_at: due });
    };
    const name = c.workers?.first_name ?? "";
    if (!have.has("ARRET_TRAVAIL"))
      add("DOC_ARRET", "WORKER", "SMS", `Bonjour ${name}, votre service de santé au travail vous accompagne. Pourriez-vous nous transmettre une copie de votre dernier arrêt de travail via le lien sécurisé ? Merci.`, today);
    if (!have.has("FICHE_POSTE"))
      add("DOC_FICHE_POSTE", "EMPLOYER_HR", "EMAIL", `Bonjour, dans le cadre de l'accompagnement d'un de vos salariés, pourriez-vous nous transmettre sa fiche de poste à jour ? Cordialement, le service de prévention et de santé au travail.`, today);
    if (c.origin === "AT" && !have.has("DECLARATION_AT"))
      add("DOC_DAT", "EMPLOYER_HR", "EMAIL", `Bonjour, merci de nous transmettre une copie de la déclaration d'accident du travail concernant votre salarié. Cordialement.`, today);
    for (const d of computeDeadlines(st ?? [], c.origin)) {
      if (d.code === "PRE_REPRISE" && d.status === "EN_COURS")
        add("RDV_PRE_REPRISE", "WORKER", "SMS", `Bonjour ${name}, vous pouvez bénéficier d'une visite de pré-reprise avec le médecin du travail pour préparer votre retour. Répondez OUI pour être rappelé(e) et choisir un créneau.`, d.due);
      if (d.code === "VISITE_REPRISE" && d.due)
        add("RDV_REPRISE", "EMPLOYER_HR", "EMAIL", `Bonjour, la visite de reprise de votre salarié doit être organisée au plus tard le ${new Date(`${d.due}T12:00:00Z`).toLocaleDateString("fr-FR")}. Merci de nous confirmer sa date de reprise.`, d.due);
      if (d.status === "DEPASSEE")
        add(`ESC_${d.code}`, "PDP_COORDINATOR", "INTERNE", `Échéance dépassée : ${d.label}. Intervention humaine requise.`, d.due);
    }
    if (tasks.length) await sb.from("coordination_tasks").insert(tasks);
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
    const { data: t } = await sb.from("coordination_tasks").update(patch).eq("id", data.taskId).select("id, case_id, recipient, channel, message, purpose, tenant_id").single();
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
