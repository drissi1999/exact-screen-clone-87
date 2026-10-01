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
  /** OBLIGATION: legal duty, the only kind that can be overdue (red). POSSIBILITE: optional step. INFO: informative date (CPAM, contestation window). */
  kind: DeadlineKind;
  /** FAIT: marked done; NON_REALISE: optional step whose window closed; ECHUE: informative date passed. */
  status: "A_VENIR" | "EN_COURS" | "DEPASSEE" | "INFO" | "FAIT" | "NON_REALISE" | "ECHUE" | "PLANIFIEE";
  /** Date of the booked visit when status is PLANIFIEE. */
  plannedOn?: string | null;
  /** Date the obligation was marked done. */
  doneOn?: string | null;
  /** Every rule is shown "à valider juridiquement" until a lawyer signs off. */
  toValidate: true;
};

/** Case facts that some rules need. All optional. */
export type DeadlineKind = "OBLIGATION" | "POSSIBILITE" | "INFO";
/** Legal obligations (the only deadlines that can be "en retard"). */
export const OBLIGATION_CODES = ["DECLARATION_AT", "RESERVES_MOTIVEES", "VISITE_REPRISE", "INAPTITUDE_SALARY_RESUMES"] as const;
export const POSSIBILITY_CODES = ["RDV_LIAISON", "PRE_REPRISE"] as const;
export const kindOf = (code: string): DeadlineKind =>
  (OBLIGATION_CODES as readonly string[]).includes(code) ? "OBLIGATION" : (POSSIBILITY_CODES as readonly string[]).includes(code) ? "POSSIBILITE" : "INFO";
/** Short plain-French names, for one-line reasons. */
export const SHORT_LABELS: Record<string, string> = {
  DECLARATION_AT: "Déclaration AT",
  RESERVES_MOTIVEES: "Réserves de l'employeur",
  CPAM_DECISION_AT: "Décision CPAM",
  CPAM_DECISION_MP: "Décision CPAM",
  RDV_LIAISON: "Rendez-vous de liaison possible",
  PRE_REPRISE: "Visite de pré-reprise possible",
  VISITE_REPRISE: "Visite de reprise à organiser",
  CONTESTATION_AVIS: "Délai de contestation de l'avis",
  INAPTITUDE_SALARY_RESUMES: "Reprise du salaire (inaptitude)",
};
/** Wording of the "Marquer comme fait" confirmation. */
export const DONE_LABELS: Record<string, string> = {
  DECLARATION_AT: "Déclaration AT faite le",
  RESERVES_MOTIVEES: "Réserves envoyées le",
  VISITE_REPRISE: "Visite de reprise faite le",
  INAPTITUDE_SALARY_RESUMES: "Reclassement, licenciement ou reprise du salaire le",
};

export type CaseFacts = {
  /** Date the employer learned of the accident (defaults to the episode start). */
  employerKnownAt?: string | null;
  /** CPAM opened a complementary investigation (30 → 90 days). */
  cpamInvestigation?: boolean;
  /** Latest avis entered by the médecin du travail. */
  avis?: { type: "APTITUDE" | "APTITUDE_AMENAGEMENTS" | "INAPTITUDE"; date: string } | null;
  /** Obligations marked done: code -> date. */
  done?: Record<string, string>;
  /** Visits booked for RDV_LIAISON / PRE_REPRISE / VISITE_REPRISE: code -> visit date. */
  planned?: Record<string, string>;
};

export const LEGAL_CHECK_LABEL = "à valider juridiquement";

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));


/* ------------------------------ calendar ------------------------------ */

function easter(year: number): string {
  // Anonymous Gregorian algorithm.
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** French national public holidays (metropolitan, excluding Alsace-Moselle specifics). */
export function frenchHolidays(year: number): Set<string> {
  const e = easter(year);
  return new Set([
    ...["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].map((md) => `${year}-${md}`),
    addDays(e, 1), // lundi de Pâques
    addDays(e, 39), // Ascension
    addDays(e, 50), // lundi de Pentecôte
  ]);
}
export const isHoliday = (d: string) => frenchHolidays(Number(d.slice(0, 4))).has(d);
const weekday = (d: string) => toDate(d).getUTCDay(); // 0 = Sunday

/** Adds n days, skipping Sundays and public holidays (the "48 h non compris dimanches et jours fériés" rule). */
export function addDaysExclSundaysHolidays(start: string, n: number): string {
  let d = start;
  for (let left = n; left > 0; ) {
    d = addDays(d, 1);
    if (weekday(d) !== 0 && !isHoliday(d)) left -= 1;
  }
  return d;
}
/** Jours francs: the start day is not counted; a deadline falling on Saturday, Sunday or a holiday moves to the next working day. */
export function addJoursFrancs(start: string, n: number): string {
  let d = addDays(start, n);
  while (weekday(d) === 0 || weekday(d) === 6 || isHoliday(d)) d = addDays(d, 1);
  return d;
}
export function addMonths(start: string, n: number): string {
  const [y, m, day] = start.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return iso(target);
}

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
export function computeDeadlines(stoppages: Stoppage[], origin: string | null, today = todayParis(), facts: CaseFacts = {}): Deadline[] {
  if (stoppages.length === 0) return [];
  const ep = episodes(stoppages).at(-1)!;
  const sorted = ep.stoppages;
  const start = ep.start;
  const end = ep.end;
  const duration = episodeDuration(ep, today);
  const o = origin ?? sorted[0]!.origin;
  const out: Deadline[] = [];
  const push = (d: Omit<Deadline, "toValidate" | "kind">) => {
    const kind = kindOf(d.code);
    const doneOn = facts.done?.[d.code] ?? null;
    let status = d.status;
    const plannedOn = facts.planned?.[d.code] ?? null;
    if (kind === "OBLIGATION" && doneOn) status = "FAIT";
    else if (plannedOn) status = "PLANIFIEE";
    else if (kind === "POSSIBILITE" && ((end && today > end) || status === "DEPASSEE")) status = "NON_REALISE";
    else if (kind === "INFO" && status === "DEPASSEE") status = "ECHUE";
    out.push({ ...d, kind, status, doneOn, plannedOn, toValidate: true });
  };

  if (o === "AT") {
    const known = facts.employerKnownAt ?? start;
    const declDue = addDaysExclSundaysHolidays(known, 2);
    push({
      code: "DECLARATION_AT",
      label: "Déclaration de l'accident du travail par l'employeur (48 h, hors dimanches et jours fériés)",
      legalRef: "Art. R441-3 CSS",
      from: known,
      due: declDue,
      status: statusFor(known, declDue, today),
    });
    const resDue = addJoursFrancs(declDue, 10);
    push({
      code: "RESERVES_MOTIVEES",
      label: "Réserves motivées de l'employeur (10 jours francs à compter de la déclaration, au plus tard)",
      legalRef: "Art. R441-6 CSS",
      from: declDue,
      due: resDue,
      status: statusFor(declDue, resDue, today),
    });
    const cpamDays = facts.cpamInvestigation ? 90 : 30;
    const cpamDue = addDays(declDue, cpamDays);
    push({
      code: "CPAM_DECISION_AT",
      label: `Décision de la CPAM sur le caractère professionnel (${cpamDays} jours${facts.cpamInvestigation ? ", investigation" : ""})`,
      legalRef: "Art. R441-7 et R441-8 CSS",
      from: declDue,
      due: cpamDue,
      status: statusFor(declDue, cpamDue, today),
    });
  }
  if (o === "MP") {
    const mpDue = addDays(start, 120);
    push({
      code: "CPAM_DECISION_MP",
      label: "Décision de la CPAM sur la maladie professionnelle (120 jours)",
      legalRef: "Art. R461-9 CSS",
      from: start,
      due: mpDue,
      status: statusFor(start, mpDue, today),
    });
  }
  if (duration > 30) {
    const d30 = addDays(start, 30);
    push({
      code: "RDV_LIAISON",
      label: "Rendez-vous de liaison employeur / salarié possible",
      legalRef: "Art. L1226-1-3 C. trav.",
      from: d30,
      due: end,
      status: end && today > end ? "DEPASSEE" : statusFor(d30, null, today),
    });
    push({
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
    push({
      code: "VISITE_REPRISE",
      label: "Visite de reprise obligatoire (dans les 8 jours suivant la reprise)",
      legalRef: "Art. R4624-31 C. trav.",
      from,
      due,
      status: end ? statusFor(from, due, today) : "INFO",
    });
  }
  if (facts.avis) {
    const av = facts.avis.date;
    const cDue = addDays(av, 15);
    push({
      code: "CONTESTATION_AVIS",
      label: "Contestation de l'avis du médecin du travail devant le conseil de prud'hommes (15 jours)",
      legalRef: "Art. R4624-45 C. trav.",
      from: av,
      due: cDue,
      status: statusFor(av, cDue, today),
    });
    if (facts.avis.type === "INAPTITUDE") {
      const sDue = addMonths(av, 1);
      push({
        code: "INAPTITUDE_SALARY_RESUMES",
        label: "Reprise du paiement du salaire si ni reclassement ni licenciement (1 mois après l'avis d'inaptitude)",
        legalRef: "Art. L1226-4 et L1226-11 C. trav.",
        from: av,
        due: sDue,
        status: statusFor(av, sDue, today),
      });
    }
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
