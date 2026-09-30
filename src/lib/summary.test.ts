import { describe, expect, it } from "vitest";
import { approvedFacts, factsPrompt, verifyCitations, type SummaryEvent } from "./summary";

const ev = (id: string, status: string, label: string, page: number): SummaryEvent => ({ id, status, label, event_date: "2026-03-01", source_filename: "arret.pdf", source_page: page, confidentiality: "ADMINISTRATIVE" });
const events = [ev("a", "APPROVED", "Arrêt initial", 1), ev("b", "DRAFT", "Prolongation non validée", 2), ev("c", "REJECTED", "Fait rejeté", 3), ev("d", "APPROVED", "Reprise prévue", 4)];

describe("summary facts", () => {
  it("DRAFT and REJECTED facts are never sent", () => {
    const facts = approvedFacts(events);
    expect(facts.map((f) => f.id)).toEqual(["a", "d"]);
    const prompt = factsPrompt(facts);
    expect(prompt).not.toContain("Prolongation non validée");
    expect(prompt).not.toContain("Fait rejeté");
  });
  it("no approved fact -> nothing to summarise", () => {
    expect(approvedFacts([ev("b", "DRAFT", "x", 1)])).toEqual([]);
  });
});

describe("citation check", () => {
  const facts = approvedFacts(events);
  it("moves a sentence with an invented citation to 'Points à vérifier'", () => {
    const ai = "Contexte\nArrêt initial le 1er mars [arret.pdf, p.1]. Le salarié a été opéré [compte-rendu.pdf, p.7].\nChronologie clé\n- Reprise prévue [arret.pdf, p.4].";
    const { text, flagged } = verifyCitations(ai, facts);
    expect(flagged).toEqual(["Le salarié a été opéré [compte-rendu.pdf, p.7]."]);
    expect(text).toContain("Arrêt initial le 1er mars [arret.pdf, p.1].");
    expect(text).toContain("- Reprise prévue [arret.pdf, p.4].");
    const [body, points] = text.split("Points à vérifier");
    expect(body).not.toContain("opéré");
    expect(points).toContain("opéré");
  });
  it("a citation to a DRAFT fact (not sent) is invalid, and a sentence without citation is flagged", () => {
    const { flagged } = verifyCitations("Prolongation accordée [arret.pdf, p.2]. Le pronostic est bon.", facts);
    expect(flagged).toEqual(["Prolongation accordée [arret.pdf, p.2].", "Le pronostic est bon."]);
  });
  it("all valid -> no 'Points à vérifier' section", () => {
    const { text, flagged } = verifyCitations("Arrêt initial [arret.pdf, p.1].", facts);
    expect(flagged).toEqual([]);
    expect(text).not.toContain("Points à vérifier");
  });
});
