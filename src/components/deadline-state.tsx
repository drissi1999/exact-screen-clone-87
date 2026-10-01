/** Deadline status display + "Marquer comme fait" for legal obligations. */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DeadlineBadge, StatusBadge, frDate, todayIso } from "@/components/kit";
import { markDeadlineDoneFn } from "@/lib/deadlines.functions";
import { DONE_LABELS } from "@/lib/rules";

type D = { code: string; kind: string; status: string; due: string | null; doneOn?: string | null; plannedOn?: string | null };

export function DeadlineStatus({ d }: { d: D }) {
  if (d.status === "FAIT") return <StatusBadge tone="done">Fait le {frDate(d.doneOn)}</StatusBadge>;
  if (d.status === "PLANIFIEE") return <StatusBadge tone="done">Planifiée le {frDate(d.plannedOn)}</StatusBadge>;
  if (d.status === "NON_REALISE") return <StatusBadge>Non réalisé</StatusBadge>;
  if (d.status === "ECHUE") return <StatusBadge>Échue le {frDate(d.due)}</StatusBadge>;
  if (!d.due) return <StatusBadge>Dès la reprise connue</StatusBadge>;
  return <DeadlineBadge due={d.due} overdue={d.kind === "OBLIGATION" && d.status === "DEPASSEE"} />;
}

export const KIND_LABEL: Record<string, string> = { OBLIGATION: "Obligation", POSSIBILITE: "Possibilité", INFO: "Information" };
export function KindBadge({ kind }: { kind: string }) {
  if (kind === "OBLIGATION") return <span className="rounded-full border border-foreground/20 bg-card px-2 py-0.5 text-xs font-semibold text-foreground">Obligation</span>;
  if (kind === "PLAN") return <span className="rounded-full border border-primary/25 bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">Plan de retour</span>;
  return <span className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground">{KIND_LABEL[kind] ?? kind}</span>;
}

export function MarkDoneButton({ caseId, d, onDone, canEdit }: { caseId: string; d: D; onDone: () => void; canEdit: boolean }) {
  const mark = useServerFn(markDeadlineDoneFn);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  if (!canEdit || d.kind !== "OBLIGATION" || d.status === "FAIT") return null;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Marquer comme fait</Button>;
  return (
    <form className="flex items-center gap-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      try { await mark({ data: { caseId, code: d.code, doneOn: date } }); toast.success("Marqué comme fait"); setOpen(false); onDone(); }
      catch (err) { toast.error(err instanceof Error ? err.message : "Erreur"); }
      finally { setBusy(false); }
    }}>
      <label className="text-xs text-muted-foreground">{DONE_LABELS[d.code] ?? "Fait le"}</label>
      <input type="date" required max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-sm" />
      <Button size="sm" type="submit" disabled={busy}>Enregistrer</Button>
    </form>
  );
}
