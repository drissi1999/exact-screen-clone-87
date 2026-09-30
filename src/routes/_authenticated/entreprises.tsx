import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { inviteEmployer, listCompaniesWithInvites } from "@/lib/portal.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/entreprises")({
  head: () => ({
    meta: [
      { title: "Entreprises adhérentes — Reprise" },
      { name: "description", content: "Entreprises adhérentes et invitations à l'espace employeur." },
      { property: "og:title", content: "Entreprises adhérentes — Reprise" },
      { property: "og:description", content: "Invitez les RH employeurs à leur espace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompaniesPage,
});

function CompaniesPage() {
  const qc = useQueryClient();
  const fList = useServerFn(listCompaniesWithInvites);
  const fInvite = useServerFn(inviteEmployer);
  const { data, isLoading } = useQuery({ queryKey: ["companies"], queryFn: () => fList() });
  const [open, setOpen] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [lastLink, setLastLink] = useState<string | null>(null);

  async function invite(companyId: string) {
    try {
      const { link } = await fInvite({ data: { companyId, email, fullName: name || undefined, origin: window.location.origin } });
      setLastLink(link);
      setEmail("");
      setName("");
      setOpen(null);
      toast.success("Invitation envoyée (simulée)");
      qc.invalidateQueries({ queryKey: ["companies"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Entreprises adhérentes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Invitez un RH : il ne verra que les salariés de son entreprise, sans aucune donnée médicale.</p>
      </div>
      {lastLink && (
        <div className="panel space-y-1 p-4 text-sm">
          <p className="font-medium">Lien d'invitation (envoi simulé, visible aussi dans « Messages simulés ») :</p>
          <code className="break-all text-xs">{lastLink}</code>
        </div>
      )}
      <div className="panel divide-y divide-border">
        {isLoading && <p className="p-4 text-sm text-muted-foreground">Chargement…</p>}
        {data?.companies.map((c) => (
          <div key={c.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">SIRET {c.siret ?? "—"}</p>
              </div>
              {data.isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setOpen(open === c.id ? null : c.id)}>Inviter un RH</Button>
              )}
            </div>
            {c.invites.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {c.invites.map((i: any) => (
                  <Badge key={i.id} variant={i.accepted_at ? "default" : "secondary"}>
                    {i.email} · {i.accepted_at ? "compte créé" : new Date(i.expires_at) < new Date() ? "expirée" : "en attente"}
                  </Badge>
                ))}
              </div>
            )}
            {open === c.id && (
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Nom (optionnel)" value={name} onChange={(e) => setName(e.target.value)} className="max-w-48" />
                <Input type="email" placeholder="email@entreprise.fr" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-64" />
                <Button size="sm" onClick={() => invite(c.id)} disabled={!email}>Envoyer l'invitation</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
