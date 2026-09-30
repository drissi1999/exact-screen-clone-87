import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Building2, ClipboardList, FileInput, HeartPulse, History, Lock, Server, Stethoscope, User, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reprise — le maintien en emploi, de l'arrêt à la reprise" },
      { name: "description", content: "Reprise organise les dossiers de maintien en emploi et AT/MP pour les services de prévention et de santé au travail, dans le respect du secret médical." },
      { property: "og:title", content: "Reprise — le maintien en emploi, de l'arrêt à la reprise" },
      { property: "og:description", content: "Documents reçus, dossier organisé, décision et suivi : un seul outil pour le médecin du travail, la cellule PDP, l'employeur et le salarié." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const FIGURES = [
  { value: "−30 %", label: "de temps de préparation des visites" },
  { value: "100 %", label: "des faits de la chronologie reliés à leur source" },
  { value: "0", label: "échéance légale oubliée" },
];
const STEPS = [
  { icon: FileInput, title: "Documents reçus", body: "Arrêts, comptes rendus, fiches de poste : chaque pièce est lue, classée et protégée selon son niveau de confidentialité." },
  { icon: ClipboardList, title: "Dossier organisé", body: "Une chronologie dont chaque fait renvoie à sa page source, des échéances calculées et un indicateur de priorité expliqué." },
  { icon: HeartPulse, title: "Décision et suivi", body: "Plan de retour partagé, tâches pour l'employeur et le salarié, suivis à J+7, J+30 et J+90." },
];
const USERS = [
  { icon: Stethoscope, title: "Médecin du travail", body: "Ses visites de la semaine préparées, les faits validés en un clic." },
  { icon: Users, title: "IDEST et cellule PDP", body: "Une journée triée par priorité, une action par dossier." },
  { icon: Building2, title: "Employeur", body: "Les demandes du service et les absences, jamais d'information médicale." },
  { icon: User, title: "Salarié", body: "Son parcours sur mobile, par lien sécurisé, sans compte à créer." },
];
const SECURITY = [
  { icon: Lock, title: "Secret médical", body: "Le cloisonnement est appliqué par la base de données : l'employeur ne voit ni diagnostic ni titre de document médical." },
  { icon: History, title: "Journal d'accès", body: "Chaque consultation d'une pièce médicale et chaque validation sont tracées, qui et quand." },
  { icon: Server, title: "Hébergement", body: "Données hébergées dans l'Union européenne. Certification HDS visée pour la mise en production." },
];

function Index() {
  const [signedIn, setSignedIn] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="flex items-center gap-2 font-display text-base font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground">R</span>Reprise
        </span>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm"><a href="#demo">Demander une démo</a></Button>
          <Button asChild variant="outline" size="sm"><Link to={signedIn ? "/accueil" : "/auth"}>{signedIn ? "Ouvrir Reprise" : "Se connecter"}</Link></Button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16">
        <p className="text-sm font-medium text-primary">Maintien en emploi · AT/MP · Prévention de la désinsertion professionnelle</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">Le maintien en emploi, de l'arrêt à la reprise</h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          Reprise aide les services de prévention et de santé au travail à suivre chaque salarié en arrêt, du premier document reçu jusqu'au retour dans l'emploi.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild size="lg"><a href="#demo">Demander une démo <ArrowRight className="ml-2 size-4" /></a></Button>
          <Button asChild size="lg" variant="outline"><Link to={signedIn ? "/accueil" : "/auth"}>{signedIn ? "Ouvrir Reprise" : "Se connecter"}</Link></Button>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-3">
          {FIGURES.map((f) => (
            <div key={f.label} className="panel p-6">
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Objectif</span>
              <p className="mt-4 text-4xl font-semibold tracking-tight text-primary">{f.value}</p>
              <p className="mt-2 text-sm text-muted-foreground">{f.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight">Trois étapes, un seul dossier</h2>
          <ol className="mt-10 grid gap-10 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li key={title}>
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{i + 1}</span>
                  <Icon className="size-5 text-primary" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-2xl font-semibold tracking-tight">Un écran pour chacun</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {USERS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="panel p-6">
              <Icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-2xl font-semibold tracking-tight">Sécurité et confidentialité</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {SECURITY.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="size-5 text-primary" aria-hidden />
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="demo" className="mx-auto max-w-6xl px-6 py-20">
        <div className="panel flex flex-col gap-6 p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Demander une démo</h2>
            <p className="mt-2 text-sm text-muted-foreground">Une démonstration de 30 minutes sur des dossiers fictifs.</p>
          </div>
          {sent ? (
            <p className="text-sm font-medium text-primary">Merci, nous revenons vers vous rapidement.</p>
          ) : (
            <form className="flex w-full max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); setSent(true); toast.success("Demande reçue (prototype : aucun envoi réel)"); }}>
              <input required type="email" placeholder="Votre e-mail professionnel" className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <Button type="submit">Demander une démo</Button>
            </form>
          )}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-muted-foreground">Reprise · prototype</footer>
    </main>
  );
}
