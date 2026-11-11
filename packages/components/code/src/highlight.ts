import { Parser, Tree } from "@lezer/common";
import { highlightTree } from "@lezer/highlight";
import {
    BUILTIN_THEMES,
    CodeHighlightStyle,
    CodeTheme,
    DefaultHighlightStyle,
    compileStyle,
} from "./style";

// Dynamic imports keep the bundle from pulling in every grammar.
const LANGUAGE_LOADERS: Record<string, () => Promise<Parser>> = {
    typescript: async () => (await import("@lezer/javascript")).parser.configure({ dialect: "ts" }),
    tsx: async () => (await import("@lezer/javascript")).parser.configure({ dialect: "ts jsx" }),
    javascript: async () => (await import("@lezer/javascript")).parser,
    jsx: async () => (await import("@lezer/javascript")).parser.configure({ dialect: "jsx" }),
    python: async () => (await import("@lezer/python")).parser,
    json: async () => (await import("@lezer/json")).parser,
    html: async () => (await import("@lezer/html")).parser,
    css: async () => (await import("@lezer/css")).parser,
    rust: async () => (await import("@lezer/rust")).parser,
    go: async () => (await import("@lezer/go")).parser,
    java: async () => (await import("@lezer/java")).parser,
    cpp: async () => (await import("@lezer/cpp")).parser,
    php: async () => (await import("@lezer/php")).parser,
    markdown: async () => (await import("@lezer/markdown")).parser,
    xml: async () => (await import("@lezer/xml")).parser,
    yaml: async () => (await import("@lezer/yaml")).parser,
};

const LANGUAGE_ALIASES: Record<string, string> = {
    ts: "typescript",
    js: "javascript",
    py: "python",
    "c++": "cpp",
    md: "markdown",
    yml: "yaml",
    shell: "javascript", // no shell grammar bundled; fall back rather than throw
};

/** Names that mean "no grammar, on purpose": drawn as plain text without a warning. */
const PLAIN_LANGUAGES = new Set(["", "text", "plaintext"]);

const warned = new Set<string>();

/** One `console.warn` per `kind:name` for the life of the process, so a listing redrawn every frame says it once. */
function warnOnce(kind: string, name: string, message: string): void {
    const key = `${kind}:${name}`;
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(`[Code] ${message}`);
}

/**
 * The source as the highlighter and the commands see it: lines joined by `\n`.
 * A `\r\n` (or a lone `\r`) from a file or a clipboard would otherwise survive
 * as a character at the end of a line, measured and drawn as a token.
 */
export function normalizeSource(code: string): string {
    return code.indexOf("\r") === -1 ? code : code.replace(/\r\n?/g, "\n");
}

function resolveLanguageKey(language: string): string {
    const key = language.toLowerCase();
    return LANGUAGE_ALIASES[key] ?? key;
}

// Keyed by resolved language, so concurrent nodes share one import.
const loadedParsers = new Map<string, Parser>();
const inFlightLangs = new Map<string, Promise<Parser | null>>();

export const DEFAULT_LANGS = ["typescript", "javascript", "json", "python"];

const themesByName = new Map<string, CodeHighlightStyle>(Object.entries(BUILTIN_THEMES));

/** Register a custom {@link CodeHighlightStyle} so Code nodes can reference it by name. */
export function registerCodeTheme(style: CodeHighlightStyle): void {
    themesByName.set(style.name, style);
}

/** An unknown theme name falls back to the default style with one warning, never a throw. */
export function resolveTheme(theme: CodeTheme): CodeHighlightStyle {
    if (typeof theme !== "string") return theme;
    const style = themesByName.get(theme);
    if (style) return style;
    warnOnce(
        "theme",
        theme,
        `unknown theme "${theme}"; using "${DefaultHighlightStyle.name}". Built-in themes: ${Object.keys(BUILTIN_THEMES).join(", ")}; register others with registerCodeTheme.`,
    );
    return DefaultHighlightStyle;
}

/**
 * Resolves once every requested language's parser is loaded. An unknown language
 * resolves without loading (`canHighlight` stays false and it draws as plain
 * text); a grammar whose import rejects is reported the same way and retried by
 * the next call. Each warns once.
 */
export function ensureHighlighter(langs: string[] = DEFAULT_LANGS): Promise<void> {
    const jobs: Promise<unknown>[] = [];

    for (const lang of langs) {
        const key = resolveLanguageKey(lang);
        if (loadedParsers.has(key)) continue;

        const loader = LANGUAGE_LOADERS[key];
        if (!loader) {
            if (!PLAIN_LANGUAGES.has(key)) {
                warnOnce(
                    "language",
                    key,
                    `no grammar for language "${lang}"; drawing it as plain text. Supported: ${Object.keys(LANGUAGE_LOADERS).join(", ")} (aliases: ${Object.keys(LANGUAGE_ALIASES).join(", ")}).`,
                );
            }
            continue;
        }

        let job = inFlightLangs.get(key);
        if (!job) {
            job = loader()
                .then(parser => {
                    loadedParsers.set(key, parser);
                    return parser;
                })
                .catch((error: unknown) => {
                    warnOnce(
                        "load",
                        key,
                        `could not load the "${lang}" grammar; drawing it as plain text: ${error instanceof Error ? error.message : String(error)}`,
                    );
                    return null;
                })
                .finally(() => inFlightLangs.delete(key));
            inFlightLangs.set(key, job);
        }
        jobs.push(job);
    }

    return jobs.length === 0 ? Promise.resolve() : Promise.all(jobs).then(() => undefined);
}

/** Loads one language; resolves at once for an unsupported one. */
export async function loadCodeLanguage(language: string): Promise<void> {
    await ensureHighlighter([language]);
}

export async function initSyntaxHighlighter(langs: string[] = DEFAULT_LANGS): Promise<void> {
    await ensureHighlighter(langs);
}

/** True once `language`'s parser has loaded. */
export function canHighlight(language: string): boolean {
    return loadedParsers.has(resolveLanguageKey(language));
}

interface HighlightCache {
    tree: Tree;
    colorLookup: Map<string, string>;
}

function nodeId(from: number, to: number): string {
    return `${from}:${to}`;
}

/** Maps every node inside a highlighted range to its color by `from:to` id, for {@link highlightAt}. */
function prepareHighlight(code: string, language: string, style: CodeHighlightStyle): HighlightCache | null {
    const parser = loadedParsers.get(resolveLanguageKey(language));
    if (!parser) return null;

    const tree = parser.parse(code);
    const highlighter = compileStyle(style);
    const colorLookup = new Map<string, string>();

    highlightTree(tree, highlighter, (from, to, classes) => {
        const color = classes; // the tag highlighter emits the color as the "class"
        if (!color) return;
        const cursor = tree.cursorAt(from, 1);
        do {
            colorLookup.set(nodeId(cursor.from, cursor.to), color);
        } while (cursor.next() && cursor.to <= to);
    });

    return { tree, colorLookup };
}

/** The color and run length (`skipAhead`) of the innermost node at `index`. */
function highlightAt(index: number, cache: HighlightCache): { color: string | null; skipAhead: number } {
    const node = cache.tree.resolveInner(index, 1);
    const color = cache.colorLookup.get(nodeId(node.from, node.to));
    if (color) {
        return { color, skipAhead: node.to - index };
    }
    // Uncolored: skip a whole leaf rather than re-resolving every character.
    const skipAhead = node.firstChild ? 0 : node.to - index;
    return { color: null, skipAhead };
}

/** Splits at parse-tree leaf boundaries, gaps between leaves included; the edit animations diff against this segmentation. */
function tokenizeCode(code: string, language: string): string[] {
    const parser = loadedParsers.get(resolveLanguageKey(language));
    if (!parser) return [code];

    const tree = parser.parse(code);
    const cursor = tree.cursor();
    const tokens: string[] = [];
    let current = 0;

    do {
        if (!cursor.node.firstChild) {
            if (cursor.from > current) tokens.push(code.slice(current, cursor.from));
            if (cursor.from < cursor.to) tokens.push(code.slice(cursor.from, cursor.to));
            current = cursor.to;
        }
    } while (cursor.next());

    if (current < code.length) tokens.push(code.slice(current));
    return tokens;
}

/**
 * Per-line rows of single-line, single-color tokens. Without a loaded parser it
 * returns one uncolored token per source line, so callers check {@link canHighlight}.
 */
export function highlightToTokens(
    code: string,
    language: string,
    theme: CodeTheme = DefaultHighlightStyle,
): { content: string; color?: string }[][] {
    code = normalizeSource(code);
    const style = resolveTheme(theme);
    const cache = prepareHighlight(code, language, style);

    const lines: { content: string; color?: string }[][] = [[]];
    const pushLine = () => lines.push([]);

    if (!cache) {
        return code.split("\n").map(line => [{ content: line, color: style.defaultColor }]);
    }

    let index = 0;
    for (const token of tokenizeCode(code, language)) {
        let offset = 0;
        while (offset < token.length) {
            const { color, skipAhead } = highlightAt(index + offset, cache);
            // A run never passes its structural token or a newline.
            let runEnd = offset + Math.max(skipAhead, 1);
            if (runEnd > token.length) runEnd = token.length;
            const newlineRel = token.indexOf("\n", offset);
            if (newlineRel !== -1 && newlineRel < runEnd) runEnd = newlineRel;

            const slice = token.slice(offset, runEnd);
            if (slice.length > 0) {
                lines[lines.length - 1].push({ content: slice, color: color ?? style.defaultColor });
            }

            if (newlineRel === runEnd) {
                pushLine();
                runEnd += 1; // consume the newline itself
            }
            offset = runEnd;
        }
        index += token.length;
    }

    return lines;
}
