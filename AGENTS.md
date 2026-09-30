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
