---
change_id: owned-persistence-baseline
title: Connect the hosted database and establish the row-ownership policy shape
status: archived
created: 2026-08-09
updated: 2026-08-10
archived_at: 2026-08-10T09:15:24Z
---

## Notes

Roadmap F-03. Connect the provisioned Supabase project to development, the pipeline and the
deployed instance, and establish the row-ownership policy shape that every later table must follow
— demonstrated on the account's own profile row, including a check that asserts against stored
rows rather than the status code a caller sees. RLS is written in the same migration that creates
the table; a table that lands without one is a defect, not a follow-up.
