/** Explainable risk score (pure). Inputs are administrative only: stoppages, age, job title, avis type, contacts, company size. */
import { RISK_WEIGHTS as W } from "./risk-config";
import { episodes, episodeDuration, todayParis, type Stoppage } from "./rules";

export type RiskFactor = { facteur: string; points: number; libelle: string };
export type RiskResult = { score: number; factors: RiskFactor[] };
export type RiskInput = {
  caseStoppages: Stoppage[];
  workerStoppages: Stoppage[];
  origin: string | null;
  birthDate: string | null;
  jobTitle: string | null;
  avisType: string | null;
  lastWorkerContact: string | null; // ISO date of last task sent/done to the worker
  companyHeadcount: number | null;
};

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
function ageAt(birth: string, today: string) {
  let age = Number(today.slice(0, 4)) - Number(birth.slice(0, 4));
  if (today.slice(5) < birth.slice(5)) age--;
  return age;
}
function minus24Months(today: string) {
  return `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
}

export function computeRisk(i: RiskInput, today = todayParis()): RiskResult {
  const f: RiskFactor[] = [];
  const add = (facteur: string, points: number, libelle: string) => { if (points > 0) f.push({ facteur, points, libelle }); };

  const cur = episodes(i.caseStoppages).at(-1);
  if (cur) {
    const d = episodeDuration(cur, today);
    const band = W.duration.find((b) => d >= b.minDays);
    if (band) add("DUREE", band.points, `Arrêt continu de ${d} jours`);
  }
  const since = minus24Months(today);
  const n = episodes(i.workerStoppages).filter((e) => e.start >= since).length;
  const eb = W.episodes24m.find((b) => n >= b.min);
  if (eb) add("EPISODES", eb.points, `${n} épisodes d'arrêt en 24 mois`);
  const origin = i.origin ?? cur?.stoppages[0]?.origin ?? null;
  if (origin === "AT" || origin === "MP") add("ORIGINE", W.originAtMp, origin === "AT" ? "Accident du travail" : "Maladie professionnelle");
  if (i.birthDate) {
    const a = ageAt(i.birthDate, today);
    const ab = W.age.find((b) => a >= b.minAge);
    if (ab) add("AGE", ab.points, `${ab.minAge} ans et plus`);
  }
  if (i.jobTitle) {
    const t = fold(i.jobTitle);
    const kw = W.physicalJob.keywords.find((k) => t.includes(k));
    if (kw) add("POSTE", W.physicalJob.points, `Poste physique (${i.jobTitle})`);
  }
  if (i.avisType && W.avis[i.avisType]) add("AVIS", W.avis[i.avisType]!, i.avisType === "INAPTITUDE" ? "Avis d'inaptitude antérieur" : "Avis avec aménagements");
  if (!i.lastWorkerContact || daysBetween(i.lastWorkerContact.slice(0, 10), today) >= W.noContact.days)
    add("CONTACT", W.noContact.points, i.lastWorkerContact ? `Aucun contact depuis ${daysBetween(i.lastWorkerContact.slice(0, 10), today)} jours` : "Aucun contact avec le salarié");
  if (i.companyHeadcount != null) {
    const cb = W.companySize.find((b) => i.companyHeadcount! <= b.maxHeadcount);
    if (cb) add("TAILLE", cb.points, `Petite entreprise (${i.companyHeadcount} salariés)`);
  }
  f.sort((a, b) => b.points - a.points);
  const score = Math.min(100, f.reduce((s, x) => s + x.points, 0));
  return { score, factors: f };
}
