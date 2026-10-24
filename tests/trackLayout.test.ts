import { describe, expect, it } from 'vitest';
import { checkContent } from '../src/core/content';
import { MotoSim, type Entrant, type TrackDef } from '../src/core/race';
import { cpuEntrant } from '../src/core/raceDay';
import { layoutProblems, startProblems } from '../src/core/trackCheck';
import { drawnShape, lapGeom, lapMetres, lapPlan, sectionShapes, startGeom } from '../src/core/trackGeom';
import { loadManifest, loadMaps, rawContent } from './helpers';

// Section types against the drawn lap, and the start straight: its own stretch from the gate that
// joins the lap, ridden once at the start of lap 1.

const content = checkContent(rawContent(), loadManifest(), loadMaps()).content!;
const sections = content.racing.sections;

/** A 40 x 20 rectangle, ridden clockwise on the screen from its top-left corner. */
const box: [number, number][] = [
  [0, 0],
  [40, 0],
  [40, 20],
  [0, 20],
];

describe('drawn shape of a stretch', () => {
  const g = lapGeom(box);
  it('reads a straight, a corner and a U-turn from the drawing alone', () => {
    // Middle of the top side: straight.
    expect(drawnShape(g, 5 / 120, 35 / 120, 3.4).shape).toBe('straight');
    // Round the top-right corner: a 90 degree corner.
    const c = drawnShape(g, 35 / 120, 45 / 120, 3.4);
    expect(c.shape).toBe('corner');
    expect(c.turn).toBeCloseTo(90, 0);
    // Both right-hand corners together: a 180 degree U-turn, a hairpin.
    const u = drawnShape(g, 35 / 120, 65 / 120, 3.4);
    expect(u.shape).toBe('hairpin');
    expect(u.swept).toBeCloseTo(180, 0);
  });

  it('reads a long gentle bend as a sweeper', () => {
    const arc: [number, number][] = [];
    for (let i = 0; i < 64; i++) arc.push([Math.cos((i / 64) * 2 * Math.PI) * 30, Math.sin((i / 64) * 2 * Math.PI) * 30]);
    expect(drawnShape(lapGeom(arc), 0, 0.15, 3.4).shape).toBe('sweeper');
  });

  it('every section of every track sits on a stretch drawn the shape its type needs', () => {
    for (const t of content.tracks.tracks) {
      const shapes = sectionShapes(t);
      t.sections.forEach((s, i) => expect(sections[s.type].shapes, `${t.id} section ${i + 1} ${s.type}`).toContain(shapes[i].shape));
      expect(layoutProblems(t, sections), t.id).toEqual([]);
    }
  });
});

describe('layout check', () => {
  const farm = content.tracks.tracks.find((t) => t.id === 'farmland')!;

  it('flags a hairpin drawn on a straight', () => {
    const shapes = sectionShapes(farm);
    const i = shapes.findIndex((x) => x.shape === 'straight');
    const bad: TrackDef = { ...farm, sections: farm.sections.map((s, j) => (j === i ? { ...s, type: 'hairpin' } : s)) };
    const p = layoutProblems(bad, sections);
    expect(p.some((x) => x.field === `sections[${i}].type` && /drawn as a straight/.test(x.message))).toBe(true);
  });

  it('flags a missing start, one off the lap, one that cuts across the lap and a start gate on the lap', () => {
    expect(startProblems({ ...farm, start: undefined })[0].message).toMatch(/no start straight/);
    const off = farm.start!.path.map(([x, y]) => [x, y - 3] as [number, number]);
    expect(startProblems({ ...farm, start: { path: off } }).some((x) => /off the lap/.test(x.message))).toBe(true);
    const across: [number, number][] = [farm.path[Math.floor(farm.path.length / 2)], farm.start!.path[farm.start!.path.length - 1]];
    expect(startProblems({ ...farm, start: { path: across } }).length).toBeGreaterThan(0);
    const gate: TrackDef = { ...farm, sections: [{ ...farm.sections[0], type: 'start_gate' }, ...farm.sections.slice(1)] };
    expect(layoutProblems(gate, sections).some((x) => /start gate on the lap/.test(x.message))).toBe(true);
  });
});

describe('start straight and lap counting', () => {
  for (const t of content.tracks.tracks) {
    it(`lap 1 is the start straight, then the lap from where it joins to the line, on ${t.id}`, () => {
      const s = startGeom(t);
      expect(s.metres).toBeGreaterThan(0);
      expect(s.from).toBeLessThan(s.join);
      const one = lapPlan(t, 1);
      expect(one.secs[0]).toBe(-1);
      expect(one.marks[0]).toBeCloseTo(s.from, 9);
      expect(one.marks[1]).toBeCloseTo(s.join, 9);
      expect(one.marks.at(-1)).toBeCloseTo(1, 9);
      // Every stretch is ridden once, in order, and the distances add up.
      for (let i = 1; i < one.marks.length; i++) expect(one.marks[i]).toBeGreaterThan(one.marks[i - 1]);
      const lapM = lapMetres(t);
      expect(one.metres.reduce((a, b) => a + b, 0)).toBeCloseTo(s.metres + (1 - s.join) * lapM, 6);
      // Later laps are the whole loop, line to line.
      const two = lapPlan(t, 2);
      expect(two.secs).toEqual(t.sections.map((_, i) => i));
      expect(two.marks[0]).toBeCloseTo(1, 9);
      expect(two.marks.at(-1)).toBeCloseTo(2, 9);
    });

    it(`every finisher rides every stretch and the right number of laps on ${t.id}`, () => {
      const field: Entrant[] = content.riders.riders.slice(0, 8).map((d, i) => cpuEntrant(content, d, '50cc', i));
      const sim = new MotoSim(content.racing, content.bikes, t, '50cc', field, { laps: 3, motoIndex: 0, seed: 5 });
      const traces = sim.runToEnd();
      expect(traces.map((x) => x.lap)).toEqual([1, 2, 3]);
      for (const r of sim.riders.filter((x) => !x.retired)) {
        expect(r.lapTimes.length).toBe(3);
        for (const tr of traces) expect(tr.times[r.e.id].length).toBe(tr.marks.length);
      }
    });
  }
});
