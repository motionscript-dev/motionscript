import { NODES as CHARTS } from '@motionscript/charts';
import { NODES as MATH } from '@motionscript/math';
import { NODES as CODE } from '../../components/code/dist/index.js';
import { NODES as GEO, geoRegistry, geoUrlSource } from '../../components/geography/dist/index.js';

// Scratch: the kits the promo's Built-for scene draws with, and the geo data the render serves under /geo.
geoRegistry.use(geoUrlSource('/geo'));

export const nodes = [...GEO, ...CHARTS, ...MATH, ...CODE];
