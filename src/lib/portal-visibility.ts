/** Single rule for what a staff-uploaded document may show in the employer or worker portal. */
export const CLINICAL_DOC_TYPES = ["CERTIFICAT_MEDICAL", "COMPTE_RENDU", "ARRET_TRAVAIL"];
export const PORTAL_DOC_COLUMNS = "id, case_id, doc_type, source, confidentiality, analysis_status, released_at, created_at";

type Doc = { source: string; confidentiality: string; analysis_status: string; doc_type: string; released_at: string | null };

export function visibleInPortal(d: Doc, audience: "EMPLOYER" | "WORKER"): boolean {
  if (d.source === audience) return true; // their own uploads
  return (
    d.confidentiality === (audience === "EMPLOYER" ? "EMPLOYER_VISIBLE" : "WORKER_VISIBLE") &&
    d.analysis_status === "DONE" &&
    !CLINICAL_DOC_TYPES.includes(d.doc_type) &&
    !!d.released_at
  );
}
