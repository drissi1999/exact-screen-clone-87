import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { getMyDay } from "@/lib/my-day.functions";
import { planCoordination } from "@/lib/cases.functions";
import { acknowledgePlanAlert } from "@/lib/return-plan.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DeadlineBadge, EmptyState, PriorityIndicator } from "@/components/kit";

export const Route = createFileRoute("/_authenticated/ma-journee")({
  head: () => ({
    meta: [
      { title: "Ma journée — Reprise" },
      { name: "description", content: "Dossiers à traiter aujourd'hui : échéances, nouveaux dossiers, documents à valider et réponses reçues." },
      { property: "og:title", content: "Ma journée — Reprise" },
      { property: "og:description", content: "Dossiers à traiter aujourd'hui, triés par indicateur de priorité." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyDay,
});

const GROUPS = [
  ["PLAN_ALERTES", "Alertes suivi de reprise"],
  ["EN_RETARD", "En retard"],
  ["AUJOURDHUI", "Aujourd'hui"],
  ["SEMAINE", "Cette semaine"],
  ["NOUVEAUX", "Nouveaux dossiers"],
  ["DOCUMENTS", "Documents à valider"],
  ["REPONSES", "Réponses reçues"],
  ["PLAN_TACHES", "Tâches du plan de retour"],
] as const;
const ACTION_LABEL = { RDV_LIAISON: "Planifier le RDV de liaison", VALIDER: "Valider la chronologie", RELANCER: "Relancer", PUBLIER: "Publier", PLAN: "Ouvrir le plan de retour" } as const;
const ORIGINS: Record<string, string> = { MALADIE: "Maladie", AT: "Accident du travail", MP: "Maladie professionnelle" };
const fr = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR");

function MyDay() {
  const fetchDay = useServerFn(getMyDay);
  const plan = useServerFn(planCoordination);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["my-day"], queryFn: () => fetchDay() });
  const [company, setCompany] = useState("");
  const [origin, setOrigin] = useState("");
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const ack = useServerFn(acknowledgePlanAlert);
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [ackNote, setAckNote] = useState("");
  async function submitAck(ids: string[]) {
    if (ackNote.trim().length < 3) { toast.error("Une note est obligatoire"); return; }
    try {
      for (const taskId of ids) await ack({ data: { taskId, note: ackNote.trim() } });
      toast.success("Alerte prise en charge");
      setAckFor(null); setAckNote("");
      qc.invalidateQueries({ queryKey: ["my-day"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    return GROUPS.map(([key, label]) => ({
      key, label,
      rows: data.groups[key].filter((r) => (!company || r.companyId === company) && (!origin || r.origin === origin)),
    }));
  }, [data, company, origin]);
  const flat = useMemo(() => filtered.flatMap((g) => g.rows.map((r) => ({ g: g.key, r }))), [filtered]);
  const companies = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of Object.values(data?.groups ?? {})) for (const r of g) m.set(r.companyId, r.company);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const open = (caseId: string) => navigate({ to: "/dossiers/$caseId", params: { caseId } });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      if (e.key === "j") setCursor((c) => Math.min(c + 1, flat.length - 1));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "Enter" && flat[cursor]) open(flat[cursor]!.r.caseId);
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => { document.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" }); }, [cursor]);

  async function act(caseId: string, action: keyof typeof ACTION_LABEL) {
    if (action === "VALIDER" || action === "PUBLIER" || action === "PLAN") return open(caseId);
    setBusy(caseId);
    try {
      const r = await plan({ data: { caseId } });
      toast.success(r.created ? `${r.created} action(s) planifiée(s)` : "Rien de nouveau à planifier");
      qc.invalidateQueries({ queryKey: ["my-day"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <p className="text-muted-foreground">Chargement…</p>;
  if (error || !data) return <p className="text-destructive">Accès refusé.</p>;
  let idx = -1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Ma journée</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            {data.toHandleToday} dossier{data.toHandleToday > 1 ? "s" : ""} à traiter aujourd'hui
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">Raccourcis : j / k pour se déplacer, Entrée pour ouvrir le dossier.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Entreprise" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={company} onChange={(e) => { setCompany(e.target.value); setCursor(0); }}>
            <option value="">Toutes les entreprises</option>
            {companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select aria-label="Type de dossier" className="rounded-md border border-input bg-background px-2 py-1.5 text-sm" value={origin} onChange={(e) => { setOrigin(e.target.value); setCursor(0); }}>
            <option value="">Tous les types</option>
            {Object.entries(ORIGINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {filtered.map((g) => (
          <a key={g.key} href={`#${g.key}`} className="panel p-4 transition-colors hover:border-primary/40">
            <p className={cn("text-2xl font-semibold", (g.key === "EN_RETARD" || g.key === "PLAN_ALERTES") && g.rows.length > 0 && "text-destructive")}>{g.rows.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">{g.label}</p>
          </a>
        ))}
      </div>

      {filtered.every((g) => g.rows.length === 0) && <EmptyState text="Rien à traiter pour ces filtres." action={<Button size="sm" variant="outline" onClick={() => { setCompany(""); setOrigin(""); }}>Effacer les filtres</Button>} />}
      {filtered.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.key} id={g.key} className="space-y-3 pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground">{g.label} <span className="font-normal">· {g.rows.length}</span></h2>
          {g.rows.map((r) => {
            idx++;
            const i = idx;
            return (
              <div key={`${g.key}-${r.caseId}`} data-row={i} onClick={() => setCursor(i)}
                className={cn("panel flex flex-wrap items-center gap-6 px-5 py-4", cursor === i && "ring-2 ring-primary")}>
                <div className="min-w-48 flex-1">
                  <button className="font-medium hover:underline" onClick={() => open(r.caseId)}>{r.worker}</button>
                  <p className="text-sm text-muted-foreground">{r.company}{r.origin ? ` · ${ORIGINS[r.origin] ?? r.origin}` : ""}</p>
                  <p className="text-sm">{r.reason}</p>
                </div>
                <div className="w-48 text-sm">
                  {r.nextDeadline ? <><p className="truncate">{r.nextDeadline.label}</p><div className="mt-1"><DeadlineBadge due={r.nextDeadline.due} /></div><p className="mt-1 text-xs text-muted-foreground">à valider juridiquement</p></> : <p className="text-muted-foreground">Aucune échéance</p>}
                </div>
                <div className="w-56 text-sm">
                  <PriorityIndicator score={r.score} />
                  {r.topFactors.map((f) => <p key={f.libelle} className="mt-1 text-xs text-muted-foreground">+{f.points} {f.libelle}</p>)}
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" disabled={busy === r.caseId} onClick={() => act(r.caseId, r.action)}>{ACTION_LABEL[r.action]}</Button>
                  {r.alertTaskIds?.length ? <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setAckFor(ackFor === r.caseId ? null : r.caseId); setAckNote(""); }}>Pris en charge</Button> : null}
                </div>
                {ackFor === r.caseId && r.alertTaskIds && (
                  <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); submitAck(r.alertTaskIds!); }}>
                    <input autoFocus required minLength={3} maxLength={1000} value={ackNote} onChange={(e) => setAckNote(e.target.value)}
                      placeholder="Note obligatoire : ce qui a été fait (sans information médicale)" className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
                    <Button size="sm" type="submit">Valider</Button>
                  </form>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
