// Everything node.ts imports besides its own declaration, so a copy of the node can take
// just node.ts and import this from `@motionscript/code`. registry.test.ts checks that
// whatever node.ts reaches for is copied alongside it or re-exported from here.
export * from './transitions';
export * from './layout';
export { drawCode } from './render';
export type { CodeCanvas, DrawCodeState } from './render';
export { diffCode as defaultCodeDiff } from './diff';
export type { CodeDiffStrategy, CodeEdit } from './diff';
export { loadCodeLanguage, initSyntaxHighlighter, ensureHighlighter, registerCodeTheme, resolveTheme, canHighlight, normalizeSource } from './highlight';
export { tokenizeCodeToIdLines } from './tokens';
export type { IdLine, IdToken } from './tokens';
export { DefaultHighlightStyle, GithubDarkStyle, GithubLightStyle, VscodeDarkStyle, VscodeLightStyle, BUILTIN_THEMES, compileStyle } from './style';
export type { CodeHighlightStyle, CodeStyleRule, CodeTheme, CodeThemeName } from './style';
export { TokenAdvanceCache } from './measure-cache';
export { word, lines, rangeToCharOffsets, charOffsetsToRange, CodeRanges, CodeRangeChain } from './code-range';
export type { CodeRange } from './code-range';
