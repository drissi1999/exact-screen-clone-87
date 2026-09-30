/**
 * Weights of the "risque de désinsertion" score. Single place to tune them.
 * Maximum of every factor adds up to exactly 100. No medical input is allowed here.
 */
export const RISK_WEIGHTS = {
  /** Continuous duration of the current episode (days, lower bound) -> points. */
  duration: [
    { minDays: 180, points: 30 },
    { minDays: 90, points: 22 },
    { minDays: 60, points: 15 },
    { minDays: 30, points: 8 },
  ],
  /** Number of episodes starting in the last 24 months (current included). */
  episodes24m: [
    { min: 4, points: 15 },
    { min: 3, points: 10 },
    { min: 2, points: 5 },
  ],
  originAtMp: 10,
  age: [
    { minAge: 55, points: 10 },
    { minAge: 50, points: 6 },
  ],
  /** Job physical demands: points when job_title contains one of the keywords (accent/case insensitive). */
  physicalJob: {
    points: 10,
    keywords: ["cariste", "manutention", "manutentionnaire", "btp", "macon", "couvreur", "charpentier", "aide-soignant", "aide soignant", "ash", "agent d'entretien", "menage", "preparateur de commandes", "magasinier", "chauffeur", "livreur", "ouvrier", "boucher", "cuisinier", "demenageur", "logisticien"],
  },
  /** Latest avis: inaptitude or aptitude with restrictions. */
  avis: { INAPTITUDE: 10, APTITUDE_AMENAGEMENTS: 6 } as Record<string, number>,
  noContact: { days: 30, points: 10 },
  /** Company headcount (upper bound) -> points: small companies have fewer redeployment options. */
  companySize: [
    { maxHeadcount: 10, points: 5 },
    { maxHeadcount: 49, points: 3 },
  ],
} as const;
