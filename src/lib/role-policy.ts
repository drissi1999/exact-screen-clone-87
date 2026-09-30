/** Who may grant/revoke which role. Mirrors private.can_manage_role() in the database (the DB is the enforcement point). */
export const MEDICAL_ROLES = ["MEDECIN_TRAVAIL", "IDEST"] as const;

export function isMedicalRole(role: string): boolean {
  return (MEDICAL_ROLES as readonly string[]).includes(role);
}

export function canManageRole(callerRoles: string[], role: string): boolean {
  return isMedicalRole(role) ? callerRoles.includes("MEDECIN_TRAVAIL") : callerRoles.includes("SPSTI_ADMIN");
}

export function refusalMessage(role: string): string {
  return isMedicalRole(role)
    ? "Seul un médecin du travail de ce SPSTI peut attribuer ou retirer ce rôle."
    : "Réservé à l'administrateur SPSTI.";
}
