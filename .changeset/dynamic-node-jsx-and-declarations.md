---
"@motionscript/browser": patch
"@motionscript/core": patch
---

A node compiled from source can use JSX and name its own variables freely.

- The default compiler for a source-string node emitted classic `React.createElement` calls, so a script with JSX registered and then threw `React is not defined` the first time its constructor ran. It now compiles JSX with the automatic runtime and `@motionscript/sdk` as the import source, which links to `DynamicNodeConfig.jsxRuntime`. A script needs no pragma, and a `@jsxRuntime` or `@jsxImportSource` pragma in it still takes precedence.
- A top-level `const`, `let` or `class` named like one of the globals a script is denied (`const frames = 30`, `let history = []`, `class Request {}`) failed with `SyntaxError: Identifier '…' has already been declared`. The script now runs in a scope of its own inside the one that denies those names, so its declaration shadows the denied global. Names it does not declare still read as `undefined`.
