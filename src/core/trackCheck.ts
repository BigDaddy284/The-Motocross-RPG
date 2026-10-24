import type { TrackDef } from './race';
import { headingAt, lapGeom, nearestOnLap, sectionShapes, START_PAD, startGeom, startHalfWidth, startHeadingAt, startPointAt } from './trackGeom';
import { DEFAULT_TRACK_WIDTH } from './trackParts';

// Checks that a track's sections and start straight agree with its drawing, shared by the game's
// content checks and (mirrored) the track editor. A section's type says how the race simulation
// times it and how riders ride it, so it has to match the shape drawn: a hairpin drawn on a
// straight makes riders brake hard in the middle of nowhere, and a straight drawn round a U-turn
// sends them through it flat out.

export interface LayoutProblem {
  field: string;
  message: string;
}

/** Shortest start straight, in grid units: room for the gate, the line-up and a run to the lap. */
export const START_MIN = 12;
/** Steepest angle, in degrees, the start straight may join the lap at. */
export const JOIN_MAX = 75;

export function layoutProblems(track: TrackDef, sectionDefs: Record<string, { name: string; shapes: string[] }>): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const shapes = sectionShapes(track);
  track.sections.forEach((s, i) => {
    const def = sectionDefs[s.type];
    if (!def) return;
    if (s.type === 'start_gate') {
      out.push({ field: `sections[${i}].type`, message: `section ${i + 1} is a start gate on the lap; the start is its own start straight now, so make this a straight` });
      return;
    }
    const d = shapes[i];
    if (!def.shapes.includes(d.shape)) {
      out.push({ field: `sections[${i}].type`, message: `section ${i + 1} (${def.name.toLowerCase()}) is drawn as ${article(d.shape)} ${d.shape} (it turns ${Math.round(d.swept)}°); it needs to be drawn as ${def.shapes.map((x) => `${article(x)} ${x}`).join(' or ')}` });
    }
  });
  out.push(...startProblems(track));
  return out;
}

function article(w: string): string {
  return /^[aeiou]/.test(w) ? 'an' : 'a';
}

/** The start straight: there, long enough, joined onto the lap, clear of the rest of the track. */
export function startProblems(track: TrackDef): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const add = (message: string) => out.push({ field: 'start', message });
  if (!track.start || track.start.path.length < 2) {
    add('no start straight: every track needs a start gate on its own start straight that joins the lap');
    return out;
  }
  const g = lapGeom(track.path);
  const s = startGeom(track, g);
  const width = track.width ?? DEFAULT_TRACK_WIDTH;
  const end = s.pts[s.pts.length - 1];
  const near = nearestOnLap(g, end.x, end.y);
  if (near.d > 0.3) add(`the start straight ends ${near.d.toFixed(1)} grid units off the lap; its last point must be on the lap where it joins`);
  if (s.total < START_MIN) add(`the start straight is ${s.total.toFixed(1)} grid units long; it needs at least ${START_MIN} for the gate, the line-up and a run to the lap`);
  if (s.join > 0.5) add('the start straight joins the lap in its second half, so lap 1 would skip most of the circuit; join it nearer the start of the lap');
  let turn = startHeadingAt(s, s.total - 0.5, 0.5) - headingAt(g, s.join);
  while (turn > Math.PI) turn -= 2 * Math.PI;
  while (turn < -Math.PI) turn += 2 * Math.PI;
  if (Math.abs(turn) > (JOIN_MAX * Math.PI) / 180) add(`the start straight meets the lap at ${Math.round((Math.abs(turn) * 180) / Math.PI)}°; join it at ${JOIN_MAX}° or less, heading the way the lap runs`);
  // Clear of the lap everywhere but where it merges, the start pad behind the gate included.
  const merge = width * 1.5 + 1;
  for (let u = -START_PAD; u < s.total - merge; u += 0.25) {
    const p = startPointAt(s, u);
    const d = nearestOnLap(g, p.x, p.y).d;
    const clear = width / 2 + startHalfWidth(s, u, width / 2) + 0.5;
    if (d < clear) {
      add(`the start straight runs into the lap at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}; keep it at least ${clear.toFixed(1)} grid units clear until it joins`);
      break;
    }
  }
  return out;
}
