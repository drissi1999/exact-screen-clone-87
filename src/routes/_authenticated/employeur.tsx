import { createFileRoute } from "@tanstack/react-router";
import { EmployerView } from "@/components/employer-view";

export const Route = createFileRoute("/_authenticated/employeur")({
  head: () => ({
    meta: [
      { title: "Espace employeur — Reprise" },
      { name: "description", content: "Suivi du retour à l'emploi de vos salariés, sans aucune donnée médicale." },
      { property: "og:title", content: "Espace employeur — Reprise" },
      { property: "og:description", content: "Espace RH employeur." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: EmployerPage,
});

function EmployerPage() {
  return <EmployerView />;
}
