import { Link } from "@tanstack/react-router";
import { CalendarClock, ListChecks } from "lucide-react";
import { DeadlineBadge, EmptyState, frDate } from "@/components/kit";

type AgendaItem = { date: string; caseId: string; worker: string; company: string; label: string; kind: "ECHEANCE" | "PLAN" | "VISITE"; code: string; visit: boolean; overdue: boolean; visitId?: string };

const dayLabel = (d: string, today: string) => {
  if (d < today) return "En retard";
  if (d === today) return "Aujourd'hui";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
};

/** Items grouped by day; overdue items collapse into one "En retard" group. */
export function AgendaList({ items, today, empty, emptyAction }: { items: AgendaItem[]; today: string; empty: string; emptyAction?: React.ReactNode }) {
  if (!items.length) return <EmptyState text={empty} action={emptyAction} />;
  const groups = new Map<string, AgendaItem[]>();
  for (const i of items) {
    const k = i.date < today ? "0-late" : i.date;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  return (
    <div className="space-y-8">
      {[...groups].map(([k, rows]) => (
        <section key={k} className="space-y-2">
          <h2 className="text-sm font-semibold capitalize text-muted-foreground">{k === "0-late" ? "En retard" : dayLabel(k, today)} <span className="font-normal">· {rows.length}</span></h2>
          <div className="panel divide-y divide-border">
            {rows.map((r, i) => (
              <Link key={`${r.caseId}-${r.code}-${i}`} to={r.visitId ? "/visite/$visitId" : "/dossiers/$caseId"} params={r.visitId ? { visitId: r.visitId } : { caseId: r.caseId }} className="flex flex-wrap items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/60">
                {r.kind === "PLAN" ? <ListChecks className="h-4 w-4 text-primary" aria-hidden /> : <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />}
                <div className="min-w-48 flex-1">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.worker} · {r.company}{r.kind === "ECHEANCE" ? " · à valider juridiquement" : r.kind === "VISITE" ? " · rendez-vous réservé · Préparer la visite" : " · plan de retour"}</p>
                </div>
                <DeadlineBadge due={r.date} overdue={r.overdue}>{r.overdue ? `En retard · ${frDate(r.date)}` : frDate(r.date)}</DeadlineBadge>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
