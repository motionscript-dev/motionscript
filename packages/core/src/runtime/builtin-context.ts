import { createContext } from "@/util/context";
import type { TextStyle } from "@/attributes/text/types";

/**
 * Built-in context tokens. These are ordinary {@link createContext} tokens —
 * the same primitive authors use for their own data — so the theme/text-style/
 * seed channels and user-defined context all travel one uniform path down the
 * node tree.
 */

/** Inherited text-style defaults (set by `<DefaultTextStyle>`). */
export const TextStyleToken = createContext<TextStyle>({}, "text-style");

/** Inherited theme map (set by `<ThemeProvider theme={…}>`). */
export const ThemeToken = createContext<Record<string, unknown>>({}, "theme");

/** Arbitrary inherited data bag (set by `<ThemeProvider data={…}>`). */
export const DataToken = createContext<Record<string, unknown>>({}, "data");

/** Inherited default seed (set by `<ThemeProvider seed={…}>`). Consumed by
 * author code today; a follow-up wires it into per-node randomness. */
export const SeedToken = createContext<string | number | undefined>(undefined, "seed");
