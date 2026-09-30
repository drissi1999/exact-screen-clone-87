import { describe, expect, it } from "vitest";
import { computeDeadlines, episodeDuration, episodes, type Stoppage } from "./rules";

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
    expect(codes(d30, "AT")).toEqual(["DECLARATION_AT", "VISITE_REPRISE"]);
  });
  it("maladie at 30 days: nothing", () => {
    expect(codes(d30, "MALADIE")).toEqual([]);
  });
  it("31 days opens pré-reprise and liaison for both", () => {
    expect(codes(d31, "MALADIE")).toEqual(["PRE_REPRISE", "RDV_LIAISON"]);
    expect(codes(d31, "AT")).toEqual(["DECLARATION_AT", "PRE_REPRISE", "RDV_LIAISON", "VISITE_REPRISE"]);
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
