# @motionscript/docs

The documentation pages behind [motionscript.dev/docs](https://motionscript.dev/docs): one MDX file per page under
`content/`, folders as sidebar sections (`_category_.json` sets a section's label and position, a page's
`sidebar_position` front matter its order). The package is published with every engine release, at the engine's
version, and the docs site renders the version it pins, so a page always describes the engine it ships with.

## Editing a page

Every page on the site has **Edit this page**, which opens its file here on GitHub; propose the change as a pull
request against `alpha`, like any other change (`CONTRIBUTING.md`). **Report a problem** opens an issue with the
page filled in. A change reaches the site with the next release.

## What a page can use

Pages are MDX. Besides Markdown they can use the site's own components, by name:

- Layout: `<Tabs>`/`<TabItem>`, `<DocsGrid>`/`<DocsCard>`, `<Admonition>`.
- Live previews: `<ComponentClip>` and the `<…Canvas>` scenes (`<RectCanvas>`, `<TextCanvas>`, …).
- Code blocks, rendered with syntax highlighting.

The names are a contract with the site: a page that uses one the site doesn't register fails the site's build.

GitHub shows a page as plain Markdown, with those component tags as written.

Examples import the versioned paths a custom component uses (`@motionscript/sdk/v1`, `@motionscript/<kit>/v1`).
The API reference is not here: the site generates it from the published packages' types.
