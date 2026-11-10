# @motionscript/code

Animated, syntax-highlighted code listings for [Motion Script](https://motionscript.dev).
The `Code` node highlights source with [Lezer](https://lezer.codemirror.net)
grammars and animates edits at the token level: each edit is diffed against the
listing it becomes, so tokens that survive travel to their new columns, removed
ones fade out and new ones fade in, rather than the listing snapping.

Hand `Code` to the engine through your project entry's `nodes`, and any
document that engine opens can name it as `code`:

```ts
// src/project.ts
import { Code } from '@motionscript/code';

export const nodes = [Code];
```

```ts
import type { CompositionDocument } from '@motionscript/sdk';
import { lines } from '@motionscript/code';

export default {
  kind: 'composition',
  nodes: [
    { id: 'listing', type: 'code', parentId: null, layerOrder: 0,
      props: { code: 'function greet(name) {\n  return "hi";\n}', language: 'typescript',
               theme: 'github-dark', fontSize: 28 } },
  ],
  commands: [
    { id: 'call', type: 'append', targetId: 'listing', at: 0, duration: 0.6,
      args: { code: '\ngreet("world");' } },
    { id: 'focus', type: 'highlight', targetId: 'listing', at: 0.8, duration: 0.4,
      args: { target: lines(2) } },
  ],
} satisfies CompositionDocument;
```

## What's in here

- **`Code`**, a hugging block of highlighted source, written with
  `component2d`: call it (`Code({ ... })`) or construct it (`new Code({ ... })`).
  Set `code`, `language` and `theme` to choose what is shown; tune `fontSize`,
  `fontFamily`, `lineHeight`, `letterSpacing`, `showLineNumbers`,
  `lineNumberGap` and `padding` for layout.
- **Token-level commands**: `append`/`prepend` (lines at the end or start),
  `insert` (at a `[line, col]` position), `remove`, `replace`,
  `highlight`/`resetHighlight` (dim everything outside a range, then restore
  it), and `highlightRows`/`resetRowHighlight` (a coloured band behind whole
  lines, which slides onto the next rows it is given and follows its lines
  through an edit). A `to` command on `code` diffs the whole listing the same way;
  while it runs, `code` holds a `CodeBlend` (`{ from, to, t }`) rather than a
  string, and a source again at either end.
- **Range helpers**: `word(line, col, length)`, `lines(from, to)` and the
  chainable `CodeRanges` build the ranges those commands take.
- **Themes**: `github-dark`, `github-light`, `vscode-dark`, `vscode-light`
  and a default, plus `registerCodeTheme` for your own.
  `initSyntaxHighlighter(themes, langs)` preloads grammars so the first frame
  renders fully highlighted.

Every token keeps a stable identity across edits, so concurrent animations at
different positions do not clobber each other while one is mid-flight.

This package is written against [`@motionscript/sdk`](https://github.com/motionscript-dev/motionscript/tree/main/packages/sdk), which it
takes as a peer dependency, and renders through whatever backend draws the
scene, such as [`@motionscript/browser`](https://github.com/motionscript-dev/motionscript/tree/main/packages/browser).

## Languages, themes and line endings

- **Languages**: `typescript` (`ts`), `tsx`, `javascript` (`js`), `jsx`, `python`
  (`py`), `json`, `html`, `css`, `rust`, `go`, `java`, `cpp` (`c++`), `php`,
  `markdown` (`md`), `xml` and `yaml` (`yml`). `shell` is an alias of
  `javascript`, because no shell grammar is bundled. Names are case-insensitive.
- **An unknown language, a grammar whose import is rejected and an unknown theme
  name** each fall back (plain text, plain text and the default theme) and log one
  `[Code]` warning per name for the life of the process. `''`, `text` and
  `plaintext` mean plain text on purpose and say nothing.
- **`language` and `theme` can be tweened or bound.** The listing is re-coloured
  from the props on the next frame, keeping the token identities a highlight
  already names.
- **`\r\n` and a lone `\r` are line breaks**, in `code` and in the text a command
  brings in; the node's `code` reads back with `\n` after its first command.
- **Edits are diffed within a budget.** Lines are paired by the same text at the
  ends of the listing and by lines that occur once on both sides, so an edit
  to a long listing costs in proportion to what changed. Only a run of changed
  lines between two such anchors is compared pairwise, up to
  `LINE_ALIGN_CELLS` (40,000) line pairs per run and 160,000 per edit; beyond
  that its lines leave and enter as whole rows instead of morphing into each
  other.
- **A command on a node that is not in a tree** runs its duration and writes
  nothing. A document cannot reach this, because the validator rejects a command
  that starts before its target is present.

## Ranges, queries and what a copy holds

- **Ranges are 1-indexed** in lines and columns. `endLine`/`endCol` may be
  `Infinity` (to the end of the line or document); a range that went through
  JSON holds `null` there and reads the same. Positions clamp, so no command
  throws for a bad range, and a `CodeRanges` chain serialises as its array of
  ranges.
- **`findAllRanges(source, text)`, `findRangeAt(source, text, index)` and
  `findFirstRange(source, text)`** return the literal matches in a source as
  ranges: pass a listing's `code`. `listingOf(node)` is what a listing shows now:
  its source, its token rows and the edit in flight.
- **`remove` is the command's key, and a node has no method of that name for it**:
  `Node.remove` already takes a child out of the tree, so the command is
  dispatched by key (a document, a host's registry) and reaches the node's
  `_command_remove`.
- **A `Code` takes no children and has no `fill`, `stroke` or `shadow`**; a panel
  behind it is a parent `Rect`. It also refuses the ambient text style
  (`<DefaultTextStyle>`): its columns are measured against its own face, so an
  inherited family or weight would shape glyphs the geometry never measured.
- **`diffStrategy` and `phaseStrategy`** (`CodeStrategies`) replace how an edit is
  paired and how its out/move/in windows are timed. They are arguments of
  `defineCode({ diffStrategy, phaseStrategy })`, which returns a `code` component
  using them: hand that to the engine in place of `Code`. A strategy is a
  function, which a prop would read as a binding, so a document cannot set one.
- **Each listing command writes the listing it acted on**, so the token ids a
  highlight or a band captured are the ones drawn. Two commands of one kind
  that overlap (two edits, two highlights) hand over from the later one's first
  frame: the later command's state replaces the earlier's while both run.
- **A `Code` is drawn from what its last measure laid out**, which its parent
  asks for before every frame; one that was never measured draws nothing.
- **Highlighter state is per process.** Loaded grammars, registered themes and
  token ids are shared by every `Code` in it.
- **A copy of `code` takes only `node.ts`** (`registry.json`). The highlighter,
  diff, layout and drawing stay in this package behind `src/engine.ts`, which the
  copy imports from `@motionscript/code`; the grammars are dynamic imports, so a
  host's bundler must resolve `@lezer/*` from where the package is installed.

## The monospaced face is yours to supply

`Code` measures and draws every token in its `fontFamily`, `Fira Mono` by
default, and lines its columns up on that face's advances. The package ships no
font file and names no URL: list a monospaced face under that family in the
engine's asset manifest, alongside the node itself.

```ts
const engine = await createBrowserEngine({
  wasmUrl,
  nodes: [Code],
  manifest: {
    image: {}, video: {}, audio: {},
    font: {
      'Fira Mono@400': {
        fontFamily: 'Fira Mono', fontWeight: 400,
        src: '/fonts/FiraMono-Regular.ttf', sizeBytes: 0,
      },
    },
  },
});
```

A family the manifest does not list is never loaded. The loader warns once, and
the listing draws no text, or shapes in whichever other face is registered. To
use another face, set `fontFamily` on the node and list that family instead.

## Usage

```bash
npm install @motionscript/code @motionscript/sdk
```

See the
[docs](https://motionscript.dev/docs) for the full feature set and API
reference.

## Development

From the monorepo root:

```bash
pnpm --filter @motionscript/code build
pnpm --filter @motionscript/code test
```
