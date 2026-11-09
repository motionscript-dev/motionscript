---
"@motionscript/geography": patch
---

`@motionscript/geography` packs from a fresh checkout. `data/` is generated rather than committed, and `prepack` only verified it, so a publish from a clean tree, as the release workflow's is, failed. `prepack` now generates `data/` when it is missing, from the Natural Earth sources `sources.lock.json` pins by tag and sha256, and verifies it either way. A downloaded source is cached only once its checksum matches.
