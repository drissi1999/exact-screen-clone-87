import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getStats } from "@/lib/imports.functions";
import { loadDemoData, resetDemoData } from "@/lib/demo.functions";
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
  const load = useServerFn(loadDemoData);
  const reset = useServerFn(resetDemoData);
  const fetchMe = useServerFn(getMe);
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const isAdmin = !!me?.roles.includes("SPSTI_ADMIN");

  const loadMutation = useMutation({
    mutationFn: () => load(),
    onSuccess: (r) => { toast.success(`Démo chargée : ${r.situations} situations fictives, ${r.cases} dossiers.`); queryClient.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Chargement impossible"),
  });
  const resetMutation = useMutation({
    mutationFn: () => reset({ data: { confirmation: confirmText } }),
    onSuccess: (r) => { toast.success(`Démo réinitialisée : ${r.cases} dossiers et ${r.workers} salariés supprimés.`); setConfirmOpen(false); setConfirmText(""); queryClient.invalidateQueries(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Réinitialisation impossible"),
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
            <>
              <Button variant="outline" onClick={() => setConfirmOpen((o) => !o)}>Réinitialiser la démo</Button>
              <Button variant="secondary" onClick={() => loadMutation.mutate()} disabled={loadMutation.isPending}>
                {loadMutation.isPending ? "Chargement…" : "Charger les 12 situations de démo"}
              </Button>
            </>
          )}
          <Button asChild>
            <Link to="/parametres/imports">Importer un fichier</Link>
          </Button>
        </div>
      </div>

      {confirmOpen && isAdmin && (
        <form className="panel space-y-3 border-destructive p-5" onSubmit={(e) => { e.preventDefault(); resetMutation.mutate(); }}>
          <p className="font-medium">Réinitialiser la démo de votre SPSTI</p>
          <p className="text-sm text-muted-foreground">Supprime tous les dossiers, salariés, entreprises, arrêts, documents, faits, brouillons, plans, tâches, messages et journaux de dossiers de votre service. Les comptes utilisateurs, les rôles et les autres SPSTI ne sont jamais touchés. L'action est journalisée.</p>
          <div className="flex flex-wrap gap-2">
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Tapez RÉINITIALISER" aria-label="Confirmation" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
            <Button type="submit" variant="destructive" disabled={confirmText !== "RÉINITIALISER" || resetMutation.isPending}>{resetMutation.isPending ? "Suppression…" : "Tout supprimer"}</Button>
          </div>
        </form>
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
