import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { bootstrapMedecin, getMe, getMedecinBootstrap, listAudit, listMembers, setRole } from "@/lib/cases.functions";
import { canManageRole } from "@/lib/role-policy";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/rules";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/parametres/equipe")({
  head: () => ({
    meta: [
      { title: "Équipe et journal d'accès — Reprise" },
      { name: "description", content: "Gestion des rôles de l'équipe et journal des accès aux données médicales." },
      { property: "og:title", content: "Équipe et journal d'accès — Reprise" },
      { property: "og:description", content: "Rôles et traçabilité des accès." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TeamPage,
});

const ROLES = Object.keys(ROLE_LABELS);

function TeamPage() {
  const qc = useQueryClient();
  const fMembers = useServerFn(listMembers);
  const fMe = useServerFn(getMe);
  const fAudit = useServerFn(listAudit);
  const fSet = useServerFn(setRole);
  const { data: members } = useQuery({ queryKey: ["members"], queryFn: () => fMembers() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fMe() });
  const { data: logs } = useQuery({ queryKey: ["audit"], queryFn: () => fAudit() });
  const fBoot = useServerFn(getMedecinBootstrap);
  const fDoBoot = useServerFn(bootstrapMedecin);
  const { data: boot } = useQuery({ queryKey: ["medecin-bootstrap"], queryFn: () => fBoot() });
  const [pick, setPick] = useState("");
  const isAdmin = me?.roles.includes("SPSTI_ADMIN");
  const myRoles = me?.roles ?? [];
  const names = new Map((members ?? []).map((m) => [m.userId, m.name]));

  async function toggle(userId: string, role: string, enabled: boolean) {
    try {
      await fSet({ data: { userId, role: role as any, enabled } });
      qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Équipe et rôles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Les rôles déterminent les niveaux de confidentialité visibles. Seul le médecin du travail et l'IDEST accèdent aux données médicales.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">Les rôles Médecin du travail et Infirmier(e) santé travail ne peuvent être attribués ou retirés que par un médecin du travail de ce SPSTI.</p>
      {isAdmin && boot?.available && (
        <div className="panel flex flex-wrap items-center gap-3 p-4">
          <p className="text-sm font-medium">Désigner le médecin référent (une seule fois) :</p>
          <select className="rounded-md border border-input bg-background px-2 py-1 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choisir un membre…</option>
            {members?.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </select>
          <Button size="sm" disabled={!pick} onClick={async () => { try { await fDoBoot({ data: { userId: pick } }); toast.success("Médecin référent désigné"); qc.invalidateQueries(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); } }}>Désigner</Button>
        </div>
      )}
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Membre</th>
              {ROLES.map((r) => <th key={r} className="px-2 py-3 text-center text-xs font-medium">{ROLE_LABELS[r]}</th>)}
            </tr>
          </thead>
          <tbody>
            {members?.map((m) => (
              <tr key={m.userId} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">{m.name}</td>
                {ROLES.map((r) => (
                  <td key={r} className="px-2 py-3 text-center">
                    <Checkbox checked={m.roles.includes(r)} disabled={!canManageRole(myRoles, r)} onCheckedChange={(v) => toggle(m.userId, r, v === true)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-lg font-semibold">Journal d'accès</h2>
        <p className="mt-1 text-sm text-muted-foreground">Journal inaltérable. Visible par l'administrateur et le médecin du travail. Aucune donnée de santé n'y figure.</p>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr><th className="px-4 py-2 font-medium">Date</th><th className="px-4 py-2 font-medium">Utilisateur</th><th className="px-4 py-2 font-medium">Action</th><th className="px-4 py-2 font-medium">Objet</th></tr>
          </thead>
          <tbody>
            {(logs ?? []).length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-muted-foreground">Aucune entrée visible.</td></tr>}
            {logs?.map((l: any) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 text-muted-foreground">{new Date(l.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                <td className="px-4 py-2">{names.get(l.user_id) ?? l.user_id.slice(0, 8)}</td>
                <td className="px-4 py-2 font-mono text-xs">{l.action}</td>
                <td className="px-4 py-2 text-muted-foreground">{l.entity}{l.entity_id ? ` · ${String(l.entity_id).slice(0, 8)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
