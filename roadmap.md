# Roadmap
## Code review fixes (in order, with tests)
- [x] 1) Médecin/IDEST roles grantable only by a médecin of same tenant + bootstrap; tenant-scoped role checks
- [x] 2) No direct client writes on drafts/events/documents/audit; audited MEDICAL reads
- [x] 3) Clinical doc types forced MEDICAL; downgrade médecin-only; generic titles for employer (+ coordination tasks server-only, templated text immutable)
- [x] 4) Deadlines from case stoppages, contiguous episode only
- [x] 5) New deadline rules + 25 unit tests
- [x] 6) Summary from approved events, citation check
- [x] 7) No clear links in simulated messages
- [x] 8) Upload file signature check

- [x] Import pipeline, dashboard, cases
- [x] Roles & confidentiality, audit log
- [x] Documents: upload, AI OCR/classification, sourced chronology
- [x] AI summary + employer letter drafts with approval
- [x] Coordination agent (planning, send, escalate) — real SMS/email sending blocked on choosing a provider
- [x] Deadline rules engine
- [x] Prototype banner, simulated messages view, security warning fix
- [x] Employer portal (invite by email) + worker portal (magic link)
- [ ] a) Missing deadline rules (réserves, CPAM, inaptitude 1 mois, contestation 15 j) — waiting for user go
- [ ] b) "Ma journée" worklist + risk score
- [ ] c) Per-field AI extraction validation with evidence
- [ ] d) Return-to-work plan
- [ ] e) Visit booking + prepare visit + post-visit drafts (no dictation)
- [ ] f) Inaptitude wizard
- [ ] g) 12 fictional cases with watermarked docs
- [ ] h) Dashboards
