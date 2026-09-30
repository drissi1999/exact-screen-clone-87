import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getStats, seedDemoData } from "@/lib/imports.functions";
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
  const seed = useServerFn(seedDemoData);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: () => fetchStats() });

  const seedMutation = useMutation({
    mutationFn: () => seed(),
    onSuccess: (result) => {
      toast.success(
        `Jeu de démonstration chargé : ${result.rowsImported} arrêts, ${result.casesCreated} dossiers ouverts.`,
      );
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Chargement impossible"),
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
          <Button variant="secondary" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            {seedMutation.isPending ? "Chargement…" : "Charger un jeu de démonstration"}
          </Button>
          <Button asChild>
            <Link to="/parametres/imports">Importer un fichier</Link>
          </Button>
        </div>
      </div>

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
