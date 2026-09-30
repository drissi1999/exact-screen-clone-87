import { describe, expect, it } from "vitest";
import { CLINICAL_WORDS, PLAN_TEMPLATES, milestonesFor } from "./plan-templates";

describe("plan templates", () => {
  it("employer and worker milestones never contain a clinical word", () => {
    for (const t of Object.values(PLAN_TEMPLATES))
      for (const m of t.milestones.filter((m) => m.owner === "EMPLOYER_HR" || m.owner === "WORKER"))
        for (const w of CLINICAL_WORDS) expect(m.title.toLowerCase()).not.toContain(w);
  });
  it("POSTE_AMENAGE dates milestones from the target date", () => {
    const m = milestonesFor("POSTE_AMENAGE", "2026-11-02");
    expect(m.find((x) => x.code === "ETUDE_POSTE")!.due_date).toBe("2026-10-18");
    const v = m.find((x) => x.code === "VISITE_REPRISE")!;
    expect([v.due_date, v.due_end]).toEqual(["2026-11-02", "2026-11-10"]);
  });
});
