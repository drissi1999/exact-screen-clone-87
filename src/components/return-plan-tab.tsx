import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { completeReturnPlanTask, createReturnPlan, getReturnPlan, setReturnDate, updateReturnPlan } from "@/lib/return-plan.functions";
import { OUTCOME_LABELS, OWNER_LABELS, PARTNERS, SCENARIO_LABELS, STATUS_LABELS, type Outcome, type Scenario } from "@/lib/plan-templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const fr = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR") : "—");
const field = "rounded-md border border-input bg-background px-2 py-1 text-sm";

export function ReturnPlanTab({ caseId, documents, canEdit }: { caseId: string; documents: { id: string; filename: string }[]; canEdit: boolean }) {
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
    if (!canEdit) return <p className="panel p-4 text-sm text-muted-foreground">Aucun plan de retour pour ce dossier.</p>;
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
          <Badge variant="outline">{STATUS_LABELS[plan.status]}</Badge>
          <Badge variant="secondary">Partagé cellule PDP</Badge>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">Reprise visée</span>
              <input type="date" className={field} defaultValue={plan.targetDate} key={plan.targetDate} onBlur={(e) => e.target.value && e.target.value !== plan.targetDate && run(() => fUpdate({ data: { caseId, targetDate: e.target.value } }), "Date déplacée, jalons recalculés")} />
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
                <input type="date" className={field} onBlur={(e) => e.target.value && run(() => fReturn({ data: { caseId, date: e.target.value } }), "Reprise enregistrée, suivis J+7 / J+30 / J+90 créés")} />
              )}
            </label>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Reprise visée le {fr(plan.targetDate)}{plan.actualReturnDate ? ` · reprise effective le ${fr(plan.actualReturnDate)}` : ""}</p>
        )}
        <Textarea defaultValue={plan.notes} placeholder="Notes du plan (pas d'information médicale)" disabled={!canEdit} onBlur={(e) => e.target.value !== plan.notes && run(() => fUpdate({ data: { caseId, notes: e.target.value } }), "Notes enregistrées")} />
      </div>

      <div className="panel space-y-2 p-4">
        <h3 className="text-sm font-medium">Partenaires externes</h3>
        {plan.partners.length === 0 && <p className="text-sm text-muted-foreground">Aucun partenaire.</p>}
        {plan.partners.map((p, i) => (
          <div key={`${p.label}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-48">{p.label}</span>
            <input className={`${field} flex-1`} placeholder="Contact (nom, téléphone, email)" defaultValue={p.contact} disabled={!canEdit}
              onBlur={(e) => e.target.value !== p.contact && run(() => fUpdate({ data: { caseId, partners: plan.partners.map((q, j) => (j === i ? { ...q, contact: e.target.value } : q)) } }), "Contact enregistré")} />
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
              <p className="font-medium">{t.title}{t.kind === "FOLLOWUP" && <Badge variant="outline" className="ml-2">Suivi</Badge>}</p>
              <p className="text-xs text-muted-foreground">
                {t.partner_label ?? OWNER_LABELS[t.owner_role as keyof typeof OWNER_LABELS]} · {t.due_end ? `du ${fr(t.due_date)} au ${fr(t.due_end)}` : fr(t.due_date)}
                {t.requires_document ? " · document requis" : ""}
                {(t.owner_role === "EMPLOYER_HR" || t.owner_role === "WORKER") ? " · visible dans son espace" : ""}
              </p>
            </div>
            {t.status === "DONE" ? (
              <Badge variant={t.outcome && t.outcome !== "MAINTENU" ? "destructive" : "secondary"}>Terminé{t.outcome ? ` — ${OUTCOME_LABELS[t.outcome as Outcome]}` : ""}</Badge>
            ) : canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                {t.requires_document && (
                  <select className={field} value={docFor[t.id] ?? ""} onChange={(e) => setDocFor({ ...docFor, [t.id]: e.target.value })}>
                    <option value="">Document…</option>
                    {documents.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
                  </select>
                )}
                {t.kind === "FOLLOWUP" && (
                  <select className={field} value={outcomeFor[t.id] ?? ""} onChange={(e) => setOutcomeFor({ ...outcomeFor, [t.id]: e.target.value as Outcome })}>
                    <option value="">Résultat…</option>
                    {Object.entries(OUTCOME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                )}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => fDone({ data: { taskId: t.id, documentId: docFor[t.id] || null, outcome: outcomeFor[t.id] ?? null } }), "Tâche terminée")}>Terminer</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
