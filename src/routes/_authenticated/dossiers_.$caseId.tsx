import { UPLOAD_ACCEPT } from "@/lib/file-signature";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeDocument,
  generateEmployerNotice,
  generateSummary,
  getCaseDetail,
  getDocumentUrl,
  getMe,
  planCoordination,
  registerDocument,
  reviewDraft,
  reviewEvent,
  updateTask,
  lowerDocumentConfidentiality,
  releaseDocument,
  updateCaseLegalFacts,
  addAvis,
} from "@/lib/cases.functions";
import { createWorkerLink } from "@/lib/portal.functions";
import { LEGAL_CHECK_LABEL, ROLE_LABELS, episodes, episodeDuration } from "@/lib/rules";
import { getReturnPlan } from "@/lib/return-plan.functions";
import { ConfLabel, CONF_TEXT, DeadlineBadge, EmptyState, PriorityIndicator, ReviewBadge, StatusBadge } from "@/components/kit";
import { FileText, ListChecks, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ReturnPlanTab } from "@/components/return-plan-tab";

export const Route = createFileRoute("/_authenticated/dossiers_/$caseId")({
  head: () => ({
    meta: [
      { title: "Dossier — Reprise" },
      { name: "description", content: "Dossier de maintien en emploi : chronologie sourcée, documents, brouillons et coordination." },
      { property: "og:title", content: "Dossier — Reprise" },
      { property: "og:description", content: "Dossier de maintien en emploi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CasePage,
});

const ORIGIN: Record<string, string> = { MALADIE: "Maladie", AT: "Accident du travail", MP: "Maladie professionnelle" };
const DEADLINE_STATUS: Record<string, { label: string; v: "default" | "secondary" | "destructive" | "outline" }> = {
  A_VENIR: { label: "À venir", v: "outline" },
  EN_COURS: { label: "En cours", v: "default" },
  DEPASSEE: { label: "Dépassée", v: "destructive" },
  INFO: { label: "Dès la reprise connue", v: "secondary" },
};
const TASK_STATUS: Record<string, string> = { PENDING: "À envoyer", SENT: "Envoyé", ESCALATED: "Escaladé", DONE: "Terminé" };
const RECIPIENT: Record<string, string> = { WORKER: "Salarié", EMPLOYER_HR: "Employeur", PDP_COORDINATOR: "Cellule PDP" };
const fr = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR") : "—");

const AVIS_LABELS: Record<string, string> = { APTITUDE: "Avis d'aptitude", APTITUDE_AMENAGEMENTS: "Aptitude avec aménagements", INAPTITUDE: "Avis d'inaptitude" };

function ConfBadge({ level }: { level: string }) {
  return <ConfLabel level={level} />;
}
const DOC_TYPES: Record<string, string> = {
  CERTIFICAT_MEDICAL: "Certificat médical", COMPTE_RENDU: "Compte rendu", ARRET_TRAVAIL: "Arrêt de travail", FICHE_POSTE: "Fiche de poste",
  COURRIER: "Courrier", DECLARATION_AT: "Déclaration d'accident", AVIS: "Avis", AUTRE: "Autre document",
};
const ANALYSIS: Record<string, string> = { PENDING: "en attente d'analyse", PROCESSING: "analyse en cours", DONE: "analysé", FAILED: "échec de l'analyse", ERROR: "échec de l'analyse" };
const CHANNEL: Record<string, string> = { SMS: "SMS", EMAIL: "E-mail", PORTAL: "Espace en ligne" };
const AUDIT: Record<string, string> = {
  READ: "Consultation d'une pièce médicale", AVIS_CREATE: "Saisie d'un avis", PLAN_ALERT_ACK: "Alerte de suivi prise en charge",
  PLAN_TASK_ON_BEHALF: "Tâche faite pour le compte de l'employeur ou du salarié", WORKER_LINK: "Lien salarié envoyé",
  DOCUMENT_RELEASE: "Document publié", CONFIDENTIALITY_LOWER: "Niveau de confidentialité abaissé",
};

function CasePage() {
  const { caseId } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getCaseDetail);
  const fetchMe = useServerFn(getMe);
  const { data, isLoading, error } = useQuery({ queryKey: ["case", caseId], queryFn: () => fetchDetail({ data: { caseId } }) });
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => fetchMe() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["case", caseId] });

  const register = useServerFn(registerDocument);
  const analyze = useServerFn(analyzeDocument);
  const docUrl = useServerFn(getDocumentUrl);
  const evReview = useServerFn(reviewEvent);
  const summary = useServerFn(generateSummary);
  const notice = useServerFn(generateEmployerNotice);
  const drReview = useServerFn(reviewDraft);
  const plan = useServerFn(planCoordination);
  const task = useServerFn(updateTask);
  const lowerConf = useServerFn(lowerDocumentConfidentiality);
  const release = useServerFn(releaseDocument);
  const saveFacts = useServerFn(updateCaseLegalFacts);
  const saveAvis = useServerFn(addAvis);
  const [avisType, setAvisType] = useState("INAPTITUDE");
  const [avisDate, setAvisDate] = useState("");
  const workerLink = useServerFn(createWorkerLink);

  const [busy, setBusy] = useState<string | null>(null);
  const [conf, setConf] = useState("MEDICAL");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [workerUrl, setWorkerUrl] = useState<string | null>(null);
  const [tab, setTab] = useState("plan");
  const goTab = (t: string) => { setTab(t); setTimeout(() => document.getElementById("onglets")?.scrollIntoView({ behavior: "smooth" }), 50); };
  const fetchPlan = useServerFn(getReturnPlan);
  const { data: planData } = useQuery({ queryKey: ["plan", caseId], queryFn: () => fetchPlan({ data: { caseId } }) });
  const { data: risk } = useQuery({
    queryKey: ["risk", caseId],
    queryFn: async () => (await supabase.from("case_risk_scores" as any).select("score, factors").eq("case_id", caseId).maybeSingle()).data as { score: number; factors: { libelle: string; points: number }[] } | null,
  });
  const { data: journal } = useQuery({
    queryKey: ["journal", caseId],
    queryFn: async () => (await supabase.from("audit_log").select("id, action, created_at").eq("case_id", caseId).order("created_at", { ascending: false }).limit(50)).data ?? [],
  });

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function uploadForPlan(file: File): Promise<string | null> {
    let newId: string | null = null;
    await run("upload", async () => { newId = await storeDocument(file); }, "Document importé");
    qc.invalidateQueries({ queryKey: ["plan", caseId] });
    return newId;
  }

  async function storeDocument(file: File): Promise<string> {
    const { data: prof } = await supabase.from("profiles").select("tenant_id").maybeSingle();
    if (!prof) throw new Error("Profil introuvable");
    const path = `${prof.tenant_id}/${caseId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error: upErr } = await supabase.storage.from("case-documents").upload(path, file, { contentType: file.type });
    if (upErr) throw new Error(upErr.message);
    const { id } = await register({ data: { caseId, filename: file.name, storagePath: path, mimeType: file.type || "application/octet-stream", confidentiality: "PDP_SHARED" as any } });
    analyze({ data: { documentId: id } }).then(() => refresh()).catch(() => undefined);
    return id;
  }

  async function upload(file: File) {
    await run("upload", async () => {
      const { data: prof } = await supabase.from("profiles").select("tenant_id").maybeSingle();
      if (!prof) throw new Error("Profil introuvable");
      const path = `${prof.tenant_id}/${caseId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("case-documents").upload(path, file, { contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const { id } = await register({ data: { caseId, filename: file.name, storagePath: path, mimeType: file.type || "application/octet-stream", confidentiality: conf as any } });
      toast.message("Document déposé, analyse en cours…");
      const r = await analyze({ data: { documentId: id } });
      toast.success(`Analyse terminée : ${r.events} fait(s) ajouté(s) à la chronologie`);
    });
  }

  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">Dossier introuvable ou accès refusé.</p>;
  const docName = (id: string | null) => data.documents.find((d) => d.id === id)?.filename ?? "source non accessible";
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
  const eps = episodes(data.stoppages as any);
  const cur = eps.at(-1);
  const daysOff = cur ? episodeDuration(cur, today) : null;
  const dated = data.deadlines.filter((d) => d.due && d.status !== "INFO").sort((a, b) => a.due!.localeCompare(b.due!));
  const next = dated.find((d) => d.status !== "DEPASSEE") ?? dated[0] ?? null;
  const topFactor = risk?.factors?.length ? [...risk.factors].sort((a: any, b: any) => b.points - a.points)[0] : null;
  const drafts = data.events.filter((e) => e.status === "DRAFT").length;
  const steps = [
    ...data.deadlines.filter((d) => d.due && d.status !== "INFO").map((d) => ({ key: `d-${d.code}`, date: d.due!, label: d.label, kind: "deadline" as const, overdue: d.status === "DEPASSEE", who: LEGAL_CHECK_LABEL })),
    ...((planData?.tasks ?? []) as any[]).filter((t) => t.status === "TODO" && !(t.kind === "MILESTONE" && String(t.code).startsWith("POINT_"))).map((t) => ({ key: `t-${t.id}`, date: t.due_date as string, label: t.title as string, kind: "plan" as const, overdue: t.due_date < today, who: "Plan de retour" })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const mainAction = drafts > 0
    ? { label: `Valider la chronologie (${drafts})`, onClick: () => document.getElementById("chronologie")?.scrollIntoView({ behavior: "smooth" }) }
    : !planData?.plan
      ? { label: "Créer le plan de retour", onClick: () => goTab("plan") }
      : { label: "Planifier les relances", onClick: () => run("plan", async () => { const r = await plan({ data: { caseId } }); toast.success(`${r.created} action(s) planifiée(s)`); }) };

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Link to="/dossiers" className="text-sm text-muted-foreground hover:text-foreground">← Dossiers</Link>
        <div className="panel p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{data.case.worker}</h1>
              <p className="text-sm text-muted-foreground">{data.case.company} · {data.case.jobTitle ?? "Poste non renseigné"} · {ORIGIN[data.case.origin ?? ""] ?? "Origine inconnue"}</p>
            </div>
            <Button disabled={!!busy} onClick={mainAction.onClick}>{mainAction.label}</Button>
          </div>
          <dl className="mt-6 grid gap-6 border-t border-border pt-5 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Arrêt continu</dt>
              <dd className="mt-1 text-lg font-semibold">{daysOff != null ? `${daysOff} jour${daysOff > 1 ? "s" : ""}` : "—"}{cur && cur.end && cur.end < today ? <span className="ml-2 text-xs font-normal text-muted-foreground">terminé le {fr(cur.end)}</span> : null}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Prochaine échéance</dt>
              <dd className="mt-1 space-y-1">{next ? <><p className="text-sm font-medium">{next.label}</p><DeadlineBadge due={next.due} overdue={next.status === "DEPASSEE"} /></> : <p className="text-sm text-muted-foreground">Aucune</p>}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Indicateur de priorité</dt>
              <dd className="mt-1">{risk ? <><PriorityIndicator score={risk.score} />{topFactor && <p className="mt-1 text-xs text-muted-foreground">+{topFactor.points} {topFactor.libelle}</p>}</> : <p className="text-sm text-muted-foreground">Calculé à l'ouverture de « Ma journée »</p>}</dd>
            </div>
          </dl>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Prochaines étapes <span className="font-normal">· {steps.length}</span></h2>
        {steps.length === 0 ? (
          <EmptyState text="Aucune étape datée pour ce dossier." action={!planData?.plan ? <Button size="sm" variant="outline" onClick={() => goTab("plan")}>Créer le plan de retour</Button> : undefined} />
        ) : (
          <ul className="panel divide-y divide-border">
            {steps.slice(0, 8).map((st) => (
              <li key={st.key} className="flex flex-wrap items-center gap-4 px-5 py-3">
                {st.kind === "plan" ? <ListChecks className="h-4 w-4 text-primary" aria-hidden /> : <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />}
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{st.label}</p>
                  <p className="text-xs text-muted-foreground">{st.who}</p>
                </div>
                <DeadlineBadge due={st.date} overdue={st.overdue} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="chronologie" className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Chronologie <span className="font-normal">· {data.events.length}</span></h2>
        {data.events.length === 0 && <EmptyState text="La chronologie se construit à partir des documents du dossier." action={<Button size="sm" variant="outline" onClick={() => goTab("documents")}>Déposer un document</Button>} />}
        {data.events.length > 0 && (
          <ol className="panel divide-y divide-border">
            {data.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="flex gap-4">
                  <span className="w-20 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{e.event_date ? fr(e.event_date) : "Date à vérifier"}</span>
                  <div className="space-y-2">
                    <p className="text-sm">{e.label}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      {e.source_document_id ? (
                        <button className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-foreground hover:border-primary/40"
                          onClick={() => run(e.id, async () => { const { url } = await docUrl({ data: { documentId: e.source_document_id! } }); if (url) window.open(url, "_blank"); })}>
                          <FileText className="h-3 w-3" aria-hidden />{docName(e.source_document_id)} · p. {e.source_page ?? "?"}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground"><ListChecks className="h-3 w-3" aria-hidden />Plan de retour / saisie du service</span>
                      )}
                      <ConfBadge level={e.confidentiality} />
                      <ReviewBadge status={e.status} />
                    </div>
                  </div>
                </div>
                {e.status === "DRAFT" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(e.id, () => evReview({ data: { eventId: e.id, status: "APPROVED" } }))}>Valider</Button>
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(e.id, () => evReview({ data: { eventId: e.id, status: "REJECTED" } }))}>Rejeter</Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <Tabs value={tab} onValueChange={setTab} id="onglets">
        <TabsList>
          <TabsTrigger value="plan">Plan de retour</TabsTrigger>
          <TabsTrigger value="echeances">Échéances et arrêts</TabsTrigger>
          <TabsTrigger value="documents">Documents ({data.documents.length})</TabsTrigger>
          <TabsTrigger value="brouillons">Brouillons ({data.drafts.length})</TabsTrigger>
          <TabsTrigger value="messages">Messages ({data.tasks.length})</TabsTrigger>
          <TabsTrigger value="journal">Journal</TabsTrigger>
        </TabsList>

        <TabsContent value="plan">
          <ReturnPlanTab caseId={caseId} documents={data.documents} onUpload={uploadForPlan} canEdit={!!me?.roles.some((r) => ["PDP_COORDINATOR", "IDEST", "MEDECIN_TRAVAIL"].includes(r))} />
        </TabsContent>

<TabsContent value="echeances" className="space-y-4">
          <div className="panel p-4">
            <h2 className="mb-2 font-medium">Arrêts</h2>
            <ul className="space-y-1 text-sm">
              {data.stoppages.map((s, i) => (
                <li key={i}>{s.kind === "INITIAL" ? "Initial" : "Prolongation"} · {ORIGIN[s.origin]} · du {fr(s.start_date)} au {s.end_date ? fr(s.end_date) : "en cours"}</li>
              ))}
            </ul>
          </div>
          <div className="panel divide-y divide-border">
            {data.deadlines.length === 0 && <p className="p-4 text-sm text-muted-foreground">Aucune échéance réglementaire applicable.</p>}
            {data.deadlines.map((d) => (
              <div key={d.code} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{d.label}</p>
                  <p className="text-xs text-muted-foreground">{d.legalRef} · à partir du {fr(d.from)} · limite {fr(d.due)}</p>
                </div>
                <div className="flex gap-2">
                  <StatusBadge>{LEGAL_CHECK_LABEL}</StatusBadge>
                  {d.due ? <DeadlineBadge due={d.due} overdue={d.status === "DEPASSEE"} /> : <StatusBadge>{DEADLINE_STATUS[d.status]!.label}</StatusBadge>}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Échéances calculées par le moteur de règles, à titre indicatif : chaque règle reste {LEGAL_CHECK_LABEL}.</p>
          <div className="panel space-y-3 p-4">
            <h2 className="font-medium">Informations pour le calcul des échéances</h2>
            <form
              className="flex flex-wrap items-end gap-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const known = String(fd.get("known") || "");
                run("facts", () => saveFacts({ data: { caseId, employerKnownAt: known || null, cpamInvestigation: fd.get("cpam") === "on" } }), "Informations enregistrées");
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Date de connaissance de l'accident par l'employeur</span>
                <input name="known" type="date" defaultValue={data.facts.employerKnownAt ?? ""} className="rounded-md border border-input bg-background px-2 py-1" />
              </label>
              <label className="flex items-center gap-2">
                <input name="cpam" type="checkbox" defaultChecked={data.facts.cpamInvestigation} /> Investigation CPAM en cours
              </label>
              <Button size="sm" type="submit" disabled={!!busy}>Enregistrer</Button>
            </form>
            <p className="text-xs text-muted-foreground">Sans date saisie, la déclaration AT est calculée depuis le début de l'arrêt.</p>
            <div className="border-t border-border pt-3 text-sm">
              <p className="mb-2">Dernier avis : {data.facts.avis ? `${AVIS_LABELS[data.facts.avis.type]} du ${fr(data.facts.avis.date)}` : "aucun"}</p>
              <div className="flex flex-wrap items-end gap-3">
                <select value={avisType} onChange={(e) => setAvisType(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1">
                  {Object.entries(AVIS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input type="date" value={avisDate} onChange={(e) => setAvisDate(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1" />
                <Button size="sm" variant="outline" disabled={!!busy || !avisDate} title="Réservé au médecin du travail" onClick={() => run("avis", () => saveAvis({ data: { caseId, type: avisType as any, date: avisDate } }), "Avis enregistré")}>Saisir l'avis</Button>
              </div>
            </div>
          </div>
        </TabsContent>

<TabsContent value="documents" className="space-y-4">
          <div className="panel flex flex-wrap items-center gap-3 p-4">
            <label className="text-sm">Confidentialité :</label>
            <select className="rounded-md border border-input bg-background px-2 py-1 text-sm" value={conf} onChange={(e) => setConf(e.target.value)}>
              {Object.entries(CONF_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input type="file" accept={UPLOAD_ACCEPT} disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} className="text-sm" />
            {busy === "upload" && <span className="text-sm text-muted-foreground">Dépôt et analyse (OCR, classification, chronologie)…</span>}
          </div>
          <div className="panel divide-y divide-border">
            {data.documents.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Aucun document pour ce dossier. Déposez le premier ci-dessus.</p>}
            {data.documents.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="text-sm font-medium">{d.filename}</p>
                  <p className="text-xs text-muted-foreground">{DOC_TYPES[d.doc_type] ?? "Document"} · {d.page_count ?? "?"} page(s) · {ANALYSIS[d.analysis_status] ?? "analyse à vérifier"} · reçu le {fr(d.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <ConfBadge level={d.confidentiality} />
                  <Button size="sm" variant="outline" onClick={() => run(d.id, async () => { const { url } = await docUrl({ data: { documentId: d.id } }); if (url) window.open(url, "_blank"); })}>Ouvrir</Button>
                  {d.analysis_status !== "DONE" && <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(d.id, () => analyze({ data: { documentId: d.id } }), "Analyse terminée")}>Analyser</Button>}
                  {(d.confidentiality === "EMPLOYER_VISIBLE" || d.confidentiality === "WORKER_VISIBLE") && d.source !== "EMPLOYER" && d.source !== "WORKER" && (d.released_at
                    ? <StatusBadge tone="done">Publié le {fr(d.released_at)}</StatusBadge>
                    : <Button size="sm" variant="outline" disabled={!!busy || d.analysis_status !== "DONE"} title={d.analysis_status !== "DONE" ? "Analyse requise avant publication" : "Réservé au médecin du travail et à l'IDEST, tracé"} onClick={() => run(d.id, () => release({ data: { documentId: d.id } }), "Document publié")}>{d.confidentiality === "EMPLOYER_VISIBLE" ? "Publier à l'employeur" : "Publier au salarié"}</Button>)}
                  {d.confidentiality === "MEDICAL" && <Button size="sm" variant="ghost" disabled={!!busy} title="Réservé au médecin du travail, tracé" onClick={() => { if (confirm("Abaisser ce document en « Partagé PDP » ? Action réservée au médecin du travail et tracée.")) run(d.id, () => lowerConf({ data: { documentId: d.id, level: "PDP_SHARED" } }), "Niveau abaissé"); }}>Abaisser</Button>}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

<TabsContent value="brouillons" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!busy} onClick={() => run("sum", async () => { const r = await summary({ data: { caseId } }); if (!r.ok) toast.warning(r.reason); else toast.success(r.reason || "Synthèse générée (brouillon)"); })}>{busy === "sum" ? "Génération…" : "Générer la synthèse IA"}</Button>
            <Button variant="outline" disabled={!!busy} onClick={() => run("notice", () => notice({ data: { caseId } }), "Courrier employeur préparé")}>Préparer le courrier employeur</Button>
          </div>
          <p className="text-xs text-muted-foreground">Tout contenu généré reste un brouillon jusqu'à validation par le rôle requis. Le courrier employeur est produit depuis un modèle sans aucune donnée médicale.</p>
          {data.drafts.map((d) => (
            <div key={d.id} className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{d.kind === "SYNTHESE" ? "Synthèse du dossier" : "Courrier employeur"}</p>
                <ConfBadge level={d.confidentiality} />
                {d.status === "APPROVED" ? <StatusBadge tone="done">Validé le {fr(d.approved_at)}</StatusBadge> : <ReviewBadge status={d.status} />}
                <span className="text-xs text-muted-foreground">Validation : {ROLE_LABELS[d.required_role]}</span>
              </div>
              {d.status === "DRAFT" ? (
                <>
                  <Textarea rows={10} value={edits[d.id] ?? d.draft_text} onChange={(e) => setEdits({ ...edits, [d.id]: e.target.value })} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!!busy} onClick={() => run(d.id, () => drReview({ data: { draftId: d.id, status: "APPROVED", text: edits[d.id] ?? d.draft_text } }), "Document validé")}>Valider</Button>
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(d.id, () => drReview({ data: { draftId: d.id, status: "REJECTED" } }))}>Rejeter</Button>
                  </div>
                </>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm">{d.approved_text ?? d.draft_text}</pre>
              )}
            </div>
          ))}
        </TabsContent>

<TabsContent value="messages" className="space-y-4">
          <Button variant="outline" className="mr-2" disabled={!!busy} onClick={() => run("wlink", async () => { const r = await workerLink({ data: { caseId, origin: window.location.origin } }); setWorkerUrl(r.link); }, "Lien salarié envoyé (simulé)")}>Envoyer le lien salarié</Button>
          {workerUrl && (
            <div className="panel space-y-1 p-3 text-sm">
              <p className="font-medium">Lien salarié (affiché une seule fois, non conservé) :</p>
              <code className="block break-all text-xs">{workerUrl}</code>
            </div>
          )}
          <Button disabled={!!busy} onClick={() => run("plan", async () => { const r = await plan({ data: { caseId } }); toast.success(`${r.created} action(s) planifiée(s)`); })}>Planifier les relances</Button>
          <p className="text-xs text-muted-foreground">L'agent de coordination prépare les relances (pièces manquantes, rendez-vous, échéances) sans jamais donner de conseil médical. Aucun service SMS/email n'est encore connecté : « Envoyer » marque la relance comme envoyée.</p>
          {data.tasks.map((t) => (
            <div key={t.id} className="panel space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">{CHANNEL[t.channel] ?? "Message"}</StatusBadge>
                <span className="text-sm font-medium">→ {RECIPIENT[t.recipient] ?? "Destinataire"}</span>
                <StatusBadge tone={t.status === "DONE" || t.status === "SENT" ? "done" : "neutral"}>{TASK_STATUS[t.status] ?? "À envoyer"}</StatusBadge>
                {t.due_at && <span className="text-xs text-muted-foreground">échéance {fr(t.due_at)}</span>}
              </div>
              <p className="text-sm">{t.message}</p>
              {t.escalated_reason && <p className="text-xs text-destructive">{t.escalated_reason}</p>}
              {(t.status === "PENDING" || t.status === "SENT") && (
                <div className="flex gap-2">
                  {t.status === "PENDING" && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(t.id, () => task({ data: { taskId: t.id, action: "SEND" } }), "Relance envoyée")}>Envoyer</Button>}
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(t.id, () => task({ data: { taskId: t.id, action: "ESCALATE", reason: "Escalade vers un humain" } }))}>Escalader</Button>
                  <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(t.id, () => task({ data: { taskId: t.id, action: "DONE" } }))}>Terminé</Button>
                </div>
              )}
            </div>
          ))}
        </TabsContent>

        <TabsContent value="journal">
          {(journal ?? []).length === 0 ? (
            <EmptyState text="Le journal d'accès est réservé au médecin du travail et à l'administrateur du service." />
          ) : (
            <ul className="panel divide-y divide-border">
              {journal!.map((j: any) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>{AUDIT[j.action] ?? "Action tracée"}</span>
                  <span className="text-xs text-muted-foreground">{new Date(j.created_at).toLocaleString("fr-FR")}</span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
