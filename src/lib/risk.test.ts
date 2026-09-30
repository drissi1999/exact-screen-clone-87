import { describe, expect, it } from "vitest";
import { computeRisk, type RiskInput } from "./risk";
import { RISK_WEIGHTS } from "./risk-config";

const T = "2026-09-30";
const base: RiskInput = { caseStoppages: [], workerStoppages: [], origin: null, birthDate: null, jobTitle: null, avisType: null, lastWorkerContact: T, companyHeadcount: null };
const sum = (r: ReturnType<typeof computeRisk>) => r.factors.reduce((s, f) => s + f.points, 0);

describe("risk score", () => {
  it("factors sum exactly to the score, every factor has points and a label", () => {
    const st = [{ start_date: "2026-06-01", end_date: null, origin: "MALADIE", kind: "INITIAL" }];
    const r = computeRisk({ ...base, caseStoppages: st, workerStoppages: st, birthDate: "1968-01-01", jobTitle: "Cariste", lastWorkerContact: "2026-08-01", companyHeadcount: 8 }, T);
    expect(sum(r)).toBe(r.score);
    expect(r.factors.every((f) => f.points > 0 && f.libelle && f.facteur)).toBe(true);
    expect(r.factors.map((f) => f.facteur).sort()).toEqual(["AGE", "CONTACT", "DUREE", "POSTE", "TAILLE"]);
  });
  it("worst case reaches exactly 100 and still sums", () => {
    const eps = ["2025-01-01", "2025-04-01", "2025-08-01"].map((d) => ({ start_date: d, end_date: d, origin: "AT", kind: "INITIAL" }));
    const cur = [{ start_date: "2026-01-01", end_date: null, origin: "AT", kind: "INITIAL" }];
    const r = computeRisk({ caseStoppages: cur, workerStoppages: [...eps, ...cur], origin: "AT", birthDate: "1960-05-05", jobTitle: "Aide-soignante", avisType: "INAPTITUDE", lastWorkerContact: null, companyHeadcount: 5 }, T);
    expect(r.score).toBe(100);
    expect(sum(r)).toBe(100);
  });
  it("maximum weights add up to 100 (no hidden clamping)", () => {
    const W = RISK_WEIGHTS;
    expect(W.duration[0].points + W.episodes24m[0].points + W.originAtMp + W.age[0].points + W.physicalJob.points + W.avis["INAPTITUDE"]! + W.noContact.points + W.companySize[0].points).toBe(100);
  });
  it("episodes older than 24 months and gaps are counted correctly; recent contact scores nothing", () => {
    const st = [
      { start_date: "2023-01-01", end_date: "2023-01-10", origin: "MALADIE", kind: "INITIAL" },
      { start_date: "2026-09-01", end_date: "2026-09-10", origin: "MALADIE", kind: "INITIAL" },
      { start_date: "2026-09-12", end_date: null, origin: "MALADIE", kind: "INITIAL" },
    ];
    const r = computeRisk({ ...base, caseStoppages: st.slice(2), workerStoppages: st }, T);
    expect(r.factors.find((f) => f.facteur === "EPISODES")?.libelle).toBe("2 épisodes d'arrêt en 24 mois");
    expect(r.factors.find((f) => f.facteur === "CONTACT")).toBeUndefined();
    expect(sum(r)).toBe(r.score);
  });
});
