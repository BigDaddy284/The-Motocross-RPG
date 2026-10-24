import type { BikesData } from './career';
import type { BakedMap } from './mapTypes';
import type { RacingData } from './race';
import type { RidersData, TracksData } from './raceDay';
import type { SkillsData } from './skills';
import { layoutProblems } from './trackCheck';
import type { ContentError, Schema } from './validate';

// Schemas and cross-checks for the skills, racing, tracks and riders files.

const ID = /^[a-z0-9_.-]+$/;
const S = { type: 'string', nonEmpty: true } as const;
const IDS = { type: 'string', pattern: ID } as const;
const N = { type: 'number' } as const;
const N0 = { type: 'number', min: 0 } as const;
const SHARE = { type: 'number', min: 0, max: 1 } as const;
const RANGE: Schema = { type: 'array', items: N0, minItems: 2, maxItems: 2 };
const LEVEL = { type: 'number', integer: true, min: 1, max: 99 } as const;
const WEIGHTS: Schema = { type: 'record', values: N0 };

export const SKILLS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    maxLevel: LEVEL,
    crossBonus: SHARE,
    leads: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        fields: {
          id: IDS,
          name: S,
          multiplier: { type: 'number', min: 1 },
          bonusTo: IDS,
          desc: S,
          children: { type: 'array', minItems: 1, items: { type: 'object', fields: { id: IDS, name: S, desc: S } } },
          unlocks: { type: 'array', items: { type: 'object', fields: { level: LEVEL, text: S } } },
        },
      },
    },
  },
};

export const RACING_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    sim: {
      type: 'object',
      fields: {
        spread: N0,
        noise: N0,
        consistencyNoiseCut: SHARE,
        mistakeBase: SHARE,
        mistakeConsistencyCut: SHARE,
        outcomes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            optional: ['timePct', 'seconds', 'crash', 'serious'],
            fields: { id: { type: 'string', oneOf: ['small', 'big', 'minor_crash', 'serious_crash'] }, share: SHARE, timePct: RANGE, seconds: RANGE, crash: { type: 'boolean' }, serious: { type: 'boolean' } },
          },
        },
        agilityRecoveryCut: SHARE,
        passWindow: N0,
        failedPassCost: RANGE,
        blockedGap: N0,
        rutPerMoto: N0,
        rutSections: { type: 'array', items: IDS },
        cleanAir: { type: 'object', fields: { top: N0, bonusPct: N0, trafficAfter: N0, penaltyPct: N0 } },
        retireAtBroken: { type: 'number', integer: true, min: 1 },
      },
    },
    xp: {
      type: 'object',
      fields: { sectionFactor: N0, practiceFactor: N0, finishBonus: N0, positionStep: N0, positionFloor: N0, overtakeXp: N0, consistencyWeight: N0 },
    },
    classes: { type: 'record', values: { type: 'object', fields: { laps: { type: 'number', integer: true, min: 1 }, entry: N0, classXp: N0, refSpeed: { type: 'number', min: 1 }, youth: { type: 'boolean' } } } },
    messages: {
      type: 'array',
      minItems: 1,
      items: { type: 'object', fields: { id: IDS, name: S, pace: N, risk: N, overtaking: N, consistency: N, desc: S } },
    },
    messageEffects: {
      type: 'object',
      fields: { pacePct: N0, paceMistakes: N0, riskPass: N0, riskCrashShare: N0, overtakingEager: N0, consistencyNoise: N0, consistencyTimePct: N0 },
    },
    ink: { type: 'number', integer: true, min: 0 },
    sections: {
      type: 'record',
      values: { type: 'object', fields: { name: S, diff: N0, skills: WEIGHTS, stats: { type: 'array', minItems: 1, items: IDS }, riderWeight: SHARE, damage: IDS, shapes: { type: 'array', minItems: 1, items: { type: 'string', oneOf: ['straight', 'sweeper', 'corner', 'hairpin'] } } } },
    },
    damageSlots: { type: 'record', values: { type: 'array', minItems: 1, items: IDS } },
    wear: {
      type: 'object',
      fields: {
        lifespanKm: { type: 'record', values: { type: 'number', min: 1 } },
        youth: N0,
        lowAt: SHARE,
        lowBase: N0,
        lowSlope: N0,
        knockLow: N0,
        knockBroken: N0,
        breakAtFull: SHARE,
        breakAtLow: SHARE,
        minorCrashLoss: SHARE,
      },
    },
    points: { type: 'array', minItems: 1, items: N0 },
    prize: { type: 'object', fields: { winnerTimesEntry: N0, shares: { type: 'array', items: SHARE }, podium: { type: 'array', items: SHARE } } },
  },
};

const POINT: Schema = { type: 'array', items: N0, minItems: 2, maxItems: 2 };

export const TRACKS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    tracks: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        optional: ['practiceOnly', 'gates', 'kind', 'width', 'patches', 'ground', 'scenery', 'start'],
        fields: {
          id: IDS,
          name: S,
          size: IDS,
          surface: IDS,
          practiceOnly: { type: 'boolean' },
          gates: { type: 'array', items: N },
          path: { type: 'array', minItems: 3, items: POINT },
          sections: {
            type: 'array',
            minItems: 1,
            items: { type: 'object', optional: ['line', 'height'], fields: { type: IDS, length: { type: 'number', min: 1 }, passing: SHARE, line: IDS, height: N0 } },
          },
          kind: IDS,
          width: { type: 'number', min: 1, max: 12 },
          start: { type: 'object', optional: ['passing'], fields: { path: { type: 'array', minItems: 2, items: POINT }, passing: SHARE } },
          patches: { type: 'array', items: { type: 'object', fields: { surface: IDS, at: N0, length: { type: 'number', min: 1 } } } },
          ground: {
            type: 'object',
            fields: {
              base: IDS,
              cell: { type: 'number', integer: true, min: 1, max: 10 },
              paint: { type: 'record', values: { type: 'array', items: { type: 'array', items: { type: 'number', integer: true, min: 0 }, minItems: 2, maxItems: 2 } } },
            },
          },
          scenery: {
            type: 'array',
            items: {
              type: 'object',
              optional: ['w', 'h', 'rot', 'text', 'color'],
              fields: { type: IDS, x: N, y: N, w: { type: 'number', min: 0.1 }, h: { type: 'number', min: 0.1 }, rot: N, text: { type: 'string' }, color: { type: 'string', pattern: /^#[0-9a-fA-F]{3,8}$/ } },
            },
          },
        },
      },
    },
    venues: {
      type: 'array',
      items: {
        type: 'object',
        optional: ['track', 'class', 'field', 'office', 'needs', 'practiceFeePct', 'firstRaceFree', 'practiceOnly', 'area', 'locked'],
        fields: {
          id: IDS,
          name: S,
          map: IDS,
          track: IDS,
          class: IDS,
          field: IDS,
          office: IDS,
          needs: IDS,
          practiceFeePct: N0,
          firstRaceFree: { type: 'boolean' },
          practiceOnly: { type: 'boolean' },
          area: { type: 'array', items: { type: 'number', integer: true, min: 0 }, minItems: 4, maxItems: 4 },
          locked: S,
        },
      },
    },
  },
};

export const RIDERS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    riders: {
      type: 'array',
      items: {
        type: 'object',
        optional: ['tag', 'skills', 'style'],
        fields: {
          id: IDS,
          name: S,
          tag: S,
          level: LEVEL,
          skills: { type: 'record', values: LEVEL },
          bike: { type: 'object', fields: { brand: IDS, grade: { type: 'number', integer: true, min: 1, max: 10 }, condition: SHARE } },
          tactic: { type: 'object', optional: ['push', 'pushGap'], fields: { message: IDS, push: N0, pushGap: N0 } },
          style: {
            type: 'object',
            optional: ['line', 'aggression', 'jumps'],
            fields: { line: { type: 'string', oneOf: ['inside', 'middle', 'outside'] }, aggression: SHARE, jumps: { type: 'string', oneOf: ['scrub', 'float'] } },
          },
        },
      },
    },
    fields: { type: 'record', values: { type: 'array', items: IDS } },
  },
};

/** Cross-checks: every skill, stat, slot, section, message, track, rider and map named exists. */
export function checkRaceContent(c: { skills: SkillsData; racing: RacingData; tracks: TracksData; riders: RidersData; bikes: BikesData }, maps: Map<string, BakedMap>): ContentError[] {
  const errors: ContentError[] = [];
  const err = (file: string, field: string, message: string) => errors.push({ file, field, message });
  const F = { skills: 'data/skills.json', racing: 'data/racing.json', tracks: 'data/tracks.json', riders: 'data/riders.json' };
  const { skills, racing, tracks, riders, bikes } = c;

  const leadIds = new Set(skills.leads.map((l) => l.id));
  const childIds = new Set(skills.leads.flatMap((l) => l.children.map((x) => x.id)));
  skills.leads.forEach((l, i) => !leadIds.has(l.bonusTo) && err(F.skills, `leads[${i}].bonusTo`, `no lead skill "${l.bonusTo}"`));
  if (!leadIds.has('rider')) err(F.skills, 'leads', 'needs the "rider" lead skill (Rider Ability)');

  const statIds = new Set(bikes.stats.map((s) => s.id));
  const slotIds = new Set(bikes.slots.map((s) => s.id));
  const classIds = new Set(bikes.classes.map((k) => k.id));
  const messageIds = new Set(racing.messages.map((m) => m.id));
  if (!messageIds.has('steady')) err(F.racing, 'messages', 'needs a "steady" message');
  for (const id of Object.keys(racing.classes)) if (!classIds.has(id)) err(F.racing, `classes.${id}`, `no class "${id}" in data/bikes.json`);
  for (const [id, s] of Object.entries(racing.sections)) {
    for (const k of Object.keys(s.skills)) if (!childIds.has(k)) err(F.racing, `sections.${id}.skills.${k}`, `no skill "${k}"`);
    s.stats.forEach((st, j) => !statIds.has(st) && err(F.racing, `sections.${id}.stats[${j}]`, `no bike stat "${st}"`));
    if (!racing.damageSlots[s.damage]) err(F.racing, `sections.${id}.damage`, `no damage group "${s.damage}"`);
  }
  if (!racing.sections.straight) err(F.racing, 'sections', 'needs a "straight" section (the start straight after lap 1)');
  for (const [g, list] of Object.entries(racing.damageSlots)) list.forEach((s, j) => !slotIds.has(s) && err(F.racing, `damageSlots.${g}[${j}]`, `no slot "${s}"`));
  for (const s of Object.keys(racing.wear.lifespanKm)) if (!slotIds.has(s)) err(F.racing, `wear.lifespanKm.${s}`, `no slot "${s}"`);
  racing.sim.rutSections.forEach((s, j) => !racing.sections[s] && err(F.racing, `sim.rutSections[${j}]`, `no section "${s}"`));

  const trackIds = new Set<string>();
  tracks.tracks.forEach((t, i) => {
    trackIds.add(t.id);
    t.sections.forEach((s, j) => !racing.sections[s.type] && err(F.tracks, `tracks[${i}].sections[${j}].type`, `no section "${s.type}" in ${F.racing}`));
    for (const p of layoutProblems(t, racing.sections)) err(F.tracks, `tracks[${i}].${p.field}`, `${t.id}: ${p.message}`);
  });
  const fieldIds = new Set(Object.keys(riders.fields));
  tracks.venues.forEach((v, i) => {
    const at = (f: string) => `venues[${i}].${f}`;
    if (!maps.has(v.map)) err(F.tracks, at('map'), `no map "${v.map}"`);
    if (v.track && !trackIds.has(v.track)) err(F.tracks, at('track'), `no track "${v.track}"`);
    if (v.track && !v.locked && !racing.classes[v.class ?? '']) err(F.tracks, at('class'), `no class "${v.class}" in ${F.racing}`);
    if (v.field && !fieldIds.has(v.field)) err(F.tracks, at('field'), `no field "${v.field}" in ${F.riders}`);
    if (!v.track && !v.locked) err(F.tracks, at('track'), 'a venue needs a track or a locked message');
  });

  const riderIds = new Set<string>();
  const brands = new Set(bikes.brands.map((b) => b.id));
  riders.riders.forEach((r, i) => {
    if (riderIds.has(r.id)) err(F.riders, `riders[${i}].id`, `"${r.id}" is used twice`);
    riderIds.add(r.id);
    if (!brands.has(r.bike.brand)) err(F.riders, `riders[${i}].bike.brand`, `no brand "${r.bike.brand}"`);
    if (!messageIds.has(r.tactic.message)) err(F.riders, `riders[${i}].tactic.message`, `no message "${r.tactic.message}"`);
    for (const k of Object.keys(r.skills ?? {})) if (!childIds.has(k)) err(F.riders, `riders[${i}].skills.${k}`, `no skill "${k}"`);
  });
  for (const [f, ids] of Object.entries(riders.fields)) ids.forEach((id, j) => !riderIds.has(id) && err(F.riders, `fields.${f}[${j}]`, `no rider "${id}"`));
  return errors;
}
