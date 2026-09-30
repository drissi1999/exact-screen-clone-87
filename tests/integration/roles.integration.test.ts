/**
 * Real database policy tests for role grants. Creates two throw-away SPSTI tenants
 * (each signup gets SPSTI_ADMIN + PDP_COORDINATOR), acts through the public API
 * as each user, then deletes everything. Skipped when no service key is present.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const run = URL && ANON && SERVICE ? describe : describe.skip;

type U = { id: string; tenant: string; sb: SupabaseClient };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

run("user_roles policies (live database)", () => {
  const admin = createClient(URL!, SERVICE!, opts);
  const pwd = `T-${crypto.randomUUID()}`;
  let a: U, member: U, b: U;

  async function mk(label: string): Promise<U> {
    const email = `roles.${label}.${Date.now()}@test.fictif`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: pwd, email_confirm: true });
    if (error) throw error;
    const sb = createClient(URL!, ANON!, opts);
    const { error: e2 } = await sb.auth.signInWithPassword({ email, password: pwd });
    if (e2) throw e2;
    const { data: p } = await admin.from("profiles").select("tenant_id").eq("user_id", data.user!.id).single();
    return { id: data.user!.id, tenant: p!.tenant_id, sb };
  }
  const grant = (as: U, user: string, tenant: string, role: string) =>
    as.sb.from("user_roles").insert({ user_id: user, tenant_id: tenant, role: role as any });
  const revoke = async (as: U, user: string, role: string) =>
    ((await as.sb.from("user_roles").delete().eq("user_id", user).eq("role", role as any).select("id")).data ?? []).length;
  const canRead = async (as: U) => {
    const { data } = await as.sb.from("documents").select("id").eq("confidentiality", "MEDICAL").limit(1);
    return data;
  };

  beforeAll(async () => {
    a = await mk("a");
    b = await mk("b");
    member = await mk("m");
    // move "member" into tenant A as a plain member
    const old = member.tenant;
    await admin.from("user_roles").delete().eq("user_id", member.id);
    await admin.from("profiles").update({ tenant_id: a.tenant }).eq("user_id", member.id);
    await admin.from("tenants").delete().eq("id", old);
    member.tenant = a.tenant;
  }, 30_000);

  afterAll(async () => {
    for (const u of [a, b, member].filter(Boolean)) {
      await admin.from("audit_log").delete().eq("user_id", u.id);
      await admin.from("user_roles").delete().eq("user_id", u.id);
      await admin.from("profiles").delete().eq("user_id", u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
    for (const t of [a?.tenant, b?.tenant].filter(Boolean)) await admin.from("tenants").delete().eq("id", t!);
  }, 30_000);

  it("admin cannot self-grant MEDECIN_TRAVAIL", async () => {
    expect((await grant(a, a.id, a.tenant, "MEDECIN_TRAVAIL")).error).not.toBeNull();
  });
  it("admin cannot self-grant IDEST", async () => {
    expect((await grant(a, a.id, a.tenant, "IDEST")).error).not.toBeNull();
  });
  it("admin cannot grant MEDECIN_TRAVAIL to a member", async () => {
    expect((await grant(a, member.id, a.tenant, "MEDECIN_TRAVAIL")).error).not.toBeNull();
  });
  it("admin can grant a non-medical role in own tenant", async () => {
    expect((await grant(a, member.id, a.tenant, "PDP_COORDINATOR")).error).toBeNull();
  });
  it("admin cannot grant roles in another tenant", async () => {
    expect((await grant(a, b.id, b.tenant, "PDP_COORDINATOR")).error).not.toBeNull();
    expect((await grant(a, b.id, a.tenant, "PDP_COORDINATOR")).error).not.toBeNull();
  });
  it("médecin of the tenant can grant and revoke IDEST, admin cannot revoke the médecin", async () => {
    await admin.from("user_roles").insert({ user_id: member.id, tenant_id: a.tenant, role: "MEDECIN_TRAVAIL" }); // bootstrap
    expect((await grant(member, a.id, a.tenant, "IDEST")).error).toBeNull();
    expect(await revoke(member, a.id, "IDEST")).toBe(1);
    expect(await revoke(a, member.id, "MEDECIN_TRAVAIL")).toBe(0);
  });
  it("médecin who is not admin cannot grant SPSTI_ADMIN", async () => {
    expect((await grant(member, member.id, a.tenant, "SPSTI_ADMIN")).error).not.toBeNull();
  });
  it("a role row pointing at a foreign tenant grants nothing", async () => {
    // B gets a MEDECIN_TRAVAIL row stamped with tenant A (should never happen, must be inert)
    await admin.from("user_roles").insert({ user_id: b.id, tenant_id: a.tenant, role: "MEDECIN_TRAVAIL" });
    expect((await grant(b, b.id, b.tenant, "IDEST")).error).not.toBeNull();
    expect(await canRead(b)).toEqual([]);
  });
});
