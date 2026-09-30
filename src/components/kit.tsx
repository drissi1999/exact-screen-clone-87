/** Shared presentation pieces: one badge style for statuses, one for deadlines, confidentiality icons, empty states. */
import type { ReactNode } from "react";
import { Building2, FileText, Lock, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const pill = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap";

export type StatusTone = "neutral" | "done" | "rejected" | "info";
/** Status badge: Brouillon IA / Validé / Rejeté / neutral labels. */
export function StatusBadge({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={cn(pill,
      tone === "neutral" && "border-border bg-muted text-muted-foreground",
      tone === "info" && "border-border bg-card text-foreground",
      tone === "done" && "border-primary/20 bg-accent text-accent-foreground",
      tone === "rejected" && "border-border bg-muted text-muted-foreground line-through",
    )}>{children}</span>
  );
}

export const REVIEW_LABEL: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Brouillon IA", tone: "neutral" },
  APPROVED: { label: "Validé", tone: "done" },
  REJECTED: { label: "Rejeté", tone: "rejected" },
};
export function ReviewBadge({ status }: { status: string }) {
  const s = REVIEW_LABEL[status] ?? { label: "Brouillon IA", tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const todayIso = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date());
export const frDate = (s?: string | null) => (s ? new Date(`${s.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR") : "—");

export function deadlineTone(due: string | null | undefined, today = todayIso()): "overdue" | "week" | "later" {
  if (!due) return "later";
  if (due < today) return "overdue";
  if (due <= addDays(today, 7)) return "week";
  return "later";
}
/** Deadline badge: red overdue, amber this week, grey later. */
export function DeadlineBadge({ due, children, overdue }: { due: string | null | undefined; children?: ReactNode; overdue?: boolean }) {
  const t = overdue ? "overdue" : deadlineTone(due);
  return (
    <span className={cn(pill,
      t === "overdue" && "border-destructive/25 bg-destructive/10 text-destructive",
      t === "week" && "border-warning/40 bg-warning/15 text-warning-foreground",
      t === "later" && "border-border bg-muted text-muted-foreground",
    )}>{children ?? (t === "overdue" ? `En retard · ${frDate(due)}` : frDate(due))}</span>
  );
}

const CONF = {
  MEDICAL: { label: "Secret médical", icon: Lock },
  PDP_SHARED: { label: "Cellule PDP", icon: Users },
  ADMINISTRATIVE: { label: "Administratif", icon: FileText },
  EMPLOYER_VISIBLE: { label: "Visible employeur", icon: Building2 },
  WORKER_VISIBLE: { label: "Visible salarié", icon: User },
} as const;
export const CONF_TEXT: Record<string, string> = Object.fromEntries(Object.entries(CONF).map(([k, v]) => [k, v.label]));
/** Confidentiality level as an icon and a French label, never the internal code. */
export function ConfLabel({ level }: { level: string }) {
  const c = CONF[level as keyof typeof CONF] ?? CONF.ADMINISTRATIVE;
  const Icon = c.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", level === "MEDICAL" ? "text-destructive" : "text-muted-foreground")}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{c.label}
    </span>
  );
}

/** Priority indicator (0–100) with its top factor. */
export function PriorityIndicator({ score, factor }: { score: number; factor?: string | null }) {
  const level = score >= 60 ? "Haute" : score >= 35 ? "Moyenne" : "Basse";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", score >= 60 ? "bg-destructive" : score >= 35 ? "bg-warning" : "bg-primary")} style={{ width: `${Math.max(4, score)}%` }} />
      </div>
      <span className="text-sm font-medium">Priorité {level.toLowerCase()} · {score}</span>
      {factor && <span className="text-xs text-muted-foreground">{factor}</span>}
    </div>
  );
}

export function EmptyState({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

export function PageTitle({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
