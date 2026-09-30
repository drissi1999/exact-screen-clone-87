// Server-only: synthetic French demo data. Never real people.
import { commitRows } from "./import-engine.server";
import type { NormalizedRow } from "./import-core";

const LAST_NAMES = [
  "Martin","Bernard","Dubois","Thomas","Robert","Richard","Petit","Durand","Leroy","Moreau",
  "Simon","Laurent","Lefebvre","Michel","Garcia","David","Bertrand","Roux","Vincent","Fournier",
  "Morel","Girard","André","Lefèvre","Mercier","Dupont","Lambert","Bonnet","François","Martinez",
];
const FIRST_NAMES = [
  "Camille","Julien","Nathalie","Sébastien","Sandrine","Nicolas","Isabelle","Karim","Aurélie","Mathieu",
  "Céline","Thierry","Fatima","Olivier","Sophie","Ludovic","Amandine","Pascal","Émilie","Younes",
];
const JOBS = [
  "Opérateur de production","Aide-soignante","Cariste","Agent d'entretien","Chauffeur poids lourd",
  "Employé libre-service","Technicien de maintenance","Assistante administrative","Maçon","Soudeur",
];
const COMPANIES = [
  { name: "Ateliers Mécaniques du Nord", siret: "39847503200014" },
  { name: "Clinique Saint-Amand", siret: "44219876500027" },
  { name: "Transports Delcourt", siret: "51032648700033" },
  { name: "Boulangeries Lambert & Fils", siret: "80274193600018" },
  { name: "Propreté Services Hauts-de-France", siret: "62918374500041" },
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
}

export async function seedDemo(client: any, tenantId: string) {
  const random = mulberry32(20260930);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]!;

  const rows: NormalizedRow[] = [];
  for (let i = 0; i < 300; i += 1) {
    const company = COMPANIES[i % COMPANIES.length]!;
    const lastName = pick(LAST_NAMES);
    const firstName = pick(FIRST_NAMES);
    const birthYear = 1962 + Math.floor(random() * 40);
    const opensCase = i < 60; // 60 dossiers ouverts
    const origin = opensCase && random() < 0.35 ? "AT" : "MALADIE";
    const startAgo = 10 + Math.floor(random() * 300);
    const duration = opensCase ? 30 + Math.floor(random() * 120) : 2 + Math.floor(random() * 20);

    rows.push({
      rowNumber: i + 2,
      company_name: company.name,
      company_siret: company.siret,
      last_name: lastName,
      first_name: `${firstName}`,
      birth_date: `${birthYear}-0${1 + Math.floor(random() * 9)}-1${Math.floor(random() * 9)}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@exemple.fr`.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      phone: `06${String(10000000 + Math.floor(random() * 89999999))}`,
      job_title: pick(JOBS),
      start_date: isoDate(startAgo),
      end_date: startAgo - duration > 0 ? isoDate(startAgo - duration) : null,
      origin: origin as NormalizedRow["origin"],
      kind: "INITIAL",
    });
  }

  return commitRows(client, tenantId, rows, { filename: "Jeu de démonstration", source: "FILE" });
}
