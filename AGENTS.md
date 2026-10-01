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

- UI copy is French, code and identifiers English.
- Roles live in `user_roles` (never on profiles); confidentiality is decided in the database (`can_read_level()` in RLS, `private.actor_can_read()` in service-role functions), so server code never filters medical data by hand. Why: backend-layer enforcement of medical secrecy.
- RLS helper functions live in the `private` schema (not exposed by the API); tenant tables require `private.is_staff()`. Why: clears SECURITY DEFINER linter warnings and keeps employers off staff tables.
- Employer and worker portals read through server functions using the admin client with an explicit company/case filter and a column whitelist. Why: column-level medical secrecy cannot be expressed per role in RLS.
- MEDECIN_TRAVAIL/IDEST can only be granted/revoked by a MEDECIN_TRAVAIL of the same tenant (`private.can_manage_role` in the user_roles policies); first médecin via one-time `bootstrapMedecin` (tenants.medecin_bootstrapped_at). Why: admins must not self-escalate into medical data.
- Tests: `bun run test`; `tests/integration/*` create and delete throw-away users against the live backend. Why: RLS can only be proven against the real database.
- documents/case_events/ai_drafts/audit_log: clients only SELECT non-MEDICAL rows; all writes go through server functions with the admin client after `can_write_case`. MEDICAL reads only via service-role `staff_case_items`/`staff_document` (write the audit row); approval only via `review_draft`/`review_event` (guard_approval trigger blocks anything else). Why: tamper-proof approvals and complete medical-read audit.
- Confidentiality only rises automatically: triggers force clinical doc_types (CERTIFICAT_MEDICAL, COMPTE_RENDU, ARRET_TRAVAIL) and their events to MEDICAL; any lowering needs `lower_document_confidentiality` (service-only, MEDECIN_TRAVAIL, audited). Why: medical secrecy cannot depend on a correct manual choice.
- Shared presentation primitives (status/deadline badges, confidentiality labels, priority indicator, empty states) live in `src/components/kit.tsx`. Why: one badge style per meaning across the app.
- Feature-specific server rules (imports, deadlines, portals, plans, visits, demo, risk) live in `src/lib/AGENTS.md`.
