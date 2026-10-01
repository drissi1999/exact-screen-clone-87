import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, StatusBadge, frDate } from "@/components/kit";
import { generateVisitQuestionsFn, getVisitPrepFn, recordVisitOutcomeFn, saveVisitQuestionsFn } from "@/lib/visits.functions";
import { reviewDraft } from "@/lib/cases.functions";
import { AVIS_TYPE_LABELS, VISIT_KIND_LABELS } from "@/lib/message-templates";

export const Route = createFileRoute("/_authenticated/visite/$visitId")({
  head: () => ({
    meta: [
      { title: "Préparer la visite — Reprise" },
      { name: "description", content: "Préparation de la visite par le médecin du travail : synthèse, faits validés, points manquants, questions et issue." },
      { property: "og:title", content: "Préparer la visite — Reprise" },
      { property: "og:description", content: "Préparation et issue de la visite, réservées au médecin du travail et à l'infirmier(e)." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrepPage,
});

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel space-y-2 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function PrepPage() {
  const { visitId } = Route.useParams();
  const fetchPrep = useServerFn(getVisitPrepFn);
  const gen = useServerFn(generateVisitQuestionsFn);
  const save = useServerFn(saveVisitQuestionsFn);
  const outcome = useServerFn(recordVisitOutcomeFn);
  const review = useServerFn(reviewDraft);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["visit-prep", visitId], queryFn: () => fetchPrep({ data: { visitId } }) });
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState<"" | "ok" | "err">("");
  const [avisType, setAvisType] = useState("APTITUDE_AMENAGEMENTS");
  const [restrictions, setRestrictions] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.questions) setQ(data.questions.text); }, [data?.questions?.id]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["visit-prep", visitId] });

  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">{error instanceof Error ? error.message : "Accès refusé."}</p>;
  const v = data.visit;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Erreur"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link to="/dossiers/$caseId" params={{ caseId: v.caseId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><ArrowLeft className="h-4 w-4" />Retour au dossier</Link>
        <p className="mt-3 text-sm font-medium text-primary">Préparer la visite</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.worker}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {VISIT_KIND_LABELS[v.kind]} · {new Date(v.scheduledAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" })} · {data.company}{data.jobTitle ? ` · ${data.jobTitle}` : ""}
        </p>
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />Contenu médical, jamais transmis à l'employeur. Chaque consultation est enregistrée.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Synthèse validée">
          {data.summary ? <pre className="whitespace-pre-wrap font-sans text-sm">{data.summary.text}</pre> : <p className="text-sm text-muted-foreground">Aucune synthèse validée. Générez-la depuis le dossier.</p>}
        </Block>
        <Block title="5 derniers faits validés">
          {data.lastFacts.length ? (
            <ul className="space-y-2 text-sm">
              {data.lastFacts.map((f) => (
                <li key={f.id}><span className="text-muted-foreground">{f.date ? frDate(f.date) : "—"}</span> · {f.label}{f.source && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{f.source}</span>}</li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Aucun fait validé.</p>}
        </Block>
        <Block title="Points manquants ou à vérifier">
          {data.gaps.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{data.gaps.map((g, i) => <li key={i}>{g.text}</li>)}</ul> : <p className="text-sm text-muted-foreground">Aucun point manquant détecté.</p>}
        </Block>
        <Block title="Contraintes du poste (fiche de poste)">
          {data.jobConstraints.length ? data.jobConstraints.map((j) => <pre key={j.id} className="whitespace-pre-wrap font-sans text-sm">{j.text}</pre>) : <p className="text-sm text-muted-foreground">Pas de fiche de poste au dossier.</p>}
        </Block>
        <Block title="Avis et restrictions précédents">
          {data.previousAvis.length ? (
            <ul className="space-y-1 text-sm">{data.previousAvis.map((a, i) => <li key={i}>{frDate(a.date)} · {AVIS_TYPE_LABELS[a.type] ?? a.type}{a.restrictions ? ` — ${a.restrictions}` : ""}</li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">Aucun avis précédent.</p>}
        </Block>
        <Block title="Questions suggérées · brouillon IA">
          {data.questions ? (
            <>
              <textarea aria-label="Questions" rows={6} value={q} onChange={(e) => { setQ(e.target.value); setSaved(""); }}
                onBlur={async () => { try { await save({ data: { visitId, text: q } }); setSaved("ok"); } catch { setSaved("err"); } }}
                className="w-full rounded-md border border-input bg-background p-2 text-sm" />
              <p className="text-xs text-muted-foreground">{saved === "ok" ? "Enregistré" : saved === "err" ? "Échec, réessayez" : "Modifiable · issues des points manquants"}</p>
            </>
          ) : (
            <EmptyState text="Pas encore de questions." action={<Button size="sm" disabled={busy} onClick={() => run(() => gen({ data: { visitId } }), "Questions proposées")}>Proposer 3 à 5 questions</Button>} />
          )}
        </Block>
      </div>

      <Block title="Issue de la visite">
        {v.status === "PLANIFIEE" ? (
          data.canEnterOutcome ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => outcome({ data: { visitId, avisType: avisType as any, restrictions: restrictions || null } }), "Avis et courrier préparés, à valider"); }}>
              <div className="flex flex-wrap gap-4 text-sm">
                {Object.entries(AVIS_TYPE_LABELS).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-2"><input type="radio" name="avis" checked={avisType === k} onChange={() => setAvisType(k)} />{l}</label>
                ))}
              </div>
              <textarea aria-label="Restrictions pour l'employeur" rows={3} maxLength={1000} value={restrictions} onChange={(e) => setRestrictions(e.target.value)}
                placeholder="Restrictions et aménagements en mots simples pour l'employeur (aucune information médicale). Ex. : pas de port de charges de plus de 10 kg pendant 1 mois."
                className="w-full rounded-md border border-input bg-background p-2 text-sm" />
              <Button type="submit" disabled={busy}>Enregistrer l'issue</Button>
            </form>
          ) : <p className="text-sm text-muted-foreground">Seul le médecin du travail peut saisir l'issue de la visite.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">Avis : <strong>{AVIS_TYPE_LABELS[v.avisType ?? ""]}</strong>{v.restrictions ? ` — ${v.restrictions}` : ""}</p>
            {data.outcomeDrafts.map((d) => (
              <div key={d.id} className="rounded-md border border-border p-3 text-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{d.kind === "AVIS_VISITE" ? "Avis pour l'employeur" : "Courrier à l'employeur"} · modèle fixe</span>
                  <StatusBadge tone={d.status === "APPROVED" ? "done" : "info"}>{d.status === "APPROVED" ? "Validé" : d.status === "REJECTED" ? "Rejeté" : "À valider"}</StatusBadge>
                </div>
                <pre className="whitespace-pre-wrap font-sans">{d.text}</pre>
                {d.status === "DRAFT" && data.canEnterOutcome && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => run(() => review({ data: { draftId: d.id, status: "APPROVED" } }), "Validé")}>Valider</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => review({ data: { draftId: d.id, status: "REJECTED" } }), "Rejeté")}>Rejeter</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}
