import type { TrackDef } from './race';
import { gridOf, headingAt, isNoTurn, isSprint, lapGeom, NO_TURN_GATES, NO_TURN_KIND, nearestOnLap, noTurnPath, noTurnStartPath, pointAt, RETURN_LANE, RUN_OFF, RETURN_TAPER, RETURN_WIDTH, sectionBounds, SPRINT_KIND, START_PAD, startGeom, startHalfWidth, startHeadingAt, startPointAt } from './trackGeom';
import { DEFAULT_TRACK_WIDTH } from './trackParts';

// Checks that a track's sections and start straight agree with its drawing, shared by the game's
// content checks and (mirrored) the track editor. A section's type says how the race simulation
// times it and how riders ride it; the shape it is drawn on is the track maker's choice (a wide
// hairpin, a tight sweeper), so no check ties a type to a drawn shape.

export interface LayoutProblem {
  field: string;
  message: string;
}

/** Shortest start straight, in grid units: room for the gate, the line-up and a run to the lap. */
export const START_MIN = 12;
/** Steepest angle, in degrees, the start straight may join the lap at. */
export const JOIN_MAX = 75;

export function layoutProblems(track: TrackDef, sectionDefs: Record<string, { name: string }>): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const sprint = track.kind === SPRINT_KIND;
  const noTurn = track.kind === NO_TURN_KIND;
  track.sections.forEach((s, i) => {
    if (!sectionDefs[s.type]) return;
    if (s.type === RUN_OFF && !(noTurn && i === 0)) {
      out.push({ field: `sections[${i}].type`, message: noTurn ? `section ${i + 1} is a run-off; a No-Turn Takedown has one, its first section, past the finish line` : `section ${i + 1} is a run-off, which only a No-Turn Takedown has` });
    }
    if (s.type === 'start_gate') out.push({ field: `sections[${i}].type`, message: `section ${i + 1} is a start gate on the lap; the start is its own start straight now, so make this a straight` });
    if (s.type === RETURN_LANE && !(sprint && i === 0)) {
      out.push({ field: `sections[${i}].type`, message: sprint ? `section ${i + 1} is a return lane; an Enduro Sprint has one, its first section, from the finish line to the start line` : `section ${i + 1} is a return lane, which only an Enduro Sprint has` });
    }
  });
  out.push(...(sprint ? sprintProblems(track) : noTurn ? noTurnProblems(track) : startProblems(track)));
  return out;
}

/** The shortest return lane, in grid units: room for a whole field to queue single file at the start line. */
export const RETURN_MIN = 20;

/**
 * An Enduro Sprint's own rules, in place of the start straight's: the return lane is its first
 * section, from the finish line round to the start line, long enough for the queue, with no start
 * straight, and nowhere does it cross or run into the test, except where it leaves the finish
 * line and joins the start line.
 */
export function sprintProblems(track: TrackDef): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  if (!isSprint(track)) {
    add('sections[0].type', "an Enduro Sprint's first section is the return lane: the single-file lane from the finish line back to the start line");
    return out;
  }
  if (track.start?.path?.length) add('start', 'an Enduro Sprint has no start straight or start gate: riders leave one at a time from the start line at the end of the return lane, so remove it');
  if (track.sections.length < 2) {
    add('sections', 'an Enduro Sprint needs its test: sections after the return lane, from the start line to the finish line');
    return out;
  }
  const g = lapGeom(track.path);
  const b = sectionBounds(track);
  const lane = b[1] * g.total;
  if (lane < RETURN_MIN) add('sections[0].length', `the return lane is ${lane.toFixed(1)} grid units long; it needs at least ${RETURN_MIN} for the riders to queue single file at the start line`);
  // Clear of the test everywhere but its two ends, where it leaves the finish line and joins the start line.
  const width = track.width ?? DEFAULT_TRACK_WIDTH;
  const clear = width / 2 + (width * RETURN_WIDTH) / 2 + 0.5;
  const ends = RETURN_TAPER + clear + 1;
  for (let d = ends; d < lane - ends; d += 0.25) {
    const p = pointAt(g, d / g.total);
    let near = Infinity;
    for (let u = b[1] * g.total; u <= g.total; u += 0.25) near = Math.min(near, Math.hypot(pointAt(g, u / g.total).x - p.x, pointAt(g, u / g.total).y - p.y));
    if (near < clear) {
      add('sections[0]', `the return lane runs into the test at ${p.x.toFixed(0)}, ${p.y.toFixed(0)}; it must never cross the track, so keep it at least ${clear.toFixed(1)} grid units clear`);
      break;
    }
  }
  return out;
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

/** Section types that ride as corners: a No-Turn Takedown has none (Boss, 30 Oct 2026: "no bends/corners allowed"). */
export const NO_TURN_CORNERS = ['first_corner', 'flat_corner', 'berm', 'rutted_corner', 'hairpin', 'fast_sweeper', 'concrete_corner', 'off_camber'];
/** The shortest No-Turn Takedown run, from the start line to the finish line, in grid units. */
export const NO_TURN_RUN_MIN = 40;

/**
 * A No-Turn Takedown's own rules (Boss, 30 Oct 2026), in place of the start straight's: no bends
 * anywhere. The run-off is its first section; the drawing is the run in one straight line from the
 * start line to the finish line, the run-off straight on past it and the hidden way back
 * (trackGeom.noTurnPath); the start platform runs straight on into the run; and the start line,
 * the run, the run-off and the platform are all on the 200 × 30 grid. Four riders on the gate.
 */
export function noTurnProblems(track: TrackDef): LayoutProblem[] {
  const out: LayoutProblem[] = [];
  const add = (field: string, message: string) => out.push({ field, message });
  if (!isNoTurn(track)) {
    add('sections[0].type', "a No-Turn Takedown's first section is the run-off past the finish line, where riders pull up");
    return out;
  }
  if (track.sections.length < 2) {
    add('sections', 'a No-Turn Takedown needs its run: sections after the run-off, from the start line to the finish line');
    return out;
  }
  const path = track.path;
  const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.06;
  const [sx, sy] = path[path.length - 1] ?? [0, 0];
  const [fx, fy] = path[0] ?? [0, 0];
  const run = Math.hypot(fx - sx, fy - sy);
  const ang = Math.atan2(fy - sy, fx - sx);
  const straight = path.length === 6 && [1, -1].some((side) => noTurnPath(sx, sy, ang, run, side).every((p, i) => near(p, path[i])));
  if (!straight) {
    add('path', 'a No-Turn Takedown has no bends: the run goes in one straight line from the start line to the finish line, with the run-off straight on past it; place it again with the No-Turn tools');
    return out;
  }
  if (run < NO_TURN_RUN_MIN) add('path', `the run is ${run.toFixed(1)} grid units from the start line to the finish line; it needs at least ${NO_TURN_RUN_MIN}`);
  const g = lapGeom(path);
  const b = sectionBounds(track);
  const hidden = g.cum[path.length - 1];
  if (Math.abs(b[1] * g.total - hidden) > 0.5) add('sections[0].length', "the run-off section's length doesn't match the drawing: it runs from the finish line round to the start line, so the run's sections start on the start line");
  const st = track.start?.path;
  const start = noTurnStartPath(sx, sy, ang);
  if (!st || st.length !== 2 || !st.every((p, i) => near(p, start[i]))) add('start', 'the start platform runs straight into the run from its gate, in line with it; place it again with the No-Turn tools');
  if (track.gates && track.gates.length !== NO_TURN_GATES) add('gates', `a No-Turn Takedown has ${NO_TURN_GATES} gates on its start platform, not ${track.gates.length}`);
  const { w, h } = gridOf(track);
  const width = track.width ?? DEFAULT_TRACK_WIDTH;
  const ends: [number, number][] = [start[0], [sx, sy], [fx, fy], path[1]];
  for (const [x, y] of ends) {
    if (x < width / 2 || y < width / 2 || x > w - width / 2 || y > h - width / 2) {
      add('path', `the track runs off the ${w} × ${h} grid near ${x.toFixed(0)}, ${y.toFixed(0)}; move it back on (Move whole track)`);
      break;
    }
  }
  track.sections.forEach((sec, i) => {
    if (NO_TURN_CORNERS.includes(sec.type)) add(`sections[${i}].type`, `section ${i + 1} is a corner (${sec.type}); a No-Turn Takedown has no bends or corners`);
    if (sec.finish && i !== track.sections.length - 1) add(`sections[${i}].finish`, `section ${i + 1} is a finish-line jump, but the finish line is at the end of the run: only the last section can be one`);
  });
  return out;
}
