// Shared, dependency-free logic for the import pipeline.
// Used by server functions (file imports) and the public ingestion API.

export type FieldKey =
  | "company_name"
  | "company_siret"
  | "last_name"
  | "first_name"
  | "birth_date"
  | "email"
  | "phone"
  | "job_title"
  | "start_date"
  | "end_date"
  | "origin"
  | "kind";

export interface FieldDef {
  key: FieldKey;
  labelFr: string;
  required: boolean;
  synonyms: string[];
}

export const FIELDS: FieldDef[] = [
  {
    key: "company_name",
    labelFr: "Entreprise",
    required: true,
    synonyms: ["entreprise", "societe", "raison sociale", "employeur", "company", "etablissement", "adherent"],
  },
  {
    key: "company_siret",
    labelFr: "SIRET",
    required: false,
    synonyms: ["siret", "siren", "numero siret", "n siret", "identifiant entreprise"],
  },
  {
    key: "last_name",
    labelFr: "Nom du salarié",
    required: true,
    synonyms: ["nom", "nom salarie", "nom de famille", "nom usuel", "last name", "patronyme"],
  },
  {
    key: "first_name",
    labelFr: "Prénom du salarié",
    required: true,
    synonyms: ["prenom", "prenom salarie", "first name", "prenoms"],
  },
  {
    key: "birth_date",
    labelFr: "Date de naissance",
    required: false,
    synonyms: ["date de naissance", "naissance", "ddn", "date naiss", "birth date", "ne le"],
  },
  { key: "email", labelFr: "Email", required: false, synonyms: ["email", "mail", "courriel", "adresse mail"] },
  {
    key: "phone",
    labelFr: "Téléphone",
    required: false,
    synonyms: ["telephone", "tel", "portable", "mobile", "phone", "num tel"],
  },
  {
    key: "job_title",
    labelFr: "Poste",
    required: false,
    synonyms: ["poste", "emploi", "fonction", "metier", "intitule de poste", "job"],
  },
  {
    key: "start_date",
    labelFr: "Début de l'arrêt",
    required: true,
    synonyms: ["date debut", "debut arret", "debut", "date de debut arret", "start date", "du", "date darret"],
  },
  {
    key: "end_date",
    labelFr: "Fin de l'arrêt",
    required: false,
    synonyms: ["date fin", "fin arret", "fin", "date de fin arret", "end date", "au", "reprise prevue"],
  },
  {
    key: "origin",
    labelFr: "Origine",
    required: false,
    synonyms: ["origine", "nature", "type arret", "motif", "cause", "at mp", "nature de larret"],
  },
  {
    key: "kind",
    labelFr: "Type (initial / prolongation)",
    required: false,
    synonyms: ["type", "initial", "prolongation", "categorie", "suite"],
  },
];

export const FIELD_KEYS = FIELDS.map((f) => f.key);

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const at = new Set(a.split(" "));
  const bt = new Set(b.split(" "));
  let shared = 0;
  at.forEach((t) => {
    if (bt.has(t)) shared += 1;
  });
  return shared === 0 ? 0 : (2 * shared) / (at.size + bt.size);
}

export interface MappingSuggestion {
  header: string;
  field: FieldKey | null;
  confidence: number;
  source: "fuzzy" | "llm" | "none";
}

/** First pass: fuzzy header matching. Unresolved headers get field: null. */
export function suggestMappingFuzzy(headers: string[]): MappingSuggestion[] {
  const taken = new Set<FieldKey>();
  const scored = headers.map((header) => {
    const norm = normalizeHeader(header);
    let best: { field: FieldKey; score: number } | null = null;
    for (const field of FIELDS) {
      const candidates = [normalizeHeader(field.labelFr), ...field.synonyms];
      for (const candidate of candidates) {
        const score = similarity(norm, normalizeHeader(candidate));
        if (!best || score > best.score) best = { field: field.key, score };
      }
    }
    return { header, best };
  });

  scored.sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0));
  const resolved = new Map<string, MappingSuggestion>();
  for (const item of scored) {
    if (item.best && item.best.score >= 0.6 && !taken.has(item.best.field)) {
      taken.add(item.best.field);
      resolved.set(item.header, {
        header: item.header,
        field: item.best.field,
        confidence: Math.round(item.best.score * 100) / 100,
        source: "fuzzy",
      });
    } else {
      resolved.set(item.header, { header: item.header, field: null, confidence: 0, source: "none" });
    }
  }
  return headers.map((h) => resolved.get(h)!);
}

/* ---------------------------------- parsing --------------------------------- */

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export function parseDate(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number" && Number.isFinite(input)) {
    const ms = EXCEL_EPOCH + input * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const raw = String(input).trim();
  if (!raw) return null;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year > 50 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null;
    return d.toISOString().slice(0, 10);
  }
  return null;
}

export function parseOrigin(input: unknown): "MALADIE" | "AT" | "MP" {
  const v = normalizeHeader(String(input ?? ""));
  if (!v) return "MALADIE";
  if (/(^| )mp( |$)|maladie prof/.test(v)) return "MP";
  if (/(^| )at( |$)|accident du travail|accident travail|accident de trajet/.test(v)) return "AT";
  return "MALADIE";
}

export function parseKind(input: unknown): "INITIAL" | "PROLONGATION" {
  const v = normalizeHeader(String(input ?? ""));
  return /prolong|suite|renouv/.test(v) ? "PROLONGATION" : "INITIAL";
}

export function cleanSiret(input: unknown): string | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  return digits ? digits : null;
}

export interface NormalizedRow {
  rowNumber: number;
  company_name: string;
  company_siret: string | null;
  last_name: string;
  first_name: string;
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  start_date: string;
  end_date: string | null;
  origin: "MALADIE" | "AT" | "MP";
  kind: "INITIAL" | "PROLONGATION";
}

export type RawRow = Record<string, string>;

export function stringifyRaw(raw: Record<string, unknown>): RawRow {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));
}

export interface RowResult {
  rowNumber: number;
  raw: RawRow;
  normalized: NormalizedRow | null;
  errors: string[];
}

export type Mapping = Record<string, FieldKey | null>;

function pick(raw: Record<string, unknown>, mapping: Mapping, field: FieldKey): unknown {
  for (const [header, mapped] of Object.entries(mapping)) {
    if (mapped === field) return raw[header];
  }
  return undefined;
}

const text = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
};

export function validateRows(rows: Record<string, unknown>[], mapping: Mapping): RowResult[] {
  const seenInFile = new Set<string>();
  return rows.map((raw, index) => {
    const rowNumber = index + 2; // header is row 1
    const errors: string[] = [];

    const companyName = text(pick(raw, mapping, "company_name"));
    const siret = cleanSiret(pick(raw, mapping, "company_siret"));
    const lastName = text(pick(raw, mapping, "last_name"));
    const firstName = text(pick(raw, mapping, "first_name"));
    const startRaw = pick(raw, mapping, "start_date");
    const endRaw = pick(raw, mapping, "end_date");
    const birthRaw = pick(raw, mapping, "birth_date");

    const startDate = parseDate(startRaw);
    const endDate = parseDate(endRaw);
    const birthDate = parseDate(birthRaw);

    if (!companyName && !siret) errors.push("Entreprise manquante (nom ou SIRET requis)");
    if (!lastName) errors.push("Nom du salarié manquant");
    if (!firstName) errors.push("Prénom du salarié manquant");
    if (!startDate) errors.push("Date de début d'arrêt invalide ou manquante");
    if (endRaw !== undefined && endRaw !== null && String(endRaw).trim() !== "" && !endDate)
      errors.push("Date de fin invalide");
    if (birthRaw !== undefined && birthRaw !== null && String(birthRaw).trim() !== "" && !birthDate)
      errors.push("Date de naissance invalide");
    if (startDate && endDate && endDate < startDate) errors.push("La date de fin précède la date de début");
    if (siret && siret.length !== 14) errors.push(`SIRET invalide (14 chiffres attendus, reçu ${siret.length})`);

    const email = text(pick(raw, mapping, "email"));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Email invalide");

    let normalized: NormalizedRow | null = null;
    if (errors.length === 0) {
      const key = [siret ?? companyName, lastName, firstName, birthDate ?? "", startDate].join("|").toLowerCase();
      if (seenInFile.has(key)) {
        errors.push("Doublon dans le fichier (même salarié, même date de début)");
      } else {
        seenInFile.add(key);
        normalized = {
          rowNumber,
          company_name: companyName ?? `Entreprise ${siret}`,
          company_siret: siret,
          last_name: lastName!,
          first_name: firstName!,
          birth_date: birthDate,
          email,
          phone: text(pick(raw, mapping, "phone")),
          job_title: text(pick(raw, mapping, "job_title")),
          start_date: startDate!,
          end_date: endDate,
          origin: parseOrigin(pick(raw, mapping, "origin")),
          kind: parseKind(pick(raw, mapping, "kind")),
        };
      }
    }

    return { rowNumber, raw: stringifyRaw(raw), normalized, errors };
  });
}

/* ---------------------------------- hashing --------------------------------- */

export async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function rowFingerprint(row: NormalizedRow): string {
  return [
    (row.company_siret ?? row.company_name).toLowerCase(),
    row.last_name.toLowerCase(),
    row.first_name.toLowerCase(),
    row.birth_date ?? "",
    row.start_date,
    row.end_date ?? "",
    row.origin,
    row.kind,
  ].join("|");
}

/* ------------------------------- case creation ------------------------------ */

export function stoppageDurationDays(startDate: string, endDate: string | null): number {
  const start = Date.parse(startDate);
  const end = endDate ? Date.parse(endDate) : Date.now();
  return Math.floor((end - start) / 86400000) + 1;
}

/** A stoppage of 30 days or more, or any AT/MP stoppage, warrants a case. */
export function qualifiesForCase(row: NormalizedRow): boolean {
  if (row.origin === "AT" || row.origin === "MP") return true;
  return stoppageDurationDays(row.start_date, row.end_date) >= 30;
}
