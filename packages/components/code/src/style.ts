import { Highlighter, Tag, tagHighlighter, tags as t } from "@lezer/highlight";

/** Lezer highlight {@link Tag}s mapped to a color; a canvas has no stylesheet, so the color is carried directly. */
export interface CodeStyleRule {
    tag: Tag | readonly Tag[];
    color: string;
}

/** Ordered tag rules plus a fallback color; later rules win when several match a tag, as in {@link tagHighlighter}. */
export interface CodeHighlightStyle {
    /** Registers the style and names it in a `theme` prop. */
    name: string;
    /** For text with no matching tag. */
    defaultColor: string;
    rules: CodeStyleRule[];
}

// The default palette is ported from `@motion-canvas/2d`; the GitHub and VS Code ones are adapted from
// `@uiw/codemirror-theme-github` and `-vscode`, with their DOM-only style props dropped.
export const DefaultHighlightStyle: CodeHighlightStyle = {
    name: "motion-canvas-default",
    defaultColor: "#d8dee9",
    rules: [
        { tag: t.keyword, color: "#5e81ac" },
        { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: "#88c0d0" },
        { tag: [t.variableName], color: "#8fbcbb" },
        { tag: [t.function(t.variableName)], color: "#8fbcbb" },
        { tag: [t.labelName], color: "#81a1c1" },
        { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: "#5e81ac" },
        { tag: [t.definition(t.name), t.separator], color: "#a3be8c" },
        { tag: [t.brace], color: "#8fbcbb" },
        { tag: [t.annotation], color: "#d30102" },
        { tag: [t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: "#b48ead" },
        { tag: [t.typeName, t.className], color: "#ECEFF4" },
        { tag: [t.operator, t.operatorKeyword], color: "#a3be8c" },
        { tag: [t.tagName], color: "#b48ead" },
        { tag: [t.squareBracket], color: "#ECEFF4" },
        { tag: [t.angleBracket], color: "#ECEFF4" },
        { tag: [t.attributeName], color: "#eceff4" },
        { tag: [t.regexp], color: "#5e81ac" },
        { tag: [t.quote], color: "#b48ead" },
        { tag: [t.string], color: "#a3be8c" },
        { tag: t.link, color: "#a3be8c" },
        { tag: [t.url, t.escape, t.special(t.string)], color: "#8fbcbb" },
        { tag: [t.meta], color: "#88c0d0" },
        { tag: [t.monospace], color: "#d8dee9" },
        { tag: [t.comment], color: "#4c566a" },
        { tag: t.strong, color: "#5e81ac" },
        { tag: t.emphasis, color: "#5e81ac" },
        { tag: t.heading, color: "#5e81ac" },
        { tag: t.special(t.heading1), color: "#5e81ac" },
        { tag: t.heading1, color: "#5e81ac" },
        { tag: [t.heading2, t.heading3, t.heading4], color: "#5e81ac" },
        { tag: [t.heading5, t.heading6], color: "#5e81ac" },
        { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#d08770" },
        { tag: [t.processingInstruction, t.inserted], color: "#8fbcbb" },
        { tag: [t.contentSeparator], color: "#ebcb8b" },
        { tag: t.invalid, color: "#434c5e" },
    ],
};

export const GithubDarkStyle: CodeHighlightStyle = {
    name: "github-dark",
    defaultColor: "#c9d1d9",
    rules: [
        { tag: [t.standard(t.tagName), t.tagName], color: "#7ee787" },
        { tag: [t.comment, t.bracket], color: "#8b949e" },
        { tag: [t.className, t.propertyName], color: "#d2a8ff" },
        { tag: [t.variableName, t.attributeName, t.number, t.operator], color: "#79c0ff" },
        { tag: [t.keyword, t.typeName, t.typeOperator], color: "#ff7b72" },
        { tag: [t.string, t.meta, t.regexp], color: "#a5d6ff" },
        { tag: [t.name, t.quote], color: "#7ee787" },
        { tag: [t.heading, t.strong], color: "#d2a8ff" },
        { tag: [t.emphasis], color: "#d2a8ff" },
        { tag: [t.deleted], color: "#ffdcd7" },
        { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#ffab70" },
        { tag: t.invalid, color: "#f97583" },
    ],
};

export const GithubLightStyle: CodeHighlightStyle = {
    name: "github-light",
    defaultColor: "#24292e",
    rules: [
        { tag: [t.standard(t.tagName), t.tagName], color: "#116329" },
        { tag: [t.comment, t.bracket], color: "#6a737d" },
        { tag: [t.className, t.propertyName], color: "#6f42c1" },
        { tag: [t.variableName, t.attributeName, t.number, t.operator], color: "#005cc5" },
        { tag: [t.keyword, t.typeName, t.typeOperator], color: "#d73a49" },
        { tag: [t.string, t.meta, t.regexp], color: "#032f62" },
        { tag: [t.name, t.quote], color: "#22863a" },
        { tag: [t.heading, t.strong], color: "#24292e" },
        { tag: [t.emphasis], color: "#24292e" },
        { tag: [t.deleted], color: "#b31d28" },
        { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#e36209" },
        { tag: [t.url, t.escape, t.regexp, t.link], color: "#032f62" },
        { tag: t.invalid, color: "#cb2431" },
    ],
};

export const VscodeDarkStyle: CodeHighlightStyle = {
    name: "vscode-dark",
    defaultColor: "#9cdcfe",
    rules: [
        {
            tag: [
                t.keyword, t.operatorKeyword, t.modifier, t.color,
                t.constant(t.name), t.standard(t.name), t.standard(t.tagName),
                t.special(t.brace), t.atom, t.bool, t.special(t.variableName),
            ],
            color: "#569cd6",
        },
        { tag: [t.controlKeyword, t.moduleKeyword], color: "#c586c0" },
        {
            tag: [
                t.name, t.deleted, t.character, t.macroName, t.propertyName,
                t.variableName, t.labelName, t.definition(t.name),
            ],
            color: "#9cdcfe",
        },
        { tag: t.heading, color: "#9cdcfe" },
        { tag: [t.typeName, t.className, t.tagName, t.changed, t.annotation, t.self, t.namespace], color: "#4ec9b0" },
        { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#dcdcaa" },
        { tag: [t.number], color: "#b5cea8" },
        { tag: [t.operator, t.punctuation, t.separator, t.url, t.escape], color: "#d4d4d4" },
        { tag: [t.regexp], color: "#d16969" },
        { tag: [t.special(t.string), t.processingInstruction, t.string, t.inserted], color: "#ce9178" },
        { tag: [t.angleBracket], color: "#808080" },
        { tag: [t.meta, t.comment], color: "#6a9955" },
        { tag: t.link, color: "#6a9955" },
        { tag: t.invalid, color: "#ff0000" },
    ],
};

export const VscodeLightStyle: CodeHighlightStyle = {
    name: "vscode-light",
    defaultColor: "#383a42",
    rules: [
        {
            tag: [
                t.keyword, t.operatorKeyword, t.modifier, t.color,
                t.constant(t.name), t.standard(t.name), t.standard(t.tagName),
                t.special(t.brace), t.atom, t.bool, t.special(t.variableName),
            ],
            color: "#0000ff",
        },
        { tag: [t.moduleKeyword, t.controlKeyword], color: "#af00db" },
        {
            tag: [
                t.name, t.deleted, t.character, t.macroName, t.propertyName,
                t.variableName, t.labelName, t.definition(t.name),
            ],
            color: "#0070c1",
        },
        { tag: t.heading, color: "#0070c1" },
        { tag: [t.typeName, t.className, t.tagName, t.changed, t.annotation, t.self, t.namespace], color: "#267f99" },
        { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#795e26" },
        { tag: [t.number], color: "#098658" },
        { tag: [t.operator, t.punctuation, t.separator, t.url, t.escape], color: "#383a42" },
        { tag: [t.regexp], color: "#af00db" },
        { tag: [t.special(t.string), t.processingInstruction, t.string, t.inserted], color: "#a31515" },
        { tag: [t.angleBracket], color: "#383a42" },
        { tag: [t.meta, t.comment], color: "#008000" },
        { tag: t.link, color: "#4078f2" },
        { tag: t.invalid, color: "#e45649" },
    ],
};

export const BUILTIN_THEMES = {
    // Literal keys (not computed from `.name`) so `keyof` yields a string-literal
    // union for CodeThemeName; these must stay in sync with each style's `name`.
    "motion-canvas-default": DefaultHighlightStyle,
    "github-dark": GithubDarkStyle,
    "github-light": GithubLightStyle,
    "vscode-dark": VscodeDarkStyle,
    "vscode-light": VscodeLightStyle,
} satisfies Record<string, CodeHighlightStyle>;

/** Names of the built-in themes, e.g. `'github-dark' | 'github-light'`. */
export type CodeThemeName = keyof typeof BUILTIN_THEMES;

/** A built-in name, any registered name, or a style inline; `string & {}` keeps the autocomplete for the built-in names. */
export type CodeTheme = CodeThemeName | (string & {}) | CodeHighlightStyle;

// One compiled Highlighter per style *object*, keyed by the object rather than its `name`: two styles may share a name (an
// inline theme, or one re-registered under the same name with new colours), and
// the second must not colour with the first one's rules. A WeakMap, so a style
// nothing refers to any more takes its matcher with it.
const compiledByStyle = new WeakMap<CodeHighlightStyle, Highlighter>();

/** A {@link Highlighter} whose "class" output is the color string for each tag. */
export function compileStyle(style: CodeHighlightStyle): Highlighter {
    const cached = compiledByStyle.get(style);
    if (cached) return cached;
    const highlighter = tagHighlighter(
        style.rules.map(rule => ({ tag: rule.tag, class: rule.color })),
    );
    compiledByStyle.set(style, highlighter);
    return highlighter;
}
