import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { adminWorkerPreviewLink, listCompaniesWithInvites } from "@/lib/portal.functions";
import { listCases } from "@/lib/imports.functions";
import { getMe } from "@/lib/cases.functions";
import { ROLE_LABELS } from "@/lib/rules";
import { EmployerView } from "@/components/employer-view";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/apercu")({
  head: () => ({
    meta: [
      { title: "Voir en tant que — Reprise" },
      { name: "description", content: "Aperçu administrateur des espaces employeur, salarié et des vues par rôle." },
      { property: "og:title", content: "Voir en tant que — Reprise" },
      { property: "og:description", content: "Aperçu administrateur des différents espaces." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PreviewPage,
});

function PreviewPage() {
  const fMe = useServerFn(getMe);
  const fCompanies = useServerFn(listCompaniesWithInvites);
  const fCases = useServerFn(listCases);
  const fWorker = useServerFn(adminWorkerPreviewLink);
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fMe() });
  const { data: comp } = useQuery({ queryKey: ["companies-invites"], queryFn: () => fCompanies() });
  const { data: cases } = useQuery({ queryKey: ["cases-list"], queryFn: () => fCases() });
  const [companyId, setCompanyId] = useState("");
  const [caseId, setCaseId] = useState("");

  if (me && !me.roles.includes("SPSTI_ADMIN")) return <p className="text-destructive">Réservé à l'administrateur SPSTI.</p>;

  async function openWorker() {
    try {
      const { path } = await fWorker({ data: { caseId } });
      window.open(path, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  const select = "h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Voir en tant que…</h1>
        <p className="mt-1 text-sm text-muted-foreground">Aperçu réservé à l'administrateur. Chaque aperçu est inscrit au journal d'accès.</p>
      </div>

      <section className="panel space-y-3 p-5">
        <h2 className="text-lg font-semibold">1 · Rôles de l'équipe SPSTI</h2>
        <p className="text-sm text-muted-foreground">
          Vos rôles actuels : {me?.roles.map((r) => <Badge key={r} variant="outline" className="mr-1">{ROLE_LABELS[r] ?? r}</Badge>)}
        </p>
        <p className="text-sm text-muted-foreground">
          Pour voir l'application comme un coordinateur (sans données médicales) ou comme un médecin, cochez ou décochez vos rôles dans{" "}
          <Link to="/parametres/equipe" className="text-primary hover:underline">Équipe · Accès</Link>, puis ouvrez un dossier. Gardez « Administrateur » coché.
        </p>
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="text-lg font-semibold">2 · Espace salarié</h2>
        <p className="text-sm text-muted-foreground">Ouvre le vrai espace salarié du dossier choisi dans un nouvel onglet (session de 30 minutes). Aucun SMS simulé n'est envoyé.</p>
        <select className={select} value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Dossier">
          <option value="">Choisir un dossier…</option>
          {(cases ?? []).map((c: any) => (
            <option key={c.id} value={c.id}>{c.workers?.last_name} {c.workers?.first_name} — {c.companies?.name}</option>
          ))}
        </select>
        <div><Button disabled={!caseId} onClick={openWorker}>Ouvrir l'espace salarié</Button></div>
      </section>

      <section className="panel space-y-3 p-5">
        <h2 className="text-lg font-semibold">3 · Espace employeur</h2>
        <p className="text-sm text-muted-foreground">Affiche exactement ce que voit le RH de l'entreprise choisie (lecture seule).</p>
        <select className={select} value={companyId} onChange={(e) => setCompanyId(e.target.value)} aria-label="Entreprise">
          <option value="">Choisir une entreprise…</option>
          {(comp?.companies ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </section>

      {companyId && (
        <div className="rounded-lg border-2 border-dashed border-primary p-4">
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-primary">Aperçu employeur</p>
          <EmployerView asCompanyId={companyId} />
        </div>
      )}
    </div>
  );
}
