/**
 * Legal deadline rules engine (French occupational health).
 * Pure functions: never inline deadlines elsewhere. Dates are handled as
 * calendar days (Europe/Paris), as ISO YYYY-MM-DD strings.
 */

export type Stoppage = { start_date: string; end_date: string | null; origin: string; kind: string };
export type Deadline = {
  code: string;
  label: string;
  legalRef: string;
  from: string | null;
  due: string | null;
  status: "A_VENIR" | "EN_COURS" | "DEPASSEE" | "INFO";
};

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));

export function todayParis(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
}

function statusFor(from: string | null, due: string | null, today: string): Deadline["status"] {
  if (due && today > due) return "DEPASSEE";
  if (from && today < from) return "A_VENIR";
  return "EN_COURS";
}

export type Episode = { start: string; end: string | null; stoppages: Stoppage[] };

/**
 * Groups a case's stoppages into episodes. Only contiguous periods merge: a period starting on or
 * before the day after the current end (extension or overlap). A gap of 1 day or more starts a new
 * episode. An open-ended period absorbs anything starting after it.
 */
export function episodes(stoppages: Stoppage[]): Episode[] {
  const sorted = [...stoppages].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const out: Episode[] = [];
  for (const s of sorted) {
    const cur = out.at(-1);
    if (cur && (cur.end === null || s.start_date <= addDays(cur.end, 1))) {
      cur.stoppages.push(s);
      if (cur.end !== null) cur.end = s.end_date === null ? null : s.end_date > cur.end ? s.end_date : cur.end;
    } else {
      out.push({ start: s.start_date, end: s.end_date, stoppages: [s] });
    }
  }
  return out;
}

/** Continuous duration in calendar days (both ends included); an open episode runs until today. */
export function episodeDuration(e: Episode, today = todayParis()): number {
  return Math.round((toDate(e.end ?? today).getTime() - toDate(e.start).getTime()) / DAY) + 1;
}

/** Deadlines of the current (latest) episode. Pass only the stoppages of the CASE. */
export function computeDeadlines(stoppages: Stoppage[], origin: string | null, today = todayParis()): Deadline[] {
  if (stoppages.length === 0) return [];
  const ep = episodes(stoppages).at(-1)!;
  const sorted = ep.stoppages;
  const start = ep.start;
  const end = ep.end;
  const duration = episodeDuration(ep, today);
  const o = origin ?? sorted[0]!.origin;
  const out: Deadline[] = [];

  if (o === "AT") {
    out.push({
      code: "DECLARATION_AT",
      label: "Déclaration de l'accident du travail par l'employeur (48 h)",
      legalRef: "Art. R441-3 CSS",
      from: start,
      due: addDays(start, 2),
      status: statusFor(start, addDays(start, 2), today),
    });
  }
  if (duration > 30) {
    const d30 = addDays(start, 30);
    out.push({
      code: "RDV_LIAISON",
      label: "Rendez-vous de liaison employeur / salarié possible",
      legalRef: "Art. L1226-1-3 C. trav.",
      from: d30,
      due: end,
      status: end && today > end ? "DEPASSEE" : statusFor(d30, null, today),
    });
    out.push({
      code: "PRE_REPRISE",
      label: "Visite de pré-reprise possible (arrêt > 30 jours)",
      legalRef: "Art. R4624-29 C. trav.",
      from: d30,
      due: end,
      status: end && today > end ? "DEPASSEE" : statusFor(d30, null, today),
    });
  }
  const repriseRequired = (o === "AT" && duration >= 30) || o === "MP" || (o === "MALADIE" && duration >= 60);
  if (repriseRequired) {
    const from = end ? addDays(end, 1) : null;
    const due = end ? addDays(end, 8) : null;
    out.push({
      code: "VISITE_REPRISE",
      label: "Visite de reprise obligatoire (dans les 8 jours suivant la reprise)",
      legalRef: "Art. R4624-31 C. trav.",
      from,
      due,
      status: end ? statusFor(from, due, today) : "INFO",
    });
  }
  return out;
}

export const CONF_RANK: Record<string, number> = {
  WORKER_VISIBLE: 1,
  EMPLOYER_VISIBLE: 2,
  ADMINISTRATIVE: 3,
  PDP_SHARED: 4,
  MEDICAL: 5,
};
export const CONF_LABELS: Record<string, string> = {
  MEDICAL: "Médical",
  PDP_SHARED: "Partagé cellule PDP",
  ADMINISTRATIVE: "Administratif",
  EMPLOYER_VISIBLE: "Visible employeur",
  WORKER_VISIBLE: "Visible salarié",
};
/** LLM outputs inherit the highest confidentiality among their inputs. */
export function maxConfidentiality(levels: string[]): string {
  return levels.reduce((a, b) => ((CONF_RANK[b] ?? 5) > (CONF_RANK[a] ?? 0) ? b : a), "WORKER_VISIBLE");
}

export const ROLE_LABELS: Record<string, string> = {
  MEDECIN_TRAVAIL: "Médecin du travail",
  IDEST: "Infirmier(e) santé travail",
  PDP_COORDINATOR: "Coordinateur PDP",
  SPSTI_ADMIN: "Administrateur SPSTI",
  EMPLOYER_HR: "RH employeur",
  WORKER: "Salarié",
  EXPERT: "Expert",
};
