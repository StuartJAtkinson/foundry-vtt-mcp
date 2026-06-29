// Pure conversion: Universal VTT (.uvtt/.dd2vtt/.df2vtt) geometry -> Foundry
// scene dimensions + Wall/AmbientLight document payloads.
//
// UVTT coordinates are in GRID UNITS; Foundry walls/lights are in PIXELS.
// Kept Foundry-free so it's unit-testable in plain node (see demo() below).

export interface UvttPoint {
  x: number;
  y: number;
}

export interface Uvtt {
  resolution?: { map_size?: UvttPoint; map_origin?: UvttPoint; pixels_per_grid?: number };
  line_of_sight?: UvttPoint[][];
  objects_line_of_sight?: UvttPoint[][];
  portals?: { bounds?: UvttPoint[]; closed?: boolean; position?: UvttPoint }[];
  lights?: { position?: UvttPoint; range?: number; intensity?: number; color?: string }[];
}

export interface SceneDocs {
  width: number;
  height: number;
  gridSize: number;
  walls: any[];
  lights: any[];
}

function normalizeColor(c?: string): string | undefined {
  if (!c) return undefined;
  // UVTT colors are often 8-char ARGB hex; Foundry wants #RRGGBB. Take the last 6.
  const hex = String(c).replace(/^#/, '').slice(-6);
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex}` : undefined;
}

export function uvttToSceneDocs(uvtt: Uvtt, opts: { gridDistance?: number } = {}): SceneDocs {
  const res = uvtt.resolution || {};
  const ppg = Number(res.pixels_per_grid) || 100;
  const origin = res.map_origin || { x: 0, y: 0 };
  const size = res.map_size || { x: 0, y: 0 };
  const gridDistance = opts.gridDistance ?? 5;

  const toPx = (p: UvttPoint): [number, number] => [
    Math.round((p.x - (origin.x || 0)) * ppg),
    Math.round((p.y - (origin.y || 0)) * ppg),
  ];

  const walls: any[] = [];
  const pushPolyline = (poly: UvttPoint[], extra: Record<string, unknown> = {}) => {
    for (let i = 0; i < poly.length - 1; i++) {
      const [x0, y0] = toPx(poly[i]);
      const [x1, y1] = toPx(poly[i + 1]);
      walls.push({ c: [x0, y0, x1, y1], ...extra });
    }
  };

  for (const poly of uvtt.line_of_sight || []) pushPolyline(poly);
  for (const poly of uvtt.objects_line_of_sight || []) pushPolyline(poly);

  // Portals -> doors: one wall segment, door:1; ds 0=closed, 1=open.
  for (const portal of uvtt.portals || []) {
    const b = portal.bounds || [];
    if (b.length >= 2) {
      const [x0, y0] = toPx(b[0]);
      const [x1, y1] = toPx(b[b.length - 1]);
      walls.push({ c: [x0, y0, x1, y1], door: 1, ds: portal.closed === false ? 1 : 0 });
    }
  }

  const lights = (uvtt.lights || []).map(l => {
    const [x, y] = toPx(l.position || { x: 0, y: 0 });
    // ponytail: range is in grid units; scale to scene distance units. Approximate
    // brightness split (bright = half dim); tune in Foundry if a map looks off.
    const radius = (Number(l.range) || 0) * gridDistance;
    const color = normalizeColor(l.color);
    return { x, y, config: { dim: radius, bright: radius / 2, ...(color ? { color } : {}) } };
  });

  return {
    width: Math.round((size.x || 0) * ppg),
    height: Math.round((size.y || 0) * ppg),
    gridSize: ppg,
    walls,
    lights,
  };
}

// Runnable self-check: `node dist/uvtt-to-scene.js`. Fails loudly if geometry breaks.
export function demo(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`uvtt-to-scene self-check FAILED: ${msg}`);
  };
  const out = uvttToSceneDocs({
    resolution: { map_size: { x: 2, y: 2 }, map_origin: { x: 0, y: 0 }, pixels_per_grid: 100 },
    // closed square room (5 points, last == first) -> 4 wall segments
    line_of_sight: [
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
        { x: 0, y: 0 },
      ],
    ],
    portals: [
      {
        bounds: [
          { x: 0, y: 1 },
          { x: 0, y: 1.5 },
        ],
        closed: true,
      },
    ],
    lights: [{ position: { x: 1, y: 1 }, range: 6, color: 'ffeecc99' }],
  });
  assert(out.width === 200 && out.height === 200, `dims ${out.width}x${out.height}`);
  assert(out.gridSize === 100, `gridSize ${out.gridSize}`);
  assert(
    out.walls.filter(w => !w.door).length === 4,
    `expected 4 walls, got ${out.walls.filter(w => !w.door).length}`
  );
  const door = out.walls.find(w => w.door);
  assert(!!door && door.ds === 0, 'closed door with ds=0');
  assert(
    JSON.stringify(out.walls[0].c) === JSON.stringify([0, 0, 200, 0]),
    `first wall ${JSON.stringify(out.walls[0].c)}`
  );
  assert(
    out.lights.length === 1 && out.lights[0].config.dim === 30,
    `light dim ${out.lights[0]?.config?.dim}`
  );
  assert(out.lights[0].config.color === '#eecc99', `light color ${out.lights[0].config.color}`);
  // eslint-disable-next-line no-console
  console.log('uvtt-to-scene self-check OK');
}

// Auto-run when executed directly in node (never in the Foundry bundle).
if (
  typeof process !== 'undefined' &&
  process.argv?.[1] &&
  /uvtt-to-scene\.js$/.test(process.argv[1])
) {
  demo();
}
