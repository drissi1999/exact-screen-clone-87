import { describe, expect, it } from "vitest";
import { addDaysExclSundaysHolidays, addJoursFrancs, addMonths, computeDeadlines, episodeDuration, episodes, frenchHolidays, type CaseFacts, type Stoppage } from "./rules";

const s = (start: string, end: string | null, origin = "MALADIE", kind = "PROLONGATION"): Stoppage => ({ start_date: start, end_date: end, origin, kind });
const codes = (st: Stoppage[], origin: string, today = "2026-06-01") => computeDeadlines(st, origin, today).map((d) => d.code).sort();
const get = (st: Stoppage[], origin: string, code: string, today = "2026-06-01") => computeDeadlines(st, origin, today).find((d) => d.code === code);

describe("episodes: only contiguous periods merge", () => {
  it("two stoppages years apart are two episodes; deadlines use only the latest", () => {
    const st = [s("2020-01-01", "2020-03-31", "MALADIE", "INITIAL"), s("2023-05-01", "2023-05-10", "MALADIE", "INITIAL")];
    expect(episodes(st)).toHaveLength(2);
    expect(episodeDuration(episodes(st).at(-1)!)).toBe(10);
    expect(codes(st, "MALADIE")).toEqual([]);
  });

  it("a gap of exactly 1 day starts a new episode", () => {
    const st = [s("2026-01-01", "2026-01-20", "MALADIE", "INITIAL"), s("2026-01-22", "2026-02-10")];
    const eps = episodes(st);
    expect(eps).toHaveLength(2);
    expect(eps[1]!.start).toBe("2026-01-22");
    expect(episodeDuration(eps[1]!)).toBe(20);
  });

  it("an extension starting the day after the previous end is merged", () => {
    const eps = episodes([s("2026-01-01", "2026-01-20", "MALADIE", "INITIAL"), s("2026-01-21", "2026-01-31")]);
    expect(eps).toHaveLength(1);
    expect(episodeDuration(eps[0]!)).toBe(31);
  });

  it("initial + 2 contiguous extensions crossing 30 then 60 days", () => {
    const init = s("2026-01-01", "2026-01-20", "MALADIE", "INITIAL"); // 20 d
    const ext1 = s("2026-01-21", "2026-02-10"); // total 41 d
    const ext2 = s("2026-02-11", "2026-03-05"); // total 64 d
    expect(codes([init], "MALADIE")).toEqual([]);
    expect(codes([init, ext1], "MALADIE")).toEqual(["PRE_REPRISE", "RDV_LIAISON"]);
    expect(codes([init, ext1, ext2], "MALADIE")).toEqual(["PRE_REPRISE", "RDV_LIAISON", "VISITE_REPRISE"]);
    const v = get([init, ext1, ext2], "MALADIE", "VISITE_REPRISE")!;
    expect(v.from).toBe("2026-03-06");
    expect(v.due).toBe("2026-03-13");
    expect(get([init, ext1], "MALADIE", "PRE_REPRISE")!.from).toBe("2026-01-31");
  });

  it("overlapping extensions are merged without double counting", () => {
    const st = [s("2026-01-01", "2026-01-31", "MALADIE", "INITIAL"), s("2026-01-15", "2026-02-20"), s("2026-02-01", "2026-02-10")];
    const eps = episodes(st);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.end).toBe("2026-02-20");
    expect(episodeDuration(eps[0]!)).toBe(51);
  });

  it("an open-ended current stoppage runs until today", () => {
    const st = [s("2026-01-01", "2026-01-31", "AT", "INITIAL"), s("2026-02-01", null, "AT")];
    const eps = episodes(st);
    expect(eps).toHaveLength(1);
    expect(eps[0]!.end).toBeNull();
    expect(episodeDuration(eps[0]!, "2026-02-15")).toBe(46);
    const v = get(st, "AT", "VISITE_REPRISE", "2026-02-15")!;
    expect(v.status).toBe("INFO");
    expect(v.due).toBeNull();
    expect(get(st, "AT", "PRE_REPRISE", "2026-02-15")!.status).toBe("EN_COURS");
  });

  it("an open-ended stoppage absorbs a later one", () => {
    expect(episodes([s("2026-01-01", null, "MALADIE", "INITIAL"), s("2026-03-01", "2026-03-10")])).toHaveLength(1);
  });
});

describe("AT vs maladie at exactly 30 and 60 days", () => {
  const d30 = [s("2026-01-01", "2026-01-30", "X", "INITIAL")]; // 30 days
  const d31 = [s("2026-01-01", "2026-01-31", "X", "INITIAL")]; // 31 days
  const d59 = [s("2026-01-01", "2026-02-28", "X", "INITIAL")]; // 59 days
  const d60 = [s("2026-01-01", "2026-03-01", "X", "INITIAL")]; // 60 days

  it("AT at 30 days: visite de reprise required; no pré-reprise (needs > 30)", () => {
    expect(codes(d30, "AT")).toContain("VISITE_REPRISE");
    expect(codes(d30, "AT")).not.toContain("PRE_REPRISE");
  });
  it("maladie at 30 days: nothing", () => {
    expect(codes(d30, "MALADIE")).toEqual([]);
  });
  it("31 days opens pré-reprise and liaison for both", () => {
    expect(codes(d31, "MALADIE")).toEqual(["PRE_REPRISE", "RDV_LIAISON"]);
    expect(codes(d31, "AT")).toEqual(expect.arrayContaining(["PRE_REPRISE", "RDV_LIAISON", "VISITE_REPRISE"]));
  });
  it("maladie at 59 days: no visite de reprise; at 60 days: required", () => {
    expect(codes(d59, "MALADIE")).not.toContain("VISITE_REPRISE");
    expect(codes(d60, "MALADIE")).toContain("VISITE_REPRISE");
    expect(get(d60, "MALADIE", "VISITE_REPRISE")!.due).toBe("2026-03-09");
  });
  it("AT at 60 days: visite de reprise required", () => {
    expect(codes(d60, "AT")).toContain("VISITE_REPRISE");
  });
});

const at = (start: string) => [s(start, "2026-12-31", "AT", "INITIAL")];
const due = (st: Stoppage[], origin: string, code: string, facts: CaseFacts = {}) =>
  computeDeadlines(st, origin, "2026-06-01", facts).find((d) => d.code === code)?.due;

describe("calendar", () => {
  it("French public holidays 2026 (Easter-based included)", () => {
    const h = frenchHolidays(2026);
    for (const d of ["2026-01-01", "2026-04-06", "2026-05-01", "2026-05-08", "2026-05-14", "2026-05-25", "2026-07-14", "2026-08-15", "2026-11-01", "2026-11-11", "2026-12-25"]) expect(h.has(d)).toBe(true);
    expect(h.size).toBe(11);
    expect(h.has("2026-04-05")).toBe(false); // Easter Sunday is not a separate public holiday
  });
  it("month addition clamps to the month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-15", 1)).toBe("2026-04-15");
    expect(addMonths("2026-12-10", 1)).toBe("2027-01-10");
  });
});

describe("DECLARATION_AT: 48 h excluding Sundays and public holidays", () => {
  it("accident on a Friday: due Monday (Sunday skipped)", () => {
    expect(due(at("2026-07-10"), "AT", "DECLARATION_AT")).toBe("2026-07-13");
  });
  it("accident on 14 July (Tuesday): due Thursday 16", () => {
    expect(due(at("2026-07-14"), "AT", "DECLARATION_AT")).toBe("2026-07-16");
  });
  it("accident on Monday 13 July: 14 July skipped, due Thursday 16", () => {
    expect(due(at("2026-07-13"), "AT", "DECLARATION_AT")).toBe("2026-07-16");
  });
  it("accident on a Saturday before a Monday holiday (Pentecost 2026): due Wednesday", () => {
    expect(due(at("2026-05-23"), "AT", "DECLARATION_AT")).toBe("2026-05-27");
  });
  it("Saturday counts as a working day: accident Thursday, due Saturday", () => {
    expect(addDaysExclSundaysHolidays("2026-07-09", 2)).toBe("2026-07-11");
  });
  it("counts from the date the employer learned of it, when given", () => {
    const d = computeDeadlines(at("2026-07-01"), "AT", "2026-06-01", { employerKnownAt: "2026-07-10" }).find((x) => x.code === "DECLARATION_AT")!;
    expect(d.from).toBe("2026-07-10");
    expect(d.due).toBe("2026-07-13");
  });
  it("not produced for maladie", () => {
    expect(due([s("2026-07-10", "2026-07-20", "MALADIE", "INITIAL")], "MALADIE", "DECLARATION_AT")).toBeUndefined();
  });
});

describe("RESERVES_MOTIVEES: 10 jours francs", () => {
  it("from the declaration deadline, working-day end stays", () => {
    expect(due(at("2026-07-10"), "AT", "RESERVES_MOTIVEES")).toBe("2026-07-23");
  });
  it("ending on a Saturday moves to Monday", () => {
    // declaration due Wed 27 May -> +10 = Sat 6 June -> Mon 8 June
    expect(due(at("2026-05-23"), "AT", "RESERVES_MOTIVEES")).toBe("2026-06-08");
  });
  it("ending on a public holiday moves to the next working day", () => {
    expect(addJoursFrancs("2026-11-01", 10)).toBe("2026-11-12"); // 11 Nov is a holiday
  });
});

describe("CPAM decisions", () => {
  it("AT: 30 days, 90 if investigation", () => {
    expect(due(at("2026-07-10"), "AT", "CPAM_DECISION_AT")).toBe("2026-08-12");
    expect(due(at("2026-07-10"), "AT", "CPAM_DECISION_AT", { cpamInvestigation: true })).toBe("2026-10-11");
  });
  it("MP: 120 days, AT rules not produced", () => {
    const st = [s("2026-01-01", "2026-02-01", "MP", "INITIAL")];
    expect(due(st, "MP", "CPAM_DECISION_MP")).toBe("2026-05-01");
    expect(due(st, "MP", "CPAM_DECISION_AT")).toBeUndefined();
    expect(due(st, "MP", "DECLARATION_AT")).toBeUndefined();
  });
});

describe("avis-based rules", () => {
  const st = [s("2026-01-01", "2026-03-31", "MALADIE", "INITIAL")];
  it("INAPTITUDE_SALARY_RESUMES: 1 month after an avis d'inaptitude", () => {
    expect(due(st, "MALADIE", "INAPTITUDE_SALARY_RESUMES", { avis: { type: "INAPTITUDE", date: "2026-04-15" } })).toBe("2026-05-15");
    expect(due(st, "MALADIE", "INAPTITUDE_SALARY_RESUMES", { avis: { type: "INAPTITUDE", date: "2026-01-31" } })).toBe("2026-02-28");
  });
  it("no salary rule after an avis d'aptitude", () => {
    expect(due(st, "MALADIE", "INAPTITUDE_SALARY_RESUMES", { avis: { type: "APTITUDE", date: "2026-04-15" } })).toBeUndefined();
  });
  it("CONTESTATION_AVIS: 15 days after any avis; absent without avis", () => {
    expect(due(st, "MALADIE", "CONTESTATION_AVIS", { avis: { type: "APTITUDE_AMENAGEMENTS", date: "2026-04-15" } })).toBe("2026-04-30");
    expect(due(st, "MALADIE", "CONTESTATION_AVIS")).toBeUndefined();
  });
});

it("every rule is flagged 'à valider juridiquement'", () => {
  const all = computeDeadlines([s("2026-01-01", "2026-03-31", "AT", "INITIAL")], "AT", "2026-06-01", { avis: { type: "INAPTITUDE", date: "2026-04-01" } });
  expect(all.length).toBeGreaterThanOrEqual(8);
  expect(all.every((d) => d.toValidate === true)).toBe(true);
});

describe("obligations vs possibilities", () => {
  const ended = [s("2026-01-01", "2026-03-31", "MALADIE", "INITIAL")];
  it("optional steps become 'Non réalisé' once the episode has ended, never overdue", () => {
    for (const code of ["RDV_LIAISON", "PRE_REPRISE"]) {
      const d = get(ended, "MALADIE", code)!;
      expect(d.kind).toBe("POSSIBILITE");
      expect(d.status).toBe("NON_REALISE");
    }
  });
  it("only legal obligations can be overdue; informative dates become 'Échue'", () => {
    const all = computeDeadlines([s("2026-01-01", "2026-03-31", "AT", "INITIAL")], "AT", "2026-09-01", { avis: { type: "INAPTITUDE", date: "2026-04-01" } });
    for (const d of all) if (d.status === "DEPASSEE") expect(d.kind).toBe("OBLIGATION");
    expect(all.find((d) => d.code === "CPAM_DECISION_AT")!.status).toBe("ECHUE");
    expect(all.find((d) => d.code === "CONTESTATION_AVIS")!.status).toBe("ECHUE");
    expect(all.find((d) => d.code === "DECLARATION_AT")!.status).toBe("DEPASSEE");
  });
});

describe("applicable rules only, and 'Marquer comme fait'", () => {
  it("no avis: no contestation nor salary rule; aptitude avis: contestation only", () => {
    const st = [s("2026-01-01", "2026-03-31", "MALADIE", "INITIAL")];
    expect(codes(st, "MALADIE")).not.toContain("CONTESTATION_AVIS");
    expect(codes(st, "MALADIE")).not.toContain("INAPTITUDE_SALARY_RESUMES");
    const withAvis = computeDeadlines(st, "MALADIE", "2026-06-01", { avis: { type: "APTITUDE", date: "2026-04-01" } }).map((d) => d.code);
    expect(withAvis).toContain("CONTESTATION_AVIS");
    expect(withAvis).not.toContain("INAPTITUDE_SALARY_RESUMES");
  });
  it("CPAM rules only for AT/MP", () => {
    const st = [s("2026-01-01", "2026-03-31", "MALADIE", "INITIAL")];
    expect(codes(st, "MALADIE").some((c) => c.startsWith("CPAM"))).toBe(false);
  });
  it("an obligation marked done turns FAIT with its date, and is no longer overdue", () => {
    const st = [s("2026-01-01", "2026-03-31", "AT", "INITIAL")];
    const d = computeDeadlines(st, "AT", "2026-09-01", { done: { DECLARATION_AT: "2026-01-02" } }).find((x) => x.code === "DECLARATION_AT")!;
    expect(d.status).toBe("FAIT");
    expect(d.doneOn).toBe("2026-01-02");
  });
});
