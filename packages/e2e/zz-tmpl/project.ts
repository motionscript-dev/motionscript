import { NODES as CHARTS } from '@motionscript/charts';
import { NODES as MATH } from '@motionscript/math';
import { NODES as GEO, geoRegistry, geoUrlSource } from '../../components/geography/dist/index.js';

// Scratch: every kit a drawing template may use, and the geo data the render serves under /geo.
geoRegistry.use(geoUrlSource('/geo'));

export const nodes = [...GEO, ...CHARTS, ...MATH];
