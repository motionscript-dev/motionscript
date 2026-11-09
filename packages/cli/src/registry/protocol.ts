
/**
 * The registry protocol: how a component's source travels from wherever it is
 * published to whoever installs it.
 *
 * Modelled on shadcn/ui's, because it is the one people already know and
 * because it is deliberately dull — two static JSON endpoints, servable by
 * anything that serves a file:
 *
 * ```
 * GET <registry>/registry.json   → the index: [{ name, type, description }]
 * GET <registry>/<name>.json     → one item: its files, deps and manifest
 * ```
 *
 * Kept separate from `fetch.ts`'s `fs`/`fetch` transport because this half is
 * pure — resolving a name to a URL involves no I/O — which is what makes it
 * unit-testable with no network, and what would let a future non-CLI client
 * (an in-browser editor) reuse the exact same resolution rules without
 * depending on the whole CLI.
 */

export type RegistryItemType = "registry:component" | "registry:kit"

/** One row of a registry's index. */
export interface RegistryIndexEntry {
  name: string
  type: RegistryItemType
  description?: string
  /** The version this item was cut from. */
  version?: string
  /** Whether its source may be copied at all. */
  forkable?: boolean
}

/** One file of an item, with its content inlined. */
export interface RegistryFile {
  /** Path relative to the components root, e.g. `"line-chart/chart-line.ts"`. */
  path: string
  content: string
}

/** A single installable component. */
export interface RegistryItem {
  name: string
  type: RegistryItemType
  description?: string
  /** The version this was cut from, so a lock can record what it installed. */
  version?: string
  /** npm dependencies, as `"pkg@range"`. */
  dependencies?: string[]
  /** Other item names, installed first. */
  registryDependencies?: string[]
  files: RegistryFile[]
  /**
   * The kit these files import and must **not** copy, as `"pkg@range"`.
   *
   * Always also present in {@link dependencies}; named separately because a
   * host that copies source has to know which bare specifier must resolve to
   * its own single copy rather than to a second one it installed alongside.
   */
  kit?: string
  forkable?: boolean
  /** sha256 over the canonicalised file list, so a copy can be verified. */
  integrity?: string
  /**
   * Whether a host with no package manager can install this: true only when
   * every entry of {@link dependencies} is something it already bundles.
   *
   * An editor installs *source*, never npm. Declaring this lets it say "needs
   * `@acme/foo`, which cannot be installed here" while the item is still a card
   * in a list, rather than failing when the code is linked.
   */
  standalone?: boolean
}

/** A configured registry: a URL template, plus whatever it needs to be read. */
export interface RegistryConfig {
  /** Contains a literal `{name}` placeholder. */
  url: string
  headers?: Record<string, string>
  params?: Record<string, string>
}

/** The `motionscript.json` a project keeps at its root. */
export interface ComponentsConfig {
  $schema?: string
  project: string
  aliases: { components: string }
  paths: { components: string }
  /**
   * Additional registries, keyed by `"@namespace"`.
   *
   * The default registry is never configured here — it is the client's own
   * constant — matching shadcn's `components.json`, whose `registries` keys are
   * schema-constrained to `^@`.
   */
  registries?: Record<string, string | RegistryConfig>
}

/** Where a name resolved to, and what is needed to read it. */
export interface ResolvedRegistryTarget {
  url: string
  headers?: Record<string, string>
  /** The bare item name, with any namespace stripped. */
  itemName: string
}

/** Splits `"@acme/gauge"` into its namespace and name; a bare name gives null. */
export function splitNamespacedName(
  name: string
): { namespace: string; itemName: string } | null {
  const match = /^(@[^/]+)\/(.+)$/.exec(name)
  return match ? { namespace: match[1], itemName: match[2] } : null
}

/**
 * Expands `${VAR}` against a lookup, so a token never has to be written into a
 * config file that gets committed.
 *
 * The lookup is passed in rather than read from `process.env`, because one of
 * the two clients has no `process`.
 */
export function interpolate(
  value: string,
  lookup: (name: string) => string | undefined
): string {
  return value.replace(
    /\$\{([A-Za-z0-9_]+)\}/g,
    (whole, name: string) => lookup(name) ?? whole
  )
}

/**
 * Joins a file onto a registry base.
 *
 * One rule for both a URL and a filesystem path, because this module has no
 * `path` to call and a local registry is how one is tested before it is
 * deployed anywhere. A Windows path keeps its backslashes, so the path a lock
 * records and a message prints is not half one separator and half the other.
 */
export function joinRegistryPath(base: string, file: string): string {
  const windowsPath = !/^[a-z][a-z0-9+.-]*:\/\//i.test(base) && base.includes("\\")
  const separator = windowsPath ? "\\" : "/"
  return `${base.replace(/[\\/]$/, "")}${separator}${file}`
}

/**
 * Resolves a possibly-namespaced component name to the URL its item is at.
 *
 * Pure, and exported rather than folded into a fetcher, so that URL templating
 * and `${VAR}` expansion are testable without a network — and so the CLI and an
 * editor cannot resolve the same name differently.
 */
export function resolveItemUrl(
  name: string,
  config: ComponentsConfig | null,
  defaultRegistryUrl: string,
  env: (key: string) => string | undefined = () => undefined
): ResolvedRegistryTarget {
  const namespaced = splitNamespacedName(name)
  if (!namespaced) {
    return {
      url: joinRegistryPath(defaultRegistryUrl, `${name}.json`),
      itemName: name,
    }
  }

  const entry = config?.registries?.[namespaced.namespace]
  if (!entry) {
    throw new Error(
      `Unknown registry namespace "${namespaced.namespace}" — add it under "registries" in motionscript.json.`
    )
  }
  const registry: RegistryConfig =
    typeof entry === "string" ? { url: entry } : entry
  if (!registry.url.includes("{name}")) {
    throw new Error(
      `Registry "${namespaced.namespace}" URL must contain a literal "{name}" placeholder.`
    )
  }

  return {
    url: registry.url.replace("{name}", namespaced.itemName),
    headers: registry.headers
      ? Object.fromEntries(
          Object.entries(registry.headers).map(([key, value]) => [
            key,
            interpolate(value, env),
          ])
        )
      : undefined,
    itemName: namespaced.itemName,
  }
}

/** Narrows a parsed JSON response, with a message naming what was asked for. */
export function assertRegistryItem(
  data: unknown,
  name: string
): asserts data is RegistryItem {
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray((data as { files?: unknown }).files)
  ) {
    throw new Error(
      `Malformed registry item for "${name}" (expected an object with a "files" array).`
    )
  }
}
