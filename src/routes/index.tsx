import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileSpreadsheet, ShieldCheck, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reprise — pilotez le maintien en emploi" },
      {
        name: "description",
        content:
          "Importez vos exports SPSTI et RH, créez automatiquement les dossiers de maintien en emploi et suivez les arrêts AT/MP.",
      },
      { property: "og:title", content: "Reprise — pilotez le maintien en emploi" },
      {
        property: "og:description",
        content: "Import de fichiers, création automatique des dossiers, suivi des arrêts de travail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  {
    icon: FileSpreadsheet,
    title: "Import guidé",
    body: "CSV ou Excel, colonnes reconnues automatiquement, mappage enregistré et réutilisable par source.",
  },
  {
    icon: Workflow,
    title: "Dossiers automatiques",
    body: "Un arrêt de 30 jours ou plus, ou tout AT/MP, ouvre un dossier. Les prolongations rejoignent le dossier existant.",
  },
  {
    icon: ShieldCheck,
    title: "Données cloisonnées",
    body: "Chaque service ne voit que ses propres entreprises, salariés et dossiers. Aucune donnée réelle dans la démo.",
  },
];

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="font-display text-lg font-semibold tracking-tight">Reprise</span>
        <Button asChild variant="outline" size="sm">
          <Link to="/auth">Se connecter</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-10">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
          Maintien en emploi · AT/MP
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
          Vos fichiers d'absences deviennent des dossiers suivis, en quelques minutes.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
          Reprise reprend les exports que votre service ou vos entreprises adhérentes possèdent déjà et en fait des
          entreprises, des salariés, des arrêts de travail et des dossiers de maintien en emploi.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">
              Commencer <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <a href="/samples/absences_demo.csv" download>
              Télécharger un fichier d'exemple
            </a>
          </Button>
        </div>

        <div className="mt-16 grid gap-5 md:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <article key={title} className="panel p-6">
              <Icon className="size-5 text-primary" aria-hidden />
              <h2 className="mt-4 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
