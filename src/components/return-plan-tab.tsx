import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { completeReturnPlanTask, createReturnPlan, getReturnPlan, setReturnDate, updateReturnPlan } from "@/lib/return-plan.functions";
import { OUTCOME_LABELS, OWNER_LABELS, PARTNERS, SCENARIO_LABELS, STATUS_LABELS, type Outcome, type Scenario } from "@/lib/plan-templates";
import { StatusBadge, ConfLabel, DeadlineBadge, EmptyState } from "@/components/kit";
import { UPLOAD_ACCEPT } from "@/lib/file-signature";
import { Check, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const fr = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR") : "—");
const field = "rounded-md border border-input bg-background px-2 py-1 text-sm";

type SaveState = "saving" | "ok" | "err";
function Saved({ s }: { s?: SaveState }) {
  if (!s) return null;
  if (s === "saving") return <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Enregistrement…</span>;
  if (s === "ok") return <span className="inline-flex items-center gap-1 text-xs text-primary"><Check className="h-3 w-3" />Enregistré</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" />Échec, réessayez</span>;
}

export function ReturnPlanTab({ caseId, documents, canEdit, onUpload }: { caseId: string; documents: { id: string; filename: string }[]; canEdit: boolean; onUpload?: (f: File) => Promise<string | null> }) {
  const qc = useQueryClient();
  const fetchPlan = useServerFn(getReturnPlan);
  const fCreate = useServerFn(createReturnPlan);
  const fUpdate = useServerFn(updateReturnPlan);
  const fReturn = useServerFn(setReturnDate);
  const fDone = useServerFn(completeReturnPlanTask);
  const { data, isLoading } = useQuery({ queryKey: ["plan", caseId], queryFn: () => fetchPlan({ data: { caseId } }) });
  const [busy, setBusy] = useState(false);
  const [docFor, setDocFor] = useState<Record<string, string>>({});
  const [outcomeFor, setOutcomeFor] = useState<Record<string, Outcome>>({});
  const [noteFor, setNoteFor] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, SaveState>>({});

  /** Save-on-blur with a visible per-field confirmation. */
  async function save(key: string, fn: () => Promise<unknown>) {
    setSaved((s) => ({ ...s, [key]: "saving" }));
    try {
      await fn();
      setSaved((s) => ({ ...s, [key]: "ok" }));
      qc.invalidateQueries({ queryKey: ["plan", caseId] });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    } catch (e) {
      setSaved((s) => ({ ...s, [key]: "err" }));
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      qc.invalidateQueries({ queryKey: ["plan", caseId] });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Chargement…</p>;
  const plan = data?.plan;

  if (!plan) {
    if (!canEdit) return <EmptyState text="Aucun plan de retour pour ce dossier." />;
    return (
      <form
        className="panel flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(() => fCreate({ data: { caseId, targetDate: String(fd.get("target")), scenario: String(fd.get("scenario")) as Scenario, notes: String(fd.get("notes") || "") } }), "Plan de retour créé");
        }}
      >
        <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Date de reprise visée</span><input required name="target" type="date" className={field} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Scénario</span>
          <select name="scenario" className={field} defaultValue="POSTE_AMENAGE">{Object.entries(SCENARIO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Notes</span><input name="notes" className={field} /></label>
        <Button type="submit" size="sm" disabled={busy}>Créer le plan</Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Plan de retour — {SCENARIO_LABELS[plan.scenario]}</h2>
          <StatusBadge tone={plan.status === "TERMINE" ? "done" : "info"}>{STATUS_LABELS[plan.status]}</StatusBadge>
          <ConfLabel level="PDP_SHARED" />
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Reprise visée</span>
              <input type="date" className={field} defaultValue={plan.targetDate} key={plan.targetDate} onBlur={(e) => e.target.value && e.target.value !== plan.targetDate && save("target", () => fUpdate({ data: { caseId, targetDate: e.target.value } }))} />
              <Saved s={saved["target"]} />
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Scénario</span>
              <select className={field} value={plan.scenario} disabled={busy} onChange={(e) => run(() => fUpdate({ data: { caseId, scenario: e.target.value as Scenario } }), "Scénario changé")}>
                {Object.entries(SCENARIO_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Statut</span>
              <select className={field} value={plan.status} disabled={busy} onChange={(e) => run(() => fUpdate({ data: { caseId, status: e.target.value as any } }), "Statut mis à jour")}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Reprise effective</span>
              {plan.actualReturnDate ? <span className="py-1">{fr(plan.actualReturnDate)}</span> : (
                <input type="date" className={field} onBlur={(e) => e.target.value && save("actual", () => fReturn({ data: { caseId, date: e.target.value } }))} />
              )}
              <Saved s={saved["actual"]} />
            </label>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Reprise visée le {fr(plan.targetDate)}{plan.actualReturnDate ? ` · reprise effective le ${fr(plan.actualReturnDate)}` : ""}</p>
        )}
        <Textarea defaultValue={plan.notes} placeholder="Notes du plan (pas d'information médicale)" disabled={!canEdit} onBlur={(e) => e.target.value !== plan.notes && save("notes", () => fUpdate({ data: { caseId, notes: e.target.value } }))} />
        <Saved s={saved["notes"]} />
      </div>

      <div className="panel space-y-2 p-4">
        <h3 className="text-sm font-medium">Partenaires externes</h3>
        {plan.partners.length === 0 && <p className="text-sm text-muted-foreground">Aucun partenaire.</p>}
        {plan.partners.map((p, i) => (
          <div key={`${p.label}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-48">{p.label}</span>
            <input className={`${field} flex-1`} placeholder="Contact (nom, téléphone, email)" defaultValue={p.contact} disabled={!canEdit}
              onBlur={(e) => e.target.value !== p.contact && save(`partner-${i}`, () => fUpdate({ data: { caseId, partners: plan.partners.map((q, j) => (j === i ? { ...q, contact: e.target.value } : q)) } }))} />
            <Saved s={saved[`partner-${i}`]} />
          </div>
        ))}
        {canEdit && (
          <select className={field} value="" onChange={(e) => e.target.value && run(() => fUpdate({ data: { caseId, partners: [...plan.partners, { label: e.target.value, contact: "" }] } }), "Partenaire ajouté")}>
            <option value="">+ Ajouter un partenaire</option>
            {PARTNERS.filter((p) => !plan.partners.some((q) => q.label === p)).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>

      <div className="panel divide-y divide-border">
        {data!.tasks.map((t: any) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div>
              <p className="font-medium">{t.title}{t.kind === "FOLLOWUP" && <span className="ml-2"><StatusBadge>Suivi</StatusBadge></span>}</p>
              <p className="text-xs text-muted-foreground">
                {t.partner_label ?? OWNER_LABELS[t.owner_role as keyof typeof OWNER_LABELS]} · {t.due_end ? `du ${fr(t.due_date)} au ${fr(t.due_end)}` : fr(t.due_date)}
                {t.requires_document ? " · document requis" : ""}
                {(t.owner_role === "EMPLOYER_HR" || t.owner_role === "WORKER") ? " · visible dans son espace" : ""}
              </p>
              {t.on_behalf_note && <p className="text-xs text-primary">{t.on_behalf_note}</p>}
              {t.alert_ack_at && <p className="text-xs text-muted-foreground">Alerte prise en charge le {fr(t.alert_ack_at)} : {t.alert_ack_note}</p>}
            </div>
            {t.status === "DONE" ? (
              t.outcome && t.outcome !== "MAINTENU" ? <DeadlineBadge due={null} overdue>Terminé — {OUTCOME_LABELS[t.outcome as Outcome]}</DeadlineBadge> : <StatusBadge tone="done">Terminé{t.outcome ? ` — ${OUTCOME_LABELS[t.outcome as Outcome]}` : ""}</StatusBadge>
            ) : t.kind === "MILESTONE" && t.code.startsWith("POINT_") ? (
              <span className="text-xs text-muted-foreground">Recalculé à la reprise effective</span>
            ) : canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                {t.requires_document && documents.length > 0 && (
                  <select className={field} value={docFor[t.id] ?? ""} onChange={(e) => setDocFor({ ...docFor, [t.id]: e.target.value })}>
                    <option value="">Document…</option>
                    {documents.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                  </select>
                )}
                {t.requires_document && onUpload && (
                  <label className="cursor-pointer rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-muted">
                    Importer un document
                    <input type="file" className="hidden" accept={UPLOAD_ACCEPT} onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      const id = await onUpload(f);
                      if (id) setDocFor((m) => ({ ...m, [t.id]: id }));
                    }} />
                  </label>
                )}
                {(t.owner_role === "EMPLOYER_HR" || t.owner_role === "WORKER") && (
                  <input className={`${field} w-64`} placeholder={`Note obligatoire — pour le compte ${t.owner_role === "WORKER" ? "du salarié" : "de l'employeur"}`}
                    value={noteFor[t.id] ?? ""} onChange={(e) => setNoteFor({ ...noteFor, [t.id]: e.target.value })} maxLength={1000} />
                )}
                {t.kind === "FOLLOWUP" && (
                  <select className={field} value={outcomeFor[t.id] ?? ""} onChange={(e) => setOutcomeFor({ ...outcomeFor, [t.id]: e.target.value as Outcome })}>
                    <option value="">Résultat…</option>
                    {Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => fDone({ data: { taskId: t.id, documentId: docFor[t.id] || null, outcome: outcomeFor[t.id] ?? null, note: noteFor[t.id] || null } }), "Tâche terminée")}>{t.owner_role === "EMPLOYER_HR" || t.owner_role === "WORKER" ? "Faire pour son compte" : "Terminer"}</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
