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
