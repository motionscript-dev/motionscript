import { LatexMatrix } from './matrix';
import { Latex } from './node';

export * from './node';
export * from './matrix';
export {
    blankLatex, buildLatexPath, findLatexParts, latexPartNames, LatexError, LatexNotLoaded, loadMathJax, mathJaxLoaded, MATHJAX_LOADER,
} from './geometry';
export type { LatexPart, LatexToken, LatexPathResult } from './geometry';
export { defaultLatexMorph } from './tween';
export type { AnimatedToken, LatexMorphStrategy } from './tween';

/** The typeset-math node types, for a host that registers only these. */
// Typed by name, so the declaration names each component rather than spelling out its type through core.
export const TEX_NODES: (typeof Latex | typeof LatexMatrix)[] = [Latex, LatexMatrix];
