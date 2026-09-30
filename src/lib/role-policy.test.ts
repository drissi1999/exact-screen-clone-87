import { describe, expect, it } from "vitest";
import { canManageRole, isMedicalRole } from "./role-policy";

describe("role policy", () => {
  it("medical roles are MEDECIN_TRAVAIL and IDEST", () => {
    expect(isMedicalRole("MEDECIN_TRAVAIL")).toBe(true);
    expect(isMedicalRole("IDEST")).toBe(true);
    expect(isMedicalRole("PDP_COORDINATOR")).toBe(false);
  });
  it("admin cannot grant medical roles", () => {
    expect(canManageRole(["SPSTI_ADMIN"], "MEDECIN_TRAVAIL")).toBe(false);
    expect(canManageRole(["SPSTI_ADMIN"], "IDEST")).toBe(false);
  });
  it("admin grants non-medical roles", () => {
    expect(canManageRole(["SPSTI_ADMIN"], "PDP_COORDINATOR")).toBe(true);
  });
  it("médecin grants medical roles but not admin ones", () => {
    expect(canManageRole(["MEDECIN_TRAVAIL"], "IDEST")).toBe(true);
    expect(canManageRole(["MEDECIN_TRAVAIL"], "SPSTI_ADMIN")).toBe(false);
  });
  it("IDEST cannot grant medical roles", () => {
    expect(canManageRole(["IDEST"], "IDEST")).toBe(false);
  });
});
