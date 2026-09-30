/**
 * Return-to-work plan templates: the only place where scenario milestones are defined.
 * Offsets are in days relative to the target return date (J+0). Milestones owned by the employer
 * or the worker use fixed, non-clinical wording (checked by plan-templates.test.ts).
 */
export type Scenario = "MEME_POSTE" | "POSTE_AMENAGE" | "MI_TEMPS_THERAPEUTIQUE" | "ESSAI_ENCADRE" | "RECLASSEMENT_INTERNE" | "FORMATION_RECONVERSION";
export type OwnerRole = "MEDECIN_TRAVAIL" | "IDEST" | "PDP_COORDINATOR" | "EMPLOYER_HR" | "WORKER" | "PARTNER";
export type PlanStatus = "BROUILLON" | "EN_COURS" | "TERMINE";
export type Outcome = "MAINTENU" | "DIFFICULTES" | "RECHUTE";

export type Milestone = {
  code: string; title: string; owner: OwnerRole; offset: number; offsetEnd?: number;
  partner?: string; requiresDocument?: boolean;
};

export const SCENARIO_LABELS: Record<Scenario, string> = {
  MEME_POSTE: "Retour au même poste",
  POSTE_AMENAGE: "Poste aménagé",
  MI_TEMPS_THERAPEUTIQUE: "Mi-temps thérapeutique",
  ESSAI_ENCADRE: "Essai encadré",
  RECLASSEMENT_INTERNE: "Reclassement interne",
  FORMATION_RECONVERSION: "Formation / reconversion",
};
export const STATUS_LABELS: Record<PlanStatus, string> = { BROUILLON: "Brouillon", EN_COURS: "En cours", TERMINE: "Terminé" };
export const OUTCOME_LABELS: Record<Outcome, string> = { MAINTENU: "Maintenu", DIFFICULTES: "Difficultés", RECHUTE: "Rechute" };
export const OWNER_LABELS: Record<OwnerRole, string> = {
  MEDECIN_TRAVAIL: "Médecin du travail", IDEST: "IDEST", PDP_COORDINATOR: "Coordinateur", EMPLOYER_HR: "Employeur", WORKER: "Salarié", PARTNER: "Partenaire",
};
/** External partners: labels with a contact field, never application users. */
export const PARTNERS = ["Cap emploi", "Agefiph", "Service social CARSAT", "Médecin conseil"] as const;

/** Roles allowed to edit a plan (the plan is PDP_SHARED). */
export const PLAN_EDITORS = ["PDP_COORDINATOR", "IDEST", "MEDECIN_TRAVAIL"] as const;

/** Follow-up points after the actual return date. */
export const FOLLOWUPS: Milestone[] = [
  { code: "POINT_1S", title: "Point de suivi à 1 semaine", owner: "PDP_COORDINATOR", offset: 7 },
  { code: "POINT_1M", title: "Point de suivi à 1 mois", owner: "PDP_COORDINATOR", offset: 30 },
  { code: "POINT_3M", title: "Point de suivi à 3 mois", owner: "PDP_COORDINATOR", offset: 90 },
];

const VISITE: Milestone = { code: "VISITE_REPRISE", title: "Visite de reprise", owner: "MEDECIN_TRAVAIL", offset: 0, offsetEnd: 8 };
const CONFIRM_WORKER: Milestone = { code: "CONFIRMER_DATE", title: "Confirmer votre date de retour", owner: "WORKER", offset: -7 };
const CONFIRM_EMPLOYER: Milestone = { code: "PREPARER_ACCUEIL", title: "Préparer l'accueil du salarié à son retour", owner: "EMPLOYER_HR", offset: -3 };

export const PLAN_TEMPLATES: Record<Scenario, { milestones: Milestone[]; partners: string[] }> = {
  MEME_POSTE: { partners: [], milestones: [CONFIRM_WORKER, CONFIRM_EMPLOYER, VISITE, ...FOLLOWUPS] },
  POSTE_AMENAGE: {
    partners: ["Cap emploi"],
    milestones: [
      { code: "ETUDE_POSTE", title: "Étude de poste", owner: "IDEST", offset: -15 },
      { code: "DEVIS_AMENAGEMENT", title: "Transmettre le devis d'aménagement du poste", owner: "EMPLOYER_HR", offset: -10, requiresDocument: true },
      { code: "VALIDATION_EMPLOYEUR", title: "Valider l'aménagement du poste", owner: "EMPLOYER_HR", offset: -5 },
      CONFIRM_WORKER,
      VISITE,
      ...FOLLOWUPS,
    ],
  },
  MI_TEMPS_THERAPEUTIQUE: {
    partners: ["Médecin conseil"],
    milestones: [
      { code: "ACCORD_MEDECIN_CONSEIL", title: "Accord du médecin conseil", owner: "PARTNER", partner: "Médecin conseil", offset: -10 },
      { code: "PLANNING_HORAIRES", title: "Transmettre le planning des horaires de reprise", owner: "EMPLOYER_HR", offset: -7, requiresDocument: true },
      CONFIRM_WORKER,
      VISITE,
      ...FOLLOWUPS,
    ],
  },
  ESSAI_ENCADRE: {
    partners: ["Service social CARSAT"],
    milestones: [
      { code: "DEMANDE_ESSAI", title: "Demande d'essai encadré", owner: "PARTNER", partner: "Service social CARSAT", offset: -21 },
      { code: "TUTEUR", title: "Désigner un tuteur pour la période d'essai", owner: "EMPLOYER_HR", offset: -10 },
      { code: "BILAN_ESSAI", title: "Bilan de l'essai encadré", owner: "IDEST", offset: -2 },
      VISITE,
      ...FOLLOWUPS,
    ],
  },
  RECLASSEMENT_INTERNE: {
    partners: ["Cap emploi", "Agefiph"],
    milestones: [
      { code: "ETUDE_POSTES", title: "Étude des postes disponibles", owner: "IDEST", offset: -30 },
      { code: "LISTE_POSTES", title: "Transmettre la liste des postes disponibles", owner: "EMPLOYER_HR", offset: -21, requiresDocument: true },
      { code: "ENTRETIEN_SALARIE", title: "Participer à l'entretien sur votre futur poste", owner: "WORKER", offset: -14 },
      { code: "PROPOSITION", title: "Formaliser la proposition de poste", owner: "EMPLOYER_HR", offset: -7 },
      VISITE,
      ...FOLLOWUPS,
    ],
  },
  FORMATION_RECONVERSION: {
    partners: ["Agefiph", "Service social CARSAT"],
    milestones: [
      { code: "BILAN_COMPETENCES", title: "Bilan de compétences", owner: "PARTNER", partner: "Service social CARSAT", offset: -60 },
      { code: "PROJET_FORMATION", title: "Présenter votre projet de formation", owner: "WORKER", offset: -45, requiresDocument: true },
      { code: "FINANCEMENT", title: "Financement de la formation", owner: "PARTNER", partner: "Agefiph", offset: -30 },
      { code: "ACCORD_EMPLOYEUR", title: "Donner votre accord sur le projet de formation", owner: "EMPLOYER_HR", offset: -20 },
      VISITE,
      ...FOLLOWUPS,
    ],
  },
};

/** Words that must never appear in a task shown to an employer or a worker. */
export const CLINICAL_WORDS = ["médic", "diagnos", "patholog", "certificat", "arrêt", "inaptitude", "traitement", "thérapeut", "handicap", "maladie", "rechute", "soin", "visite"];

export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Dated tasks for a scenario and a reference date (J+0). */
export function milestonesFor(scenario: Scenario, target: string, list: Milestone[] = PLAN_TEMPLATES[scenario].milestones) {
  return list.map((m) => ({
    code: m.code, title: m.title, owner_role: m.owner, partner_label: m.partner ?? null,
    offset_days: m.offset, offset_end_days: m.offsetEnd ?? null,
    due_date: addDays(target, m.offset), due_end: m.offsetEnd != null ? addDays(target, m.offsetEnd) : null,
    requires_document: !!m.requiresDocument,
  }));
}
