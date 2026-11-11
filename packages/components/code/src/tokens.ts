import { canHighlight, highlightToTokens, normalizeSource, resolveTheme } from "./highlight";
import { CodeTheme } from "./style";

/** A highlighter token with a stable identity: animation state is keyed by `id`, so concurrent edits at different positions don't clobber each other. */
export interface IdToken {
    id: number;
    content: string;
    color?: string;
}

export interface IdLine {
    id: number;
    tokens: IdToken[];
}

let nextTokenId = 1;
let nextLineId = 1;

export function makeIdToken(content: string, color?: string): IdToken {
    return { id: nextTokenId++, content, color };
}

export function makeIdLine(tokens: IdToken[]): IdLine {
    return { id: nextLineId++, tokens };
}

export function tokenizeCodeToIdLines(code: string, language: string, theme: CodeTheme): IdLine[] {
    code = normalizeSource(code);
    if (!canHighlight(language)) {
        // Flat lines until the grammar loads; the node re-tokenizes then.
        resolveTheme(theme); // so an unknown theme still warns before the grammar lands
        return code.split('\n').map(line => makeIdLine([makeIdToken(line, '#d1d5db')]));
    }
    return highlightToTokens(code, language, theme).map(line =>
        makeIdLine(line.map(tok => makeIdToken(tok.content, tok.color))),
    );
}
