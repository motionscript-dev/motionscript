export * from "./types";
export * from "./project";
export * from "./expression";
export * from "./validate";
export {
    DOCUMENT_FORMAT_VERSION,
    DOCUMENT_MIGRATIONS,
    DocumentTooNewError,
    documentFormatVersion,
    migrateDocument,
} from "./migrate";
export type { DocumentChange, DocumentMigration, DocumentMigrationResult, JsonDocument, NoteChange } from "./migrate";
export { migrateNodeProps } from "./prop-evolution";
export type { PropEvolution, PropMigration, PropNote } from "./prop-evolution";
export { missingNodeOf } from "./missing-node";
export { registryVocabulary, vocabularyBreaks } from "./vocabulary";
export type { RegistryVocabulary, VocabularyBreak } from "./vocabulary";
export type { MissingNodeInfo } from "./missing-node";
export * from "./registry";
export * from "./node-descriptor";
export { NODE_META, getNodeDescriptor } from "./node-decorator";
export * from "./placement";
export * from "./timeline";
export * from "./audio";
// `installBuiltins` is deliberately NOT exported: a `Registry` seeds itself from
// its own constructor, so a host has no module-scope call for a bundler to
// tree-shake away.
