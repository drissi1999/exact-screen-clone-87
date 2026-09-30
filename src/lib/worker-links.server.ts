/** Worker magic links. The token is never stored in clear: only its hash, and simulated messages carry a placeholder. */
export const SECURE_LINK_PLACEHOLDER = "[lien sécurisé]";

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * `sb` is the staff member's own client (RLS proves the case is in their tenant); `db` is the service-role client.
 * Returns the real link once, to the caller only.
 */
export async function issueWorkerLink(db: any, sb: any, caseId: string, userId: string, origin: string): Promise<{ link: string }> {
  const { data: c } = await sb.from("cases").select("id, tenant_id, workers(first_name, last_name, phone)").eq("id", caseId).maybeSingle();
  if (!c) throw new Error("Dossier introuvable");
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.from("worker_links").insert({ tenant_id: c.tenant_id, case_id: c.id, token_hash: await sha256(token), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(), created_by: userId });
  await sb.from("simulated_messages").insert({
    tenant_id: c.tenant_id,
    case_id: c.id,
    recipient_label: `Salarié — ${c.workers?.first_name ?? ""} ${c.workers?.last_name ?? ""}`,
    to_address: c.workers?.phone ?? "téléphone manquant",
    channel: "SMS",
    subject: "Lien d'accès salarié",
    body: `Bonjour ${c.workers?.first_name ?? ""}, votre service de santé au travail vous donne accès à votre espace : ${SECURE_LINK_PLACEHOLDER} (lien à usage unique, valable 15 minutes).`,
    sent_by: userId,
  });
  await db.from("audit_log").insert({ tenant_id: c.tenant_id, user_id: userId, action: "WORKER_LINK", entity: "cases", entity_id: c.id, case_id: c.id });
  return { link: `${new URL(origin).origin}/salarie/${token}` };
}
