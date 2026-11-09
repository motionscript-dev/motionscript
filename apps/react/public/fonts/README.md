# Fonts

Drop a TrueType file named `Inter.ttf` here to enable the **Text** demo.

There is no fallback face anywhere in the stack: a `Text` node names a family,
and the browser backend shapes with the typefaces the asset manifest gave it —
system fonts are not reachable from the renderer. So a missing file means glyphs
that never paint, which is why the app probes for this one and disables that
scene instead.

Any family works; if you use a different one, change `FONT_FAMILY` in
`src/scenes/documents.ts` and name the file to match.
