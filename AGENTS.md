<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules

- Import logic is split in three layers: `src/lib/import-core.ts` (pure parsing/validation, runs on both client and server), `src/lib/import-engine.server.ts` (database writes), `src/lib/imports.functions.ts` (server functions). Keeps the same validation rules usable in the browser preview and in the public ingest API.
- All values exchanged with server functions must be JSON-serialisable primitives; raw import rows are stringified (`stringifyRaw`) because TanStack Start rejects `unknown` in server-function return types.
- CSV uploads are decoded explicitly as UTF-8 before parsing; the spreadsheet reader otherwise guesses a legacy codepage and mangles accents.
- UI copy is French, code and identifiers English.
- Roles live in `user_roles` (never on profiles); confidentiality is decided in the database (`can_read_level()` in RLS, `private.actor_can_read()` in service-role functions), so server code never filters medical data by hand. Why: backend-layer enforcement of medical secrecy.
- Legal deadlines only come from `src/lib/rules.ts`. Why: spec forbids inline deadline logic.
- Employer-facing documents are built from templates with no medical inputs; AI outputs inherit `maxConfidentiality` of their inputs and stay DRAFT until approved by `required_role`.
- RLS helper functions live in the `private` schema (not exposed by the API); tenant tables require `private.is_staff()`. Why: clears SECURITY DEFINER linter warnings and keeps employers off staff tables.
- Employer and worker portals read through server functions using the admin client with an explicit company/case filter and a column whitelist. Why: column-level medical secrecy cannot be expressed per role in RLS.
- Worker access = single-use 15-min link exchanged for a 30-min server session (`worker_links`/`worker_sessions`, service-role only). Why: workers have no account.
- Invited employers are moved into the inviting tenant in `acceptInvitation` (the signup trigger cannot see app_metadata at insert time).
- Admin "Voir en tant que" (/apercu): employer view reuses `getEmployerPortal` with `asCompanyId` (admin-only, read-only, audited); worker view issues a real worker link without a simulated SMS. Why: admin sees exactly what each audience sees, through the same code path.
- MEDECIN_TRAVAIL/IDEST can only be granted/revoked by a MEDECIN_TRAVAIL of the same tenant (`private.can_manage_role` in the user_roles policies); first médecin via one-time `bootstrapMedecin` (tenants.medecin_bootstrapped_at). Why: admins must not self-escalate into medical data.
- Tests: `bun run test`; `tests/integration/*` create and delete throw-away users against the live backend. Why: RLS can only be proven against the real database.
- documents/case_events/ai_drafts/audit_log: clients only SELECT non-MEDICAL rows; all writes go through server functions with the admin client after `can_write_case`. MEDICAL reads only via service-role `staff_case_items`/`staff_document` (write the audit row); approval only via `review_draft`/`review_event` (guard_approval trigger blocks anything else). Why: tamper-proof approvals and complete medical-read audit.
- Confidentiality only rises automatically: triggers force clinical doc_types (CERTIFICAT_MEDICAL, COMPTE_RENDU, ARRET_TRAVAIL) and their events to MEDICAL; any lowering needs `lower_document_confidentiality` (service-only, MEDECIN_TRAVAIL, audited). Why: medical secrecy cannot depend on a correct manual choice.
- Employer/worker-facing text only comes from `src/lib/message-templates.ts`; coordination_tasks are written server-side only and a trigger forbids editing templated messages. Portals show `genericDocTitle`, never filenames (except the worker's own uploads).
- Staff documents reach employer/worker portals only if `visibleInPortal` (src/lib/portal-visibility.ts): analysis DONE, not clinical, released via `release_document` (service-only, MEDECIN_TRAVAIL/IDEST, audited). Any reclassification/level/status change withdraws the release (trigger). Why: a wrongly-labelled clinical file must never leak before a clinician checks it.
- Deadlines are computed from the case's stoppages (`case_id`) and only the current contiguous episode (`episodes()` in rules.ts); a gap of 1+ day starts a new episode.
- Imports insert stoppages case-less, then `reconcileWorkerCases` (import-engine.server.ts) groups the worker's stoppages with `episodes()` and opens/attaches a case per qualifying episode (>= 30 days or AT/MP). Why: extended short sick leaves are the common pattern; one rule for file, API and backfill.
- Rule inputs beyond stoppages come from `loadCaseFacts` (cases.employer_known_at, cases.cpam_investigation, latest `case_avis`); avis are entered by MEDECIN_TRAVAIL only via `addAvis`. Every Deadline carries `toValidate` and is shown "à valider juridiquement".
- Case summaries use APPROVED facts only; `verifyCitations` (src/lib/summary.ts) moves any sentence whose citation is missing or not among the sent facts to "Points à vérifier"; ai_drafts stores `source_fact_ids` and `model`. Why: no unsourced claim in a medical summary.
- Access links (worker, employer invitation) are never stored in clear: simulated messages carry "[lien sécurisé]", the real link is returned once to its creator (`issueWorkerLink` in worker-links.server.ts). Why: staff-readable tables must not leak tokens.
- Uploads accept only PDF/JPEG/PNG/HEIC by magic bytes (`src/lib/file-signature.ts`), for staff (checked on the stored object in registerDocument), employer and worker; the detected type is stored. Why: declared types are attacker-controlled.
- Risk score: weights only in `src/lib/risk-config.ts` (max sum 100), pure `computeRisk` in risk.ts, `scoreCases` (my-day.server.ts) reads only `RISK_TABLES` (no documents/events/drafts) and stores {score, factors} in `case_risk_scores` (staff-only RLS). Why: explainable, coordinator-safe score.
- "Ma journée" is built server-side by `buildMyDay` (staff only via `assertStaff`); draft-fact/publishable counts come from service-only `my_day_documents` (level-filtered). Sign-in lands on `/accueil`, which routes IDEST/PDP_COORDINATOR to `/ma-journee`, employers to `/employeur`, others to the dashboard.
- Return-to-work plan: milestones only from `src/lib/plan-templates.ts`; plans/tasks written server-side only (`return-plan.server.ts`), staff-only RLS reads; portals get title/date/status only for their own owner role; plan changes become APPROVED PDP_SHARED facts via service-only `add_plan_event`. Why: fixed non-clinical wording and tamper-proof chronology.
- Demo data: `demo-seed.server.ts` only — `resetDemo` (typed "RÉINITIALISER", SPSTI_ADMIN, service-only `reset_demo` SQL deletes the caller's tenant business data, never users/profiles/roles/settings, keeps companies linked to employer accounts, logs DEMO_RESET) and `loadDemo` (12 situations dated relative to today, watermarked PDFs from `demo-pdf.ts`, seeded facts approved via service-only `demo_approve_events`). Why: repeatable, always-current demos.
- Plan follow-up alerts close only via `acknowledgeAlert` (mandatory note, audited PLAN_ALERT_ACK); template POINT_* milestones cannot be completed before the actual return date.
- Shared presentation primitives (status/deadline badges, confidentiality labels, priority indicator, empty states) live in `src/components/kit.tsx`. Why: one badge style per meaning across the app.
- Visits (`visits` table, staff-only RLS, server-only writes in `visits.server.ts`): a booked visit marks its deadline PLANIFIEE through `loadCaseFacts().planned`; preparation is médecin/IDEST only and reads medical content via `staff_case_items` (audited); outcome is MEDECIN_TRAVAIL only and creates EMPLOYER_VISIBLE avis + letter drafts from fixed templates (`renderAvisText`/`renderAvisLetter`), the `case_avis` row is written only when the avis draft is approved (`onDraftApproved`). Why: employer gets only date and approved wording; avis never counts before the médecin signs it.
