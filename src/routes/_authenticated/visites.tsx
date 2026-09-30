import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAgenda } from "@/lib/my-day.functions";
import { AgendaList } from "@/components/agenda-list";
import { PageTitle } from "@/components/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/visites")({
  head: () => ({
    meta: [
      { title: "Visites à préparer — Reprise" },
      { name: "description", content: "Dossiers avec une visite de pré-reprise, de reprise ou une étape d'inaptitude cette semaine." },
      { property: "og:title", content: "Visites à préparer — Reprise" },
      { property: "og:description", content: "Visites de la semaine pour le médecin du travail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VisitsPage,
});

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function VisitsPage() {
  const fetchAgenda = useServerFn(getAgenda);
  const { data, isLoading, error } = useQuery({ queryKey: ["agenda"], queryFn: () => fetchAgenda() });
  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">Accès refusé.</p>;
  const week = addDays(data.today, 7);
  const items = data.items.filter((i) => i.visit && i.date <= week);
  const cases = new Set(items.map((i) => i.caseId)).size;
  return (
    <div className="space-y-8">
      <PageTitle title="Visites à préparer" subtitle={`${cases} dossier${cases > 1 ? "s" : ""} avec une pré-reprise, une reprise ou une étape d'inaptitude cette semaine.`} />
      <AgendaList items={items} today={data.today} empty="Aucune visite à préparer cette semaine." emptyAction={<Button asChild size="sm" variant="outline"><Link to="/dossiers">Voir les dossiers</Link></Button>} />
    </div>
  );
}
