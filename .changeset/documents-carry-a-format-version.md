---
"@motionscript/core": minor
"@motionscript/sdk": minor
---

Documents carry the format they were written in, and the engine brings an older one forward when it opens it.

- A still, composition, audio clip or project may say `formatVersion`; absent is format 0, which is every document written so far. `DOCUMENT_FORMAT_VERSION` is 1. Write it when you save a document.
- `migrateDocument(doc)` returns `{ document, from, to, changes }`: the input itself when it is current, otherwise a new document stamped with the current format and a list of what each step changed. It never mutates its input. Opening a document (`Engine.open`, `Session.replace`, every export and still) migrates before it validates. Format 0 → 1 moves a clip's retired `constants` rows into `variables`, so such a document now opens.
- A document whose format is newer than the engine throws `DocumentTooNewError` (`version`, `supported`) when opened, and `validateDocument` reports it.
- `validateDocument` and `validateProjectDocument` take `{ registry }` to also report node types and commands the registry cannot build. A project's retired `visualTracks`, `audioTracks`, `backgrounds`, `overlays`, `commands` and `constants` are reported by name, and an `fps` of `Infinity` is refused.
- A component spec takes `renamed` (old prop key → entry), `deprecated` (entry → message) and `migrate` (key → value hook), applied wherever a row's props, or a `to`/`set` command's, become a node. `migrateNodeProps(registry, type, props)` applies them to a stored row for a host and reports `changes` and `deprecated`; a type's descriptor shows `renamed` and each property's `deprecated`.
