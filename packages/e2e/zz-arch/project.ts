import { NODES as CHARTS } from '@motionscript/charts';
import { NODES as MATH } from '@motionscript/math';
import House from './house';
import Block from './block';
import Tower from './tower';
import Frame from './frame';
import Truss from './truss';
import SitePlate from './site';
import SitePlot from './plot';

export const nodes = [House, Block, Tower, Frame, Truss, SitePlate, SitePlot, ...CHARTS, ...MATH];
