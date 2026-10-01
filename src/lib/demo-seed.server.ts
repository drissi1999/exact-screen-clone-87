/**
 * Demo data: reset of the caller's SPSTI and 12 fictional, dated-relative-to-today cases.
 * `db` is the service-role client; the caller must be SPSTI_ADMIN (checked here and in SQL).
 * Every person, company and document is fictional; each PDF is watermarked "DOCUMENT FICTIF".
 */
import { commitRows } from "./import-engine.server";
import type { NormalizedRow } from "./import-core";
import { addDays, milestonesFor, FOLLOWUPS, SCENARIO_LABELS, type Outcome, type Scenario } from "./plan-templates";
import { renderTemplate } from "./message-templates";
import { buildDemoPdf } from "./demo-pdf";
import { todayParis } from "./rules";

export const RESET_CONFIRMATION = "RÉINITIALISER";

async function assertAdmin(db: any, userId: string): Promise<string> {
  const { data: p } = await db.from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
  if (!p) throw new Error("Accès refusé");
  const { data: r } = await db.from("user_roles").select("role").eq("user_id", userId).eq("tenant_id", p.tenant_id).eq("role", "SPSTI_ADMIN");
  if (!(r ?? []).length) throw new Error("Réservé à l'administrateur du SPSTI");
  return p.tenant_id as string;
}

async function removeStorage(db: any, tenantId: string) {
  const bucket = db.storage.from("case-documents");
  const { data: folders } = await bucket.list(tenantId, { limit: 1000 });
  for (const f of folders ?? []) {
    const { data: files } = await bucket.list(`${tenantId}/${f.name}`, { limit: 1000 });
    const paths = (files ?? []).map((x: any) => `${tenantId}/${f.name}/${x.name}`);
    if (paths.length) await bucket.remove(paths);
  }
}

export async function resetDemo(db: any, userId: string, confirmation: string) {
  if (confirmation !== RESET_CONFIRMATION) throw new Error(`Tapez « ${RESET_CONFIRMATION} » pour confirmer`);
  const tenantId = await assertAdmin(db, userId);
  const { data, error } = await db.rpc("reset_demo", { _actor: userId });
  if (error) throw new Error("Réinitialisation refusée");
  await removeStorage(db, tenantId);
  return data as { cases: number; workers: number; companies: number };
}

/* --------------------------------- scenario --------------------------------- */

type Doc = { type: "ARRET_TRAVAIL" | "COMPTE_RENDU" | "FICHE_POSTE" | "COURRIER_EMPLOYEUR"; conf: string; file: string; title: string; lines: string[]; facts: { at: number; label: string; approved?: boolean }[] };
type Spec = {
  key: string; company: number; last: string; first: string; birth: string; job: string;
  stops: { from: number; to: number | null; origin: "MALADIE" | "AT" | "MP"; kind?: "INITIAL" | "PROLONGATION" }[];
  cpam?: boolean; knownAt?: number; avis?: { type: string; at: number }; closedAt?: number;
  plan?: { scenario: Scenario; status: "BROUILLON" | "EN_COURS"; target: number; actual?: number; done?: string[]; outcomes?: Record<string, Outcome> };
  docs: Doc[]; missing?: "DOC_DAT" | "DOC_FICHE_POSTE";
  /** Obligations already done: code -> day offset (plausible dates, so only deliberate problems stay red). */
  done?: Record<string, number>;
};

const COMPANIES = [
  { name: "Logistique Vasseur", siret: "41236987500012", headcount: 180 },
  { name: "Clinique des Tilleuls", siret: "52847193600025", headcount: 420 },
  { name: "Bâtiment Carlier", siret: "63958274100031", headcount: 35 },
  { name: "Cabinet Duhamel Conseil", siret: "74169385200047", headcount: 8 },
];

const arret = (d: (n: number) => string, from: number, to: number | null, kind: string, motif = "Motif médical : voir volet médical") : Doc => ({
  type: "ARRET_TRAVAIL", conf: "MEDICAL", file: `arret-${kind.toLowerCase()}-${from}.pdf`, title: `Avis d'arrêt de travail — ${kind === "INITIAL" ? "initial" : "prolongation"}`,
  lines: [`Date de début : ${fr(d(from))}`, `Date de fin : ${to == null ? "non précisée" : fr(d(to))}`, motif, "", "Praticien : Dr Fictif, médecin traitant (fictif)"],
  facts: [{ at: from, label: `Arrêt de travail ${kind === "INITIAL" ? "initial" : "(prolongation)"} du ${fr(d(from))}${to == null ? "" : ` au ${fr(d(to))}`}`, approved: true }],
});
const fr = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("fr-FR");

function specs(d: (n: number) => string): Spec[] {
  return [
    { key: "cariste", company: 0, last: "Benali", first: "Karim", birth: "1978-04-12", job: "Cariste", cpam: true, knownAt: -40, done: { DECLARATION_AT: -39, RESERVES_MOTIVEES: -33 },
      stops: [{ from: -40, to: 4, origin: "AT" }],
      docs: [arret(d, -40, 4, "INITIAL", "Accident du travail : chute de charge lors d'un déchargement"),
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-rhumato.pdf", title: "Compte rendu de consultation — rhumatologie", lines: ["Lombalgie aiguë post-traumatique, sans signe neurologique.", "Kinésithérapie 10 séances. Port de charges lourdes à éviter 4 semaines après la reprise."], facts: [{ at: -20, label: "Consultation rhumatologie : lombalgie post-traumatique, kinésithérapie prescrite", approved: true }] },
        { type: "FICHE_POSTE", conf: "PDP_SHARED", file: "fiche-poste-cariste.pdf", title: "Fiche de poste — Cariste", lines: ["Conduite de chariot élévateur, 8 h/jour, travail posté 2x8.", "Manutention manuelle ponctuelle jusqu'à 25 kg."], facts: [{ at: -15, label: "Fiche de poste reçue : cariste, manutention ponctuelle 25 kg", approved: true }] }] },
    { key: "aide-soignante", company: 1, last: "Morel", first: "Sandrine", birth: "1969-09-03", job: "Aide-soignante",
      stops: [{ from: -114, to: null, origin: "MP" }],
      plan: { scenario: "POSTE_AMENAGE", status: "EN_COURS", target: 5, done: ["ETUDE_POSTE", "DEVIS_AMENAGEMENT", "CONFIRMER_DATE"] },
      docs: [arret(d, -114, null, "INITIAL", "Maladie professionnelle : épaule (tableau 57)"),
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-orthopedie.pdf", title: "Compte rendu — orthopédie", lines: ["Tendinopathie de la coiffe des rotateurs droite.", "Pas d'élévation du bras au-dessus de l'épaule pendant 3 mois."], facts: [{ at: -60, label: "Orthopédie : tendinopathie de l'épaule droite, restriction d'élévation", approved: true }] },
        { type: "FICHE_POSTE", conf: "PDP_SHARED", file: "fiche-poste-as.pdf", title: "Fiche de poste — Aide-soignante", lines: ["Soins d'hygiène, mobilisation des patients, service de médecine."], facts: [{ at: -30, label: "Fiche de poste reçue : mobilisation de patients", approved: true }] },
        { type: "COURRIER_EMPLOYEUR", conf: "PDP_SHARED", file: "devis-leve-personne.pdf", title: "Devis — lève-personne sur rail", lines: ["Fourniture et pose d'un lève-personne plafonnier, chambre 12 à 18.", "Montant : 8 400 € HT (fictif)."], facts: [{ at: -8, label: "Devis d'aménagement reçu : lève-personne sur rail", approved: true }] }] },
    { key: "cadre", company: 3, last: "Lemaire", first: "Olivier", birth: "1975-01-22", job: "Cadre commercial",
      stops: [{ from: -212, to: -121, origin: "MALADIE", kind: "INITIAL" }, { from: -120, to: null, origin: "MALADIE", kind: "PROLONGATION" }],
      plan: { scenario: "MI_TEMPS_THERAPEUTIQUE", status: "BROUILLON", target: 21 },
      docs: [arret(d, -212, -121, "INITIAL"), arret(d, -120, null, "PROLONGATION"),
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-psychiatrie.pdf", title: "Compte rendu — psychiatrie", lines: ["Syndrome d'épuisement professionnel en voie d'amélioration.", "Reprise progressive envisageable en temps partiel thérapeutique."], facts: [{ at: -25, label: "Psychiatrie : épuisement en amélioration, reprise progressive envisageable", approved: true }] }] },
    { key: "poignet", company: 0, last: "Roussel", first: "Émilie", birth: "1991-06-30", job: "Préparatrice de commandes",
      stops: [{ from: -35, to: 10, origin: "MALADIE" }],
      docs: [{ ...arret(d, -35, 10, "INITIAL", "Fracture du poignet gauche, accident de trajet"), facts: [{ at: -35, label: `Arrêt de travail du ${fr(d(-35))} au ${fr(d(10))}` }] },
        // Conflicting date: the surgeon's report mentions a later return than the sick note.
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-chirurgie-main.pdf", title: "Compte rendu — chirurgie de la main", lines: ["Fracture de l'extrémité distale du radius, ostéosynthèse.", `Reprise du travail envisagée le ${fr(d(14))}.`], facts: [{ at: -5, label: `Chirurgie de la main : reprise envisagée le ${fr(d(14))} (différente de la fin d'arrêt du ${fr(d(10))})` }] }] },
    { key: "btp", company: 2, last: "Caron", first: "Thierry", birth: "1966-11-08", job: "Maçon coffreur (BTP)", cpam: true, knownAt: -80, done: { DECLARATION_AT: -78, RESERVES_MOTIVEES: -72 },
      stops: [{ from: -80, to: null, origin: "AT" }], avis: { type: "INAPTITUDE", at: -10 }, missing: "DOC_DAT",
      docs: [arret(d, -80, null, "INITIAL", "Accident du travail : chute de hauteur (échafaudage)"),
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-traumato.pdf", title: "Compte rendu — traumatologie", lines: ["Fracture du calcanéum droit. Station debout prolongée et travail en hauteur contre-indiqués."], facts: [{ at: -40, label: "Traumatologie : fracture du calcanéum, travail en hauteur contre-indiqué", approved: true }] },
        { type: "COURRIER_EMPLOYEUR", conf: "PDP_SHARED", file: "courrier-procedure-inaptitude.pdf", title: "Courrier — procédure d'inaptitude", lines: ["Le salarié a été déclaré inapte à son poste. Des propositions de reclassement sont attendues."], facts: [{ at: -10, label: "Avis d'inaptitude au poste rendu, recherche de reclassement ouverte", approved: true }] }] },
    { key: "secretaire", company: 2, last: "Fontaine", first: "Nathalie", birth: "1972-02-17", job: "Secrétaire",
      stops: [{ from: -270, to: null, origin: "MALADIE" }],
      plan: { scenario: "MI_TEMPS_THERAPEUTIQUE", status: "EN_COURS", target: 12 },
      docs: [arret(d, -270, null, "INITIAL"),
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-oncologie.pdf", title: "Compte rendu — oncologie", lines: ["Fin des traitements du cancer du sein. Fatigabilité persistante.", "Temps partiel thérapeutique recommandé."], facts: [{ at: -21, label: "Oncologie : traitements terminés, temps partiel thérapeutique recommandé", approved: true }] }] },
    { key: "nuit", company: 0, last: "Masson", first: "Julien", birth: "1983-08-25", job: "Opérateur de production (poste de nuit)",
      // Deliberate problem: back at work since 9 days, visite de reprise not organised (2 days late).
      stops: [{ from: -75, to: -10, origin: "MALADIE" }],
      docs: [{ type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-diabetologie.pdf", title: "Compte rendu — diabétologie", lines: ["Diabète de type 1 déséquilibré, adaptation de l'insulinothérapie.", "Horaires de nuit à discuter avec le médecin du travail."], facts: [{ at: -12, label: "Diabétologie : restrictions horaires (nuit) à discuter", approved: true }] },
        { type: "FICHE_POSTE", conf: "PDP_SHARED", file: "fiche-poste-nuit.pdf", title: "Fiche de poste — Opérateur de nuit", lines: ["Conduite de ligne, 21 h - 5 h, pauses fixes."], facts: [{ at: -6, label: "Fiche de poste reçue : poste de nuit 21 h - 5 h", approved: true }] }] },
    { key: "retour", company: 1, last: "Haddad", first: "Fatima", birth: "1980-12-05", job: "Agent de service hospitalier",
      stops: [{ from: -96, to: -22, origin: "MALADIE" }], done: { VISITE_REPRISE: -18 },
      plan: { scenario: "MEME_POSTE", status: "EN_COURS", target: -21, actual: -21, done: ["CONFIRMER_DATE", "PREPARER_ACCUEIL", "VISITE_REPRISE"], outcomes: { POINT_1S: "DIFFICULTES" } },
      docs: [arret(d, -96, -22, "INITIAL"),
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-visite-reprise.pdf", title: "Compte rendu — visite de reprise", lines: ["Apte à la reprise au même poste."], facts: [{ at: -18, label: "Visite de reprise : apte au même poste", approved: true }] }] },
    { key: "at-hier", company: 2, last: "Amrani", first: "Younes", birth: "1995-03-14", job: "Chauffeur-livreur", knownAt: -1,
      stops: [{ from: -1, to: null, origin: "AT" }],
      docs: [{ ...arret(d, -1, null, "INITIAL", "Accident du travail : entorse de la cheville en descendant du camion"), facts: [{ at: -1, label: `Accident du travail le ${fr(d(-1))}, arrêt initial` }] },
        { type: "COURRIER_EMPLOYEUR", conf: "ADMINISTRATIVE", file: "signalement-accident.pdf", title: "Signalement d'accident par l'employeur", lines: [`Accident survenu le ${fr(d(-1))} à 10 h 40 lors d'une livraison.`, "Déclaration CPAM en cours de préparation."], facts: [{ at: -1, label: "Signalement de l'accident par l'employeur" }] }] },
    { key: "prolongations", company: 1, last: "Dupuis", first: "Céline", birth: "1988-07-19", job: "Technicienne de laboratoire",
      stops: [{ from: -48, to: -34, origin: "MALADIE", kind: "INITIAL" }, { from: -33, to: -19, origin: "MALADIE", kind: "PROLONGATION" }, { from: -18, to: 1, origin: "MALADIE", kind: "PROLONGATION" }],
      docs: [arret(d, -48, -34, "INITIAL"), arret(d, -33, -19, "PROLONGATION"), arret(d, -18, 1, "PROLONGATION")] },
    { key: "courts", company: 3, last: "Leroy", first: "Pascal", birth: "1970-10-02", job: "Employé administratif",
      stops: [{ from: -760, to: -752, origin: "MALADIE" }, { from: -30, to: -24, origin: "MALADIE" }], docs: [] },
    { key: "clos", company: 0, last: "Petit", first: "Aurélie", birth: "1986-05-27", job: "Magasinière", closedAt: -70,
      stops: [{ from: -150, to: -80, origin: "MALADIE" }],
      docs: [arret(d, -150, -80, "INITIAL"),
        { type: "COMPTE_RENDU", conf: "MEDICAL", file: "cr-visite-reprise-clos.pdf", title: "Compte rendu — visite de reprise", lines: ["Apte au même poste sans restriction."], facts: [{ at: -76, label: "Visite de reprise : apte au même poste", approved: true }] },
        { type: "COURRIER_EMPLOYEUR", conf: "PDP_SHARED", file: "courrier-cloture.pdf", title: "Courrier — clôture de l'accompagnement", lines: ["Reprise au même poste confirmée par l'employeur."], facts: [{ at: -70, label: "Reprise au même poste confirmée, dossier clos", approved: true }] }] },
  ];
}

export const DEMO_CASE_COUNT = 11; // 12 situations; the two short leaves deliberately open no case.

export async function loadDemo(db: any, userId: string, today = todayParis()) {
  const tenantId = await assertAdmin(db, userId);
  const { count } = await db.from("cases").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  if (count) throw new Error("Réinitialisez la démo avant de la recharger");
  const d = (n: number) => addDays(today, n);
  const list = specs(d);

  const rows: NormalizedRow[] = [];
  let n = 2;
  for (const s of list) for (const st of s.stops) {
    const c = COMPANIES[s.company]!;
    rows.push({
      rowNumber: n++, company_name: c.name, company_siret: c.siret, last_name: s.last, first_name: s.first, birth_date: s.birth,
      email: `${s.first}.${s.last}@exemple-fictif.fr`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
      phone: null, job_title: s.job, start_date: d(st.from), end_date: st.to == null ? null : d(st.to), origin: st.origin, kind: st.kind ?? "INITIAL",
    } as NormalizedRow);
  }
  await commitRows(db, tenantId, rows, { filename: "Démo — 12 situations fictives", source: "FILE" });
  for (const c of COMPANIES) await db.from("companies").update({ headcount: c.headcount }).eq("tenant_id", tenantId).eq("siret", c.siret);

  const { data: cases } = await db.from("cases").select("id, workers!inner(last_name, first_name)").eq("tenant_id", tenantId);
  const caseOf = (s: Spec) => (cases ?? []).find((c: any) => c.workers.last_name === s.last && c.workers.first_name === s.first)?.id as string | undefined;
  const approve: string[] = [];

  for (const s of list) {
    const caseId = caseOf(s);
    if (!caseId) continue;
    const patch: Record<string, unknown> = {};
    if (s.cpam) patch["cpam_investigation"] = true;
    if (s.knownAt != null) patch["employer_known_at"] = d(s.knownAt);
    if (s.closedAt != null) { patch["status"] = "CLOSED"; patch["closed_at"] = d(s.closedAt); }
    if (Object.keys(patch).length) await db.from("cases").update(patch).eq("id", caseId);
    for (const [code, at] of Object.entries(s.done ?? {})) {
      await db.from("case_deadline_done").insert({ tenant_id: tenantId, case_id: caseId, code, done_on: d(at), done_by: userId });
    }
    if (s.avis) await db.from("case_avis").insert({ tenant_id: tenantId, case_id: caseId, avis_type: s.avis.type, avis_date: d(s.avis.at), created_by: userId });

    for (const doc of s.docs) {
      const path = `${tenantId}/${caseId}/demo-${doc.file}`;
      const bytes = buildDemoPdf(doc.title, [`Salarié : ${s.first} ${s.last} (personne fictive)`, `Entreprise : ${COMPANIES[s.company]!.name}`, "", ...doc.lines]);
      const { error: upErr } = await db.storage.from("case-documents").upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) throw new Error("Dépôt des documents de démo impossible");
      const { data: row, error } = await db.from("documents").insert({
        tenant_id: tenantId, case_id: caseId, filename: doc.file, storage_path: path, mime_type: "application/pdf", doc_type: doc.type,
        confidentiality: doc.conf, page_count: 1, extracted_text: `${doc.title}\n${doc.lines.join("\n")}`, analysis_status: "DONE", uploaded_by: userId, source: "STAFF",
      }).select("id").single();
      if (error) throw new Error("Documents de démo : insertion impossible");
      for (const f of doc.facts) {
        const { data: ev } = await db.from("case_events").insert({ tenant_id: tenantId, case_id: caseId, event_date: d(f.at), label: f.label, source_document_id: row.id, source_page: 1, confidentiality: doc.conf }).select("id").single();
        if (f.approved && ev) approve.push(ev.id);
      }
    }
    if (s.missing) {
      const t = renderTemplate(s.missing, {});
      await db.from("coordination_tasks").insert({ tenant_id: tenantId, case_id: caseId, recipient: t.recipient, channel: t.channel, purpose: "Document manquant", message: t.message, template_code: t.template_code, status: "SENT", sent_at: new Date(Date.parse(`${d(-6)}T09:00:00Z`)).toISOString(), due_at: d(1) });
    }
    if (s.plan) await seedPlan(db, tenantId, userId, caseId, s.plan, d);
  }
  if (approve.length) {
    const { error } = await db.rpc("demo_approve_events", { _actor: userId, _ids: approve });
    if (error) throw new Error("Validation des faits de démo impossible");
  }
  await db.from("audit_log").insert({ tenant_id: tenantId, user_id: userId, action: "DEMO_LOAD", entity: "tenants" });
  return { cases: (cases ?? []).length, situations: list.length };
}

async function seedPlan(db: any, tenantId: string, userId: string, caseId: string, p: NonNullable<Spec["plan"]>, d: (n: number) => string) {
  const { data: plan } = await db.from("return_plans").insert({
    tenant_id: tenantId, case_id: caseId, target_date: d(p.target), actual_return_date: p.actual != null ? d(p.actual) : null,
    scenario: p.scenario, status: p.status, partners: [], created_by: userId,
  }).select("id").single();
  const followCodes = FOLLOWUPS.map((f) => f.code);
  const ms = milestonesFor(p.scenario, d(p.target)).filter((m) => !(p.actual != null && followCodes.includes(m.code)))
    .map((m) => ({ ...m, kind: "MILESTONE" }));
  const fu = p.actual != null ? milestonesFor(p.scenario, d(p.actual), FOLLOWUPS).map((m) => ({ ...m, kind: "FOLLOWUP" })) : [];
  const now = new Date().toISOString();
  await db.from("plan_tasks").insert([...ms, ...fu].map((m) => {
    const outcome = m.kind === "FOLLOWUP" ? p.outcomes?.[m.code] ?? null : null;
    const done = (p.done ?? []).includes(m.code) || !!outcome;
    return { ...m, tenant_id: tenantId, plan_id: plan.id, case_id: caseId, status: done ? "DONE" : "TODO", outcome, done_at: done ? now : null, done_by: done ? userId : null };
  }));
  await db.rpc("add_plan_event", { _actor: userId, _case: caseId, _label: `Plan de retour créé — ${SCENARIO_LABELS[p.scenario]}, reprise visée le ${fr(d(p.target))}` });
  if (p.actual != null) await db.rpc("add_plan_event", { _actor: userId, _case: caseId, _label: `Reprise effective le ${fr(d(p.actual))} — suivis planifiés à J+7, J+30 et J+90` });
}
