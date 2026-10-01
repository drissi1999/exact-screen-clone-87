/**
 * Fixed templates for messages sent to employers and workers. Coordination tasks addressed to
 * EMPLOYER_HR or WORKER can only be built here (the database rejects them without template_code
 * and forbids editing their text). No medical input is ever accepted.
 */
export type TemplateCode = "DOC_ARRET" | "DOC_FICHE_POSTE" | "DOC_DAT" | "RDV_PRE_REPRISE" | "RDV_REPRISE";

type Vars = { firstName?: string; due?: string | null };

const frDate = (d?: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : "à préciser");

export const TEMPLATES: Record<TemplateCode, { recipient: "WORKER" | "EMPLOYER_HR"; channel: "SMS" | "EMAIL"; render: (v: Vars) => string }> = {
  DOC_ARRET: {
    recipient: "WORKER",
    channel: "SMS",
    render: (v) => `Bonjour ${v.firstName ?? ""}, votre service de santé au travail vous accompagne. Pourriez-vous nous transmettre une copie de votre dernier arrêt de travail via le lien sécurisé ? Merci.`,
  },
  DOC_FICHE_POSTE: {
    recipient: "EMPLOYER_HR",
    channel: "EMAIL",
    render: () => `Bonjour, dans le cadre de l'accompagnement d'un de vos salariés, pourriez-vous nous transmettre sa fiche de poste à jour ? Cordialement, le service de prévention et de santé au travail.`,
  },
  DOC_DAT: {
    recipient: "EMPLOYER_HR",
    channel: "EMAIL",
    render: () => `Bonjour, merci de nous transmettre une copie de la déclaration d'accident du travail concernant votre salarié. Cordialement.`,
  },
  RDV_PRE_REPRISE: {
    recipient: "WORKER",
    channel: "SMS",
    render: (v) => `Bonjour ${v.firstName ?? ""}, vous pouvez bénéficier d'une visite de pré-reprise avec le médecin du travail pour préparer votre retour. Répondez OUI pour être rappelé(e) et choisir un créneau.`,
  },
  RDV_REPRISE: {
    recipient: "EMPLOYER_HR",
    channel: "EMAIL",
    render: (v) => `Bonjour, la visite de reprise de votre salarié doit être organisée au plus tard le ${frDate(v.due)}. Merci de nous confirmer sa date de reprise.`,
  },
};

export function renderTemplate(code: TemplateCode, vars: Vars) {
  const t = TEMPLATES[code];
  return { template_code: code, recipient: t.recipient, channel: t.channel, message: t.render(vars) };
}

/** Generic, non-revealing titles shown to employers and workers instead of original filenames. */
export function genericDocTitle(docType: string | null | undefined): string {
  if (docType === "FICHE_POSTE") return "Fiche de poste";
  if (docType === "COURRIER_EMPLOYEUR" || docType === "AVIS_APTITUDE") return "Courrier";
  return "Document";
}

/* ------------------------- visit outcome (employer) ------------------------- */

export const AVIS_TYPE_LABELS: Record<string, string> = {
  APTITUDE: "Apte",
  APTITUDE_AMENAGEMENTS: "Apte avec aménagements",
  INAPTITUDE: "Inapte au poste",
};
export const VISIT_KIND_LABELS: Record<string, string> = {
  RDV_LIAISON: "Rendez-vous de liaison",
  PRE_REPRISE: "Visite de pré-reprise",
  VISITE_REPRISE: "Visite de reprise",
};
type AvisVars = { worker: string; jobTitle: string | null; company: string; visitKind: string; visitDate: string; avisType: string; restrictions: string | null };

/** Avis wording for the employer. Inputs: decision type, restrictions in plain words, dates. Never a medical field. */
export function renderAvisText(v: AvisVars): string {
  const lines = [
    `Avis du médecin du travail — ${VISIT_KIND_LABELS[v.visitKind] ?? "Visite"} du ${frDate(v.visitDate)}`,
    `Salarié : ${v.worker}${v.jobTitle ? `, ${v.jobTitle}` : ""} (${v.company})`,
    `Conclusion : ${AVIS_TYPE_LABELS[v.avisType] ?? v.avisType}.`,
  ];
  if (v.restrictions) lines.push(`${v.avisType === "INAPTITUDE" ? "Indications pour le reclassement" : "Aménagements et restrictions"} : ${v.restrictions}`);
  return lines.join("\n");
}

/** Fixed employer letter accompanying the avis. Same inputs as the avis. */
export function renderAvisLetter(v: AvisVars): string {
  const body =
    v.avisType === "INAPTITUDE"
      ? "Le salarié a été déclaré inapte à son poste. Nous vous invitons à rechercher des possibilités de reclassement en tenant compte des indications ci-dessous et à nous tenir informés de vos démarches. Sans reclassement ni licenciement dans un délai d'un mois, le versement du salaire doit reprendre."
      : v.avisType === "APTITUDE_AMENAGEMENTS"
        ? "Le salarié peut reprendre son poste avec les aménagements ci-dessous. Merci de nous confirmer leur mise en place ou de nous signaler toute difficulté."
        : "Le salarié peut reprendre son poste sans restriction.";
  return [
    "Madame, Monsieur,",
    `À la suite de la ${(VISIT_KIND_LABELS[v.visitKind] ?? "visite").toLowerCase()} du ${frDate(v.visitDate)} concernant ${v.worker}${v.jobTitle ? ` (${v.jobTitle})` : ""}, le médecin du travail a rendu l'avis suivant : ${AVIS_TYPE_LABELS[v.avisType] ?? v.avisType}.`,
    body,
    v.restrictions ? `Aménagements et restrictions : ${v.restrictions}` : "",
    "Cordialement, le service de prévention et de santé au travail.",
  ].filter(Boolean).join("\n\n");
}
