import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAgenda } from "@/lib/my-day.functions";
import { AgendaList } from "@/components/agenda-list";
import { PageTitle } from "@/components/kit";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/agenda")({
  head: () => ({
    meta: [
      { title: "Agenda — Reprise" },
      { name: "description", content: "Échéances et étapes des plans de retour des 30 prochains jours." },
      { property: "og:title", content: "Agenda — Reprise" },
      { property: "og:description", content: "Échéances et étapes des plans de retour à venir." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgendaPage,
});

function AgendaPage() {
  const fetchAgenda = useServerFn(getAgenda);
  const { data, isLoading, error } = useQuery({ queryKey: ["agenda"], queryFn: () => fetchAgenda() });
  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">Accès refusé.</p>;
  return (
    <div className="space-y-8">
      <PageTitle title="Agenda" subtitle="Échéances et étapes des plans de retour, sur les 30 prochains jours." />
      <AgendaList items={data.items} today={data.today} empty="Aucune échéance dans les 30 prochains jours." emptyAction={<Button asChild size="sm" variant="outline"><Link to="/dossiers">Voir les dossiers</Link></Button>} />
    </div>
  );
}
