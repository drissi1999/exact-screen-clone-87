import { describe, expect, it } from "vitest";
import { computeGaps, fallbackQuestions, parseQuestions } from "./visit-prep";
import { computeDeadlines } from "./rules";
import { renderAvisLetter, renderAvisText } from "./message-templates";

describe("Préparer la visite", () => {
  it("detects missing documents, unvalidated facts and a conflicting return date", () => {
    const gaps = computeGaps({
      docTypes: ["COMPTE_RENDU"],
      episodeEnd: "2026-10-10",
      events: [
        { id: "1", event_date: "2026-09-25", label: "Chirurgie de la main : reprise envisagée le 14/10/2026", status: "DRAFT", source_filename: "cr.pdf", source_page: 1 },
      ],
    });
    expect(gaps.map((g) => g.code)).toEqual(["FICHE_POSTE", "ARRET", "FAITS_A_VALIDER", "DATE_CONFLIT"]);
    expect(gaps[3]!.text).toContain("14/10/2026");
    expect(gaps[3]!.text).toContain("cr.pdf, p.1");
  });
  it("always proposes 3 to 5 questions; rejects unusable AI output", () => {
    expect(fallbackQuestions([]).length).toBeGreaterThanOrEqual(3);
    expect(fallbackQuestions(computeGaps({ docTypes: [], events: [], episodeEnd: null })).length).toBeLessThanOrEqual(5);
    expect(parseQuestions('{"questions":["Comment allez-vous au travail ?","Quelles tâches vous gênent ?","Votre employeur a-t-il proposé un aménagement ?"]}')).toHaveLength(3);
    expect(parseQuestions("pas du json")).toBeNull();
  });
  it("a booked visit marks the matching deadline as planned", () => {
    const st = [{ start_date: "2026-06-01", end_date: "2026-09-20", origin: "MALADIE", kind: "INITIAL" }];
    const before = computeDeadlines(st, "MALADIE", "2026-09-30").find((d) => d.code === "VISITE_REPRISE")!;
    expect(before.status).toBe("DEPASSEE");
    const after = computeDeadlines(st, "MALADIE", "2026-09-30", { planned: { VISITE_REPRISE: "2026-10-02" } }).find((d) => d.code === "VISITE_REPRISE")!;
    expect(after.status).toBe("PLANIFIEE");
    expect(after.plannedOn).toBe("2026-10-02");
  });
  it("the employer avis and letter only contain the decision, restrictions and dates", () => {
    const v = { worker: "Karim Benali", jobTitle: "Cariste", company: "Logistique Vasseur", visitKind: "VISITE_REPRISE", visitDate: "2026-10-02", avisType: "APTITUDE_AMENAGEMENTS", restrictions: "Pas de port de charges de plus de 10 kg pendant 1 mois." };
    for (const t of [renderAvisText(v), renderAvisLetter(v)]) {
      expect(t).toContain("Apte avec aménagements");
      expect(t).toContain("10 kg");
      expect(t).not.toMatch(/lombalgie|diagnostic|traitement|pathologie/i);
    }
  });
});
