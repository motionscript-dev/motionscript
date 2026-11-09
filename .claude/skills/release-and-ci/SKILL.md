---
name: release-and-ci
description: Cut a release with Changesets, read what CI and the publish workflow check, and publish by hand. Use when asked to release, version, publish or fix a failing release or CI job.
---

Follow `scripts/runbooks/release-and-ci.md`. A breaking changeset needs the `**Breaking:**` marker and a `Migration:` paragraph (`node scripts/check-changesets.mjs`).
