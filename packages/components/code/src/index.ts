// The public surface, named one by one; everything else is `./kit` (`unstable.ts`).
export { Code, defineCode } from './node';
export type { CodeStrategies } from './node';
export { lines, word, CodeRanges } from './code-range';
export type { CodeRange } from './code-range';
export { registerCodeTheme, initSyntaxHighlighter } from './highlight';
export type { CodeHighlightStyle, CodeTheme, CodeThemeName } from './style';
export { NODES } from "./nodes";
