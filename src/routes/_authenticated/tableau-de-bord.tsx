import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getStats } from "@/lib/imports.functions";
import { restartDemoData } from "@/lib/demo.functions";
import { getMe } from "@/lib/cases.functions";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/tableau-de-bord")({
  head: () => ({
    meta: [
      { title: "Tableau de bord — Reprise" },
      { name: "description", content: "Vue d'ensemble des entreprises, salariés, arrêts et dossiers ouverts." },
      { property: "og:title", content: "Tableau de bord — Reprise" },
      { property: "og:description", content: "Entreprises, salariés, arrêts et dossiers ouverts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const fetchStats = useServerFn(getStats);
  const restart = useServerFn(restartDemoData);
  const fetchMe = useServerFn(getMe);
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const isAdmin = !!me?.roles.includes("SPSTI_ADMIN");

  const restartMutation = useMutation({
    mutationFn: () => restart(),
    onSuccess: (r) => { toast.success(`Démo remise à zéro : ${r.situations} situations fictives, ${r.cases} dossiers.`); setConfirmOpen(false); queryClient.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Remise à zéro impossible"),
  });

  const cards = [
    { label: "Entreprises", value: data?.companies },
    { label: "Salariés", value: data?.workers },
    { label: "Arrêts de travail", value: data?.stoppages },
    { label: "Dossiers ouverts", value: data?.openCases },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tableau de bord</h1>
          <p className="mt-1 text-sm text-muted-foreground">Données de votre service de santé au travail.</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button variant="secondary" onClick={() => setConfirmOpen((o) => !o)} disabled={restartMutation.isPending}>
              {restartMutation.isPending ? "Remise à zéro…" : "Remettre la démo à zéro"}
            </Button>
          )}
          <Button asChild>
            <Link to="/parametres/imports">Importer un fichier</Link>
          </Button>
        </div>
      </div>

      {confirmOpen && isAdmin && (
        <div className="panel space-y-3 border-destructive p-5">
          <p className="font-medium">Remettre la démo à zéro</p>
          <p className="text-sm text-muted-foreground">Supprime tous les dossiers, salariés, arrêts, documents, faits, brouillons, plans, visites, tâches et messages de votre service, puis recharge les 12 situations fictives datées d'aujourd'hui. Les comptes utilisateurs, les rôles et les autres SPSTI ne sont jamais touchés. L'action est journalisée.</p>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={() => restartMutation.mutate()} disabled={restartMutation.isPending}>{restartMutation.isPending ? "Remise à zéro… (environ 30 s)" : "Confirmer"}</Button>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={restartMutation.isPending}>Annuler</Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="panel p-5">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-2 font-display text-3xl font-semibold">{isLoading ? "…" : (card.value ?? 0)}</p>
          </div>
        ))}
      </div>

      <div className="panel p-6">
        <h2 className="text-lg font-semibold">Règles d'ouverture de dossier</h2>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>• Un arrêt de 30 jours ou plus ouvre un dossier si le salarié n'en a pas déjà un.</li>
          <li>• Tout arrêt d'origine accident du travail ou maladie professionnelle ouvre un dossier, quelle que soit sa durée.</li>
          <li>• Une prolongation est rattachée au dossier ouvert existant.</li>
          <li>• Un même fichier réimporté ne crée aucun doublon.</li>
        </ul>
      </div>
    </div>
  );
}
