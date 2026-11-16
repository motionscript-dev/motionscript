import { GeoBorder } from "./border";
import { GeoGlobe } from "./globe";

// Typed by name, so the declaration names each component rather than spelling out its type through core.
export const NODES: (typeof GeoBorder | typeof GeoGlobe)[] = [GeoBorder, GeoGlobe];
