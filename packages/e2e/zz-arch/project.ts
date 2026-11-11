import { NODES as CHARTS } from '../../components/charts/dist/index.js';
import { NODES as MATH } from '@motionscript/math';
import Building from './building';
import Structure from './structure';
import SitePlate from './site';

export const nodes = [Building, Structure, SitePlate, ...CHARTS, ...MATH];
