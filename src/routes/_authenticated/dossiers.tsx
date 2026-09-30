import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCases } from "@/lib/imports.functions";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/dossiers")({
  head: () => ({
    meta: [
      { title: "Dossiers — Reprise" },
      { name: "description", content: "Liste des dossiers de maintien en emploi ouverts et clos." },
      { property: "og:title", content: "Dossiers — Reprise" },
      { property: "og:description", content: "Dossiers de maintien en emploi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CasesPage,
});

const ORIGIN_LABELS: Record<string, string> = {
  MALADIE: "Maladie",
  AT: "Accident du travail",
  MP: "Maladie professionnelle",
};

function CasesPage() {
  const fetchCases = useServerFn(listCases);
  const { data, isLoading } = useQuery({ queryKey: ["cases"], queryFn: () => fetchCases() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dossiers</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dossiers créés automatiquement à partir des arrêts importés.
        </p>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Salarié</th>
              <th className="px-4 py-3 font-medium">Entreprise</th>
              <th className="px-4 py-3 font-medium">Origine</th>
              <th className="px-4 py-3 font-medium">Ouvert le</th>
              <th className="px-4 py-3 font-medium">Statut</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  Chargement…
                </td>
              </tr>
            )}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  Aucun dossier pour le moment. Importez un fichier d'absences pour commencer.
                </td>
              </tr>
            )}
            {data?.map((row: any) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium">
                  <Link to="/dossiers/$caseId" params={{ caseId: row.id }} className="text-primary hover:underline">
                    {row.workers?.last_name} {row.workers?.first_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{row.companies?.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{ORIGIN_LABELS[row.origin] ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(row.opened_at).toLocaleDateString("fr-FR")}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={row.status === "OPEN" ? "default" : "secondary"}>
                    {row.status === "OPEN" ? "Ouvert" : "Clos"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
