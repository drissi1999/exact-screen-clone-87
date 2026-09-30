import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeDeadlines } from "./rules";
import { genericDocTitle } from "./message-templates";

const EMPLOYER_DEADLINES = new Set(["DECLARATION_AT", "RDV_LIAISON", "VISITE_REPRISE"]);
const WORKER_DEADLINES = new Set(["RDV_LIAISON", "PRE_REPRISE", "VISITE_REPRISE"]);
const MAX_UPLOAD = 5 * 1024 * 1024;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}
async function myRoles(sb: any, userId: string): Promise<string[]> {
  const { data } = await sb.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r: any) => String(r.role));
}
async function myProfile(sb: any, userId: string) {
  const { data } = await sb.from("profiles").select("tenant_id, company_id, full_name").eq("user_id", userId).maybeSingle();
  if (!data) throw new Error("Profil introuvable");
  return data as { tenant_id: string; company_id: string | null; full_name: string | null };
}
/** Audit rows are written with the admin client only; clients have no insert right. */
async function audit(_db: any, row: { tenant_id: string; user_id: string; action: string; entity: string; entity_id?: string | null; case_id?: string | null }) {
  await (await admin()).from("audit_log").insert({ entity_id: null, case_id: null, ...row });
}
function decodeBase64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const originSchema = z.string().url().max(200);

/* ------------------------------ staff side ------------------------------ */

export const listCompaniesWithInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const [{ data: companies }, { data: invites }] = await Promise.all([
      sb.from("companies").select("id, name, siret").order("name"),
      sb.from("employer_invitations").select("id, company_id, email, expires_at, accepted_at, created_at").order("created_at", { ascending: false }),
    ]);
    return {
      isAdmin: (await myRoles(sb, context.userId)).includes("SPSTI_ADMIN"),
      companies: (companies ?? []).map((c: any) => ({
        ...c,
        invites: (invites ?? []).filter((i: any) => i.company_id === c.id),
      })) as any[],
    };
  });

export const inviteEmployer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ companyId: z.string().uuid(), email: z.string().trim().email().max(200), fullName: z.string().trim().max(120).optional(), origin: originSchema }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    if (!(await myRoles(sb, context.userId)).includes("SPSTI_ADMIN")) throw new Error("Réservé à l'administrateur SPSTI");
    const { data: company } = await sb.from("companies").select("id, name, tenant_id").eq("id", data.companyId).maybeSingle();
    if (!company) throw new Error("Entreprise introuvable");
    const token = randomToken();
    const db = await admin();
    const { error } = await db.from("employer_invitations").insert({
      tenant_id: company.tenant_id,
      company_id: company.id,
      email: data.email.toLowerCase(),
      full_name: data.fullName || null,
      token_hash: await sha256(token),
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      invited_by: context.userId,
    });
    if (error) throw new Error(error.message);
    const link = `${new URL(data.origin).origin}/invitation/${token}`;
    await sb.from("simulated_messages").insert({
      tenant_id: company.tenant_id,
      recipient_label: `RH — ${company.name}`,
      to_address: data.email,
      channel: "EMAIL",
      subject: "Invitation à l'espace employeur Reprise",
      body: `Bonjour,\n\nVotre service de prévention et de santé au travail vous invite à rejoindre l'espace employeur de ${company.name}.\nCréez votre mot de passe ici (valable 7 jours) : ${link}\n\nCordialement.`,
      sent_by: context.userId,
    });
    await audit(sb, { tenant_id: company.tenant_id, user_id: context.userId, action: "EMPLOYER_INVITE", entity: "companies", entity_id: company.id });
    return { link };
  });

export const createWorkerLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid(), origin: originSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    const { data: c } = await sb.from("cases").select("id, tenant_id, workers(first_name, last_name, phone)").eq("id", data.caseId).maybeSingle();
    if (!c) throw new Error("Dossier introuvable");
    const token = randomToken();
    const db = await admin();
    await db.from("worker_links").insert({
      tenant_id: c.tenant_id,
      case_id: c.id,
      token_hash: await sha256(token),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      created_by: context.userId,
    });
    const link = `${new URL(data.origin).origin}/salarie/${token}`;
    await sb.from("simulated_messages").insert({
      tenant_id: c.tenant_id,
      case_id: c.id,
      recipient_label: `Salarié — ${c.workers?.first_name ?? ""} ${c.workers?.last_name ?? ""}`,
      to_address: c.workers?.phone ?? "téléphone manquant",
      channel: "SMS",
      subject: "Lien d'accès salarié",
      body: `Bonjour ${c.workers?.first_name ?? ""}, votre service de santé au travail vous donne accès à votre espace : ${link} (lien à usage unique, valable 15 minutes).`,
      sent_by: context.userId,
    });
    await audit(sb, { tenant_id: c.tenant_id, user_id: context.userId, action: "WORKER_LINK", entity: "cases", entity_id: c.id, case_id: c.id });
    return { link };
  });

export const listSimulatedMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("simulated_messages")
      .select("id, case_id, recipient_label, to_address, channel, subject, body, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    return (data ?? []) as any[];
  });

/** Admin-only: opens the real worker portal for a case, without sending a simulated SMS. */
export const adminWorkerPreviewLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    if (!(await myRoles(sb, context.userId)).includes("SPSTI_ADMIN")) throw new Error("Réservé à l'administrateur SPSTI");
    const { data: c } = await sb.from("cases").select("id, tenant_id").eq("id", data.caseId).maybeSingle();
    if (!c) throw new Error("Dossier introuvable");
    const token = randomToken();
    const db = await admin();
    await db.from("worker_links").insert({
      tenant_id: c.tenant_id,
      case_id: c.id,
      token_hash: await sha256(token),
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      created_by: context.userId,
    });
    await audit(sb, { tenant_id: c.tenant_id, user_id: context.userId, action: "PREVIEW_WORKER", entity: "cases", entity_id: c.id, case_id: c.id });
    return { path: `/salarie/${token}` };
  });

/* --------------------------- employer invitation --------------------------- */

export const getInvitation = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: inv } = await db
      .from("employer_invitations")
      .select("email, expires_at, accepted_at, companies(name)")
      .eq("token_hash", await sha256(data.token))
      .maybeSingle();
    if (!inv || inv.accepted_at || new Date(inv.expires_at) < new Date()) return { valid: false as const, email: "", company: "" };
    return { valid: true as const, email: inv.email as string, company: (inv.companies?.name ?? "") as string };
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string().min(10).max(72) }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const { data: inv } = await db
      .from("employer_invitations")
      .select("id, email, expires_at, accepted_at")
      .eq("token_hash", await sha256(data.token))
      .maybeSingle();
    if (!inv || inv.accepted_at || new Date(inv.expires_at) < new Date()) throw new Error("Invitation invalide ou expirée");
    const { data: created, error } = await db.auth.admin.createUser({
      email: inv.email,
      password: data.password,
      email_confirm: true,
      app_metadata: { invite_id: inv.id },
    });
    if (error || !created?.user) throw new Error(error?.message.includes("already") ? "Un compte existe déjà pour cette adresse" : "Création du compte impossible");
    // The signup trigger may have created a personal workspace: move the user into the inviting tenant as employer only.
    const uid = created.user.id;
    const { data: full } = await db.from("employer_invitations").select("tenant_id, company_id, full_name").eq("id", inv.id).single();
    const { data: prof } = await db.from("profiles").select("tenant_id").eq("user_id", uid).maybeSingle();
    await db.from("user_roles").delete().eq("user_id", uid);
    if (prof) {
      await db.from("profiles").update({ tenant_id: full.tenant_id, company_id: full.company_id, full_name: full.full_name ?? inv.email }).eq("user_id", uid);
      if (prof.tenant_id !== full.tenant_id) await db.from("tenants").delete().eq("id", prof.tenant_id);
    } else {
      await db.from("profiles").insert({ user_id: uid, tenant_id: full.tenant_id, company_id: full.company_id, full_name: full.full_name ?? inv.email });
    }
    await db.from("user_roles").insert({ user_id: uid, tenant_id: full.tenant_id, role: "EMPLOYER_HR" });
    await db.from("employer_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
    return { email: inv.email as string };
  });

/* ------------------------------ employer portal ------------------------------ */

async function employerContext(sb: any, userId: string) {
  if (!(await myRoles(sb, userId)).includes("EMPLOYER_HR")) throw new Error("Accès réservé aux employeurs");
  const p = await myProfile(sb, userId);
  if (!p.company_id) throw new Error("Aucune entreprise associée");
  return { tenantId: p.tenant_id, companyId: p.company_id };
}

/** Admin-only "view as": resolves a company of the admin's own tenant (RLS-scoped lookup). */
async function adminPreviewContext(sb: any, userId: string, companyId: string) {
  if (!(await myRoles(sb, userId)).includes("SPSTI_ADMIN")) throw new Error("Réservé à l'administrateur SPSTI");
  const { data: c } = await sb.from("companies").select("id, tenant_id").eq("id", companyId).maybeSingle();
  if (!c) throw new Error("Entreprise introuvable");
  return { tenantId: c.tenant_id as string, companyId: c.id as string };
}

export const getEmployerPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ asCompanyId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data: input, context }) => {
    const { tenantId, companyId } = input.asCompanyId
      ? await adminPreviewContext(context.supabase, context.userId, input.asCompanyId)
      : await employerContext(context.supabase, context.userId);
    const db = await admin();
    if (input.asCompanyId) await audit(db, { tenant_id: tenantId, user_id: context.userId, action: "PREVIEW_EMPLOYER", entity: "companies", entity_id: companyId });
    const { data: company } = await db.from("companies").select("name").eq("id", companyId).single();
    // Explicit column whitelist: never select origin, diagnosis or medical fields.
    const { data: cases } = await db
      .from("cases")
      .select("id, status, opened_at, closed_at, origin, worker_id, workers(first_name, last_name, job_title)")
      .eq("tenant_id", tenantId)
      .eq("company_id", companyId)
      .order("opened_at", { ascending: false });
    const ids = (cases ?? []).map((c: any) => c.id);
    const workerIds = (cases ?? []).map((c: any) => c.worker_id);
    const [st, docs, drafts, tasks] = await Promise.all([
      db.from("work_stoppages").select("worker_id, start_date, end_date, origin, kind").in("worker_id", workerIds.length ? workerIds : ["00000000-0000-0000-0000-000000000000"]),
      db.from("documents").select("id, case_id, doc_type, created_at").in("case_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("confidentiality", "EMPLOYER_VISIBLE"),
      db.from("ai_drafts").select("id, case_id, kind, approved_text, approved_at").in("case_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("confidentiality", "EMPLOYER_VISIBLE").eq("status", "APPROVED"),
      db.from("coordination_tasks").select("id, case_id, message, status, due_at").in("case_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).eq("recipient", "EMPLOYER_HR").in("status", ["SENT", "DONE"]),
    ]);
    return {
      company: company?.name as string,
      cases: (cases ?? []).map((c: any) => {
        const stops = (st.data ?? []).filter((s: any) => s.worker_id === c.worker_id);
        return {
          id: c.id as string,
          status: c.status as string,
          openedAt: c.opened_at as string,
          worker: `${c.workers?.first_name ?? ""} ${c.workers?.last_name ?? ""}`.trim(),
          jobTitle: (c.workers?.job_title ?? null) as string | null,
          periods: stops.map((s: any) => ({ start: s.start_date as string, end: (s.end_date ?? null) as string | null })),
          deadlines: computeDeadlines(stops, c.origin)
            .filter((d) => EMPLOYER_DEADLINES.has(d.code))
            .map((d) => ({ code: d.code, label: d.label, legalRef: d.legalRef, due: d.due, status: d.status })),
          documents: (docs.data ?? []).filter((d: any) => d.case_id === c.id).map((d: any) => ({ id: d.id as string, title: genericDocTitle(d.doc_type), createdAt: d.created_at as string })),
          letters: (drafts.data ?? []).filter((d: any) => d.case_id === c.id).map((d: any) => ({ id: d.id as string, text: d.approved_text as string, approvedAt: d.approved_at as string })),
          tasks: (tasks.data ?? []).filter((t: any) => t.case_id === c.id).map((t: any) => ({ id: t.id as string, message: t.message as string, status: t.status as string, due: (t.due_at ?? null) as string | null })),
        };
      }),
    };
  });

export const getEmployerDocUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ documentId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { tenantId, companyId } = await employerContext(context.supabase, context.userId);
    const db = await admin();
    const { data: doc } = await db.from("documents").select("id, case_id, storage_path, confidentiality, cases(company_id)").eq("id", data.documentId).maybeSingle();
    const allowed = doc && doc.confidentiality === "EMPLOYER_VISIBLE" && doc.cases?.company_id === companyId;
    await audit(db, { tenant_id: tenantId, user_id: context.userId, action: allowed ? "DOWNLOAD" : "DENIED", entity: "documents", entity_id: data.documentId, case_id: allowed ? doc.case_id : null });
    if (!allowed) throw new Error("Accès refusé");
    const { data: signed } = await db.storage.from("case-documents").createSignedUrl(doc.storage_path, 120);
    return { url: (signed?.signedUrl ?? "") as string };
  });

export const employerUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ caseId: z.string().uuid(), filename: z.string().max(200), mimeType: z.string().max(120), base64: z.string().max(7_000_000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { tenantId, companyId } = await employerContext(context.supabase, context.userId);
    const db = await admin();
    const { data: c } = await db.from("cases").select("id").eq("id", data.caseId).eq("company_id", companyId).maybeSingle();
    if (!c) throw new Error("Accès refusé");
    const bytes = decodeBase64(data.base64);
    if (bytes.length > MAX_UPLOAD) throw new Error("Fichier trop volumineux (5 Mo max)");
    const path = `${tenantId}/${c.id}/employeur-${crypto.randomUUID()}-${data.filename.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await db.storage.from("case-documents").upload(path, bytes, { contentType: data.mimeType });
    if (error) throw new Error("Envoi impossible");
    const { data: row } = await db
      .from("documents")
      .insert({ tenant_id: tenantId, case_id: c.id, filename: data.filename, storage_path: path, mime_type: data.mimeType, confidentiality: "EMPLOYER_VISIBLE", doc_type: "FICHE_POSTE", uploaded_by: context.userId, source: "EMPLOYER" })
      .select("id")
      .single();
    await audit(db, { tenant_id: tenantId, user_id: context.userId, action: "CREATE", entity: "documents", entity_id: row?.id, case_id: c.id });
    return { ok: true };
  });

export const employerCompleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taskId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { tenantId, companyId } = await employerContext(context.supabase, context.userId);
    const db = await admin();
    const { data: t } = await db.from("coordination_tasks").select("id, case_id, recipient, cases(company_id)").eq("id", data.taskId).maybeSingle();
    if (!t || t.recipient !== "EMPLOYER_HR" || t.cases?.company_id !== companyId) throw new Error("Accès refusé");
    await db.from("coordination_tasks").update({ status: "DONE" }).eq("id", t.id); // status only; text is immutable
    await audit(db, { tenant_id: tenantId, user_id: context.userId, action: "TASK_DONE", entity: "coordination_tasks", entity_id: t.id, case_id: t.case_id });
    return { ok: true };
  });

/* ------------------------------- worker portal ------------------------------- */

export const exchangeWorkerLink = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(d))
  .handler(async ({ data }) => {
    const db = await admin();
    const now = new Date().toISOString();
    // Atomic single use: only one request can flip used_at.
    const { data: link } = await db
      .from("worker_links")
      .update({ used_at: now })
      .eq("token_hash", await sha256(data.token))
      .is("used_at", null)
      .gt("expires_at", now)
      .select("tenant_id, case_id")
      .maybeSingle();
    if (!link) throw new Error("Lien invalide, déjà utilisé ou expiré");
    const session = randomToken();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    await db.from("worker_sessions").insert({ tenant_id: link.tenant_id, case_id: link.case_id, token_hash: await sha256(session), expires_at: expiresAt });
    return { sessionToken: session, expiresAt };
  });

async function workerSession(token: string) {
  const db = await admin();
  const { data: s } = await db
    .from("worker_sessions")
    .select("tenant_id, case_id, expires_at")
    .eq("token_hash", await sha256(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!s) throw new Error("Session expirée");
  return { db, tenantId: s.tenant_id as string, caseId: s.case_id as string, expiresAt: s.expires_at as string };
}
const sessionSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const getWorkerPortal = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sessionToken: sessionSchema }).parse(d))
  .handler(async ({ data }) => {
    const { db, caseId, expiresAt } = await workerSession(data.sessionToken);
    const { data: c } = await db.from("cases").select("id, status, origin, worker_id, workers(first_name), companies(name)").eq("id", caseId).single();
    const [st, docs, drafts, tasks, sent] = await Promise.all([
      db.from("work_stoppages").select("start_date, end_date, origin, kind").eq("worker_id", c.worker_id).order("start_date"),
      db.from("documents").select("id, doc_type, source, filename, created_at").eq("case_id", caseId).eq("confidentiality", "WORKER_VISIBLE"),
      db.from("ai_drafts").select("id, approved_text, approved_at").eq("case_id", caseId).eq("confidentiality", "WORKER_VISIBLE").eq("status", "APPROVED"),
      db.from("coordination_tasks").select("id, message, status, due_at").eq("case_id", caseId).eq("recipient", "WORKER").in("status", ["SENT", "DONE"]),
      db.from("documents").select("id, filename, created_at").eq("case_id", caseId).eq("source", "WORKER"),
    ]);
    return {
      expiresAt,
      firstName: (c.workers?.first_name ?? "") as string,
      company: (c.companies?.name ?? "") as string,
      periods: (st.data ?? []).map((s: any) => ({ start: s.start_date as string, end: (s.end_date ?? null) as string | null })),
      deadlines: computeDeadlines(st.data ?? [], c.origin)
        .filter((d) => WORKER_DEADLINES.has(d.code))
        .map((d) => ({ code: d.code, label: d.label, from: d.from, due: d.due, status: d.status })),
      documents: (docs.data ?? []).map((d: any) => ({ id: d.id as string, title: d.source === "WORKER" ? (d.filename as string) : genericDocTitle(d.doc_type) })),
      messages: (drafts.data ?? []).map((d: any) => ({ id: d.id as string, text: d.approved_text as string })),
      tasks: (tasks.data ?? []).map((t: any) => ({ id: t.id as string, message: t.message as string, status: t.status as string, due: (t.due_at ?? null) as string | null })),
      sent: (sent.data ?? []).map((d: any) => ({ id: d.id as string, filename: d.filename as string, createdAt: d.created_at as string })),
    };
  });

export const workerUpload = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sessionToken: sessionSchema, filename: z.string().max(200), mimeType: z.string().max(120), base64: z.string().max(7_000_000) }).parse(d))
  .handler(async ({ data }) => {
    const { db, tenantId, caseId } = await workerSession(data.sessionToken);
    const bytes = decodeBase64(data.base64);
    if (bytes.length > MAX_UPLOAD) throw new Error("Fichier trop volumineux (5 Mo max)");
    const path = `${tenantId}/${caseId}/salarie-${crypto.randomUUID()}-${data.filename.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await db.storage.from("case-documents").upload(path, bytes, { contentType: data.mimeType });
    if (error) throw new Error("Envoi impossible");
    // Worker uploads (arrêts, certificats) are medical by default.
    await db.from("documents").insert({ tenant_id: tenantId, case_id: caseId, filename: data.filename, storage_path: path, mime_type: data.mimeType, confidentiality: "MEDICAL", source: "WORKER" });
    return { ok: true };
  });

export const workerCompleteTask = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sessionToken: sessionSchema, taskId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db, caseId } = await workerSession(data.sessionToken);
    await db.from("coordination_tasks").update({ status: "DONE" }).eq("id", data.taskId).eq("case_id", caseId).eq("recipient", "WORKER");
    return { ok: true };
  });

export const getWorkerDocUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ sessionToken: sessionSchema, documentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { db, caseId } = await workerSession(data.sessionToken);
    const { data: doc } = await db.from("documents").select("storage_path").eq("id", data.documentId).eq("case_id", caseId).eq("confidentiality", "WORKER_VISIBLE").maybeSingle();
    if (!doc) throw new Error("Accès refusé");
    const { data: signed } = await db.storage.from("case-documents").createSignedUrl(doc.storage_path, 120);
    return { url: (signed?.signedUrl ?? "") as string };
  });
