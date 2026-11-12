import { LineChart } from "./line-chart";
import { BarChart } from "./bar-chart";
import { PieChart } from "./pie-chart";
import { RadarChart } from "./radar-chart";
import { RadialChart } from "./radial-chart";

// Typed by name, so the declaration names each component rather than spelling out its type through core.
export const NODES: (typeof LineChart | typeof BarChart | typeof PieChart | typeof RadarChart | typeof RadialChart)[] = [
  LineChart,
  BarChart,
  PieChart,
  RadarChart,
  RadialChart,
];
