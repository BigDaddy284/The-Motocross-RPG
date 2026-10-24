import type { BikesData, ItemDef, StoryData, WorldData } from './career';
import { Grid } from './grid';
import { objectTile, type BakedMap, type Facing } from './mapTypes';
import type { RacingData } from './race';
import { RACING_SCHEMA, RIDERS_SCHEMA, SKILLS_SCHEMA, TRACKS_SCHEMA, checkRaceContent } from './raceContent';
import type { RidersData, TracksData } from './raceDay';
import { SHOPS_SCHEMA, checkShopContent, type ShopsData } from './shops';
import type { SkillsData } from './skills';
import { validate, type ContentError, type Schema } from './validate';

// Game content loaded from public/data. Each file is checked against its schema, then the files
// are checked against each other and against the baked maps (missing sprites, maps, dialogue,
// NPCs standing on blocked tiles).

export interface NpcDef {
  id: string;
  name: string;
  sprite: string;
  dialogue: string;
  map?: string;
  tile?: [number, number];
  facing?: Facing;
  /** Line sets picked by flag before falling back to dialogue: the first whose if is set, or whose unless is not. */
  talk?: { if?: string; unless?: string; dialogue: string }[];
  /** The NPC ignores the rider until this flag is set (GDD 4.2: only the opening chain's NPCs talk at first). */
  quietUntil?: string;
}

export interface DialogueLine {
  speaker: 'npc' | 'player' | 'narrator';
  text: string;
}

export interface Content {
  npcs: NpcDef[];
  dialogue: Record<string, { lines: DialogueLine[] }>;
  bikes: BikesData;
  items: Record<string, ItemDef>;
  story: StoryData;
  world: WorldData;
  skills: SkillsData;
  racing: RacingData;
  tracks: TracksData;
  riders: RidersData;
  shops: ShopsData;
}

export interface Manifest {
  maps: { id: string; title: string; kind: string }[];
  characters: {
    frame: [number, number];
    anchor: [number, number];
    rows: Facing[];
    walk: { columns: number; fps: number };
    act: { columns: string[]; idle_fps: number };
    sheets: Record<string, { name: string; walk: string; act: string }>;
  };
}

const ID = /^[a-z0-9_.-]+$/;
const FACING = ['down', 'left', 'right', 'up'] as const;

export const NPCS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    npcs: {
      type: 'array',
      items: {
        type: 'object',
        optional: ['map', 'tile', 'facing', 'talk', 'quietUntil'],
        fields: {
          id: { type: 'string', pattern: ID },
          name: { type: 'string', nonEmpty: true },
          sprite: { type: 'string', pattern: ID },
          dialogue: { type: 'string', pattern: ID },
          map: { type: 'string', pattern: ID },
          tile: { type: 'array', items: { type: 'number', integer: true, min: 0 }, minItems: 2, maxItems: 2 },
          facing: { type: 'string', oneOf: FACING },
          talk: {
            type: 'array',
            items: { type: 'object', optional: ['if', 'unless'], fields: { if: { type: 'string', pattern: ID }, unless: { type: 'string', pattern: ID }, dialogue: { type: 'string', pattern: ID } } },
          },
          quietUntil: { type: 'string', pattern: ID },
        },
      },
    },
  },
};

export const DIALOGUE_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    dialogue: {
      type: 'record',
      values: {
        type: 'object',
        fields: {
          lines: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              fields: { speaker: { type: 'string', oneOf: ['npc', 'player', 'narrator'] }, text: { type: 'string', nonEmpty: true } },
            },
          },
        },
      },
    },
  },
};

const NUM = { type: 'number' } as const;
const WEIGHTS: Schema = { type: 'record', values: { type: 'number', min: 0 } };

export const BIKES_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    stats: { type: 'array', minItems: 1, items: { type: 'object', fields: { id: { type: 'string', pattern: ID }, name: { type: 'string', nonEmpty: true } } } },
    slots: {
      type: 'array',
      minItems: 1,
      items: { type: 'object', optional: ['engine'], fields: { id: { type: 'string', pattern: ID }, name: { type: 'string', nonEmpty: true }, weights: WEIGHTS, engine: { type: 'boolean' } } },
    },
    classes: { type: 'array', minItems: 1, items: { type: 'object', fields: { id: { type: 'string', pattern: ID }, name: { type: 'string', nonEmpty: true }, ceiling: { type: 'number', min: 1 } } } },
    starter: {
      type: 'object',
      fields: {
        class: { type: 'string', pattern: ID },
        grade: { type: 'number', integer: true, min: 1, max: 10 },
        condition: { type: 'array', items: { type: 'number', min: 0, max: 1 }, minItems: 2, maxItems: 2 },
        brokenSlot: { type: 'string', pattern: ID },
      },
    },
    brands: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        fields: { id: { type: 'string', pattern: ID }, name: { type: 'string', nonEmpty: true }, starter: { type: 'string', nonEmpty: true }, character: { type: 'string', nonEmpty: true }, lean: WEIGHTS },
      },
    },
  },
};

export const ITEMS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    items: {
      type: 'record',
      values: {
        type: 'object',
        optional: ['part'],
        fields: {
          name: { type: 'string', nonEmpty: true },
          desc: { type: 'string' },
          part: { type: 'object', fields: { slot: { type: 'string', pattern: ID }, grade: { type: 'number', integer: true, min: 1, max: 10 }, condition: { type: 'number', min: 0, max: 1 } } },
        },
      },
    },
  },
};

const IDS: Schema = { type: 'array', items: { type: 'string', pattern: ID } };

export const STORY_SCHEMA: Schema = {
  type: 'object',
  optional: ['note', 'after'],
  fields: {
    note: { type: 'string' },
    startMoney: { type: 'number', min: 0 },
    intro: { type: 'string', pattern: ID },
    done: { type: 'string', nonEmpty: true },
    after: {
      type: 'array',
      items: { type: 'object', optional: ['if', 'unless'], fields: { if: { type: 'string', pattern: ID }, unless: { type: 'string', pattern: ID }, text: { type: 'string', nonEmpty: true } } },
    },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        optional: ['times', 'needs', 'notReady', 'confirm', 'lines', 'effects', 'toast'],
        fields: {
          id: { type: 'string', pattern: ID },
          journal: { type: 'string', nonEmpty: true },
          on: { type: 'object', optional: ['talk', 'use', 'map'], fields: { talk: { type: 'string', pattern: ID }, use: { type: 'string', pattern: ID }, map: { type: 'string', pattern: ID } } },
          times: { type: 'number', integer: true, min: 1 },
          needs: { type: 'object', optional: ['money', 'items'], fields: { money: { type: 'number', min: 0 }, items: IDS } },
          notReady: { type: 'string', pattern: ID },
          confirm: { type: 'string', nonEmpty: true },
          lines: { type: 'string', pattern: ID },
          effects: { type: 'object', optional: ['money', 'give', 'take', 'fit', 'flags'], fields: { money: NUM, give: IDS, take: IDS, fit: { type: 'string', pattern: ID }, flags: IDS } },
          toast: { type: 'string', nonEmpty: true },
        },
      },
    },
  },
};

export const WORLD_SCHEMA: Schema = {
  type: 'object',
  optional: ['note', 'testPayMultiplier'],
  fields: {
    note: { type: 'string' },
    testPayMultiplier: { type: 'number', min: 0 },
    locks: {
      type: 'array',
      items: { type: 'object', fields: { map: { type: 'string', pattern: ID }, object: { type: 'string', nonEmpty: true }, flag: { type: 'string', pattern: ID }, message: { type: 'string', nonEmpty: true } } },
    },
    worldMap: {
      type: 'array',
      minItems: 1,
      items: { type: 'object', fields: { map: { type: 'string', pattern: ID }, spawn: { type: 'string', pattern: ID }, name: { type: 'string', nonEmpty: true }, note: { type: 'string' } } },
    },
    jobs: {
      type: 'array',
      items: {
        type: 'object',
        optional: ['needs'],
        fields: {
          id: { type: 'string', pattern: ID },
          name: { type: 'string', nonEmpty: true },
          map: { type: 'string', pattern: ID },
          start: { type: 'string', nonEmpty: true },
          product: { type: 'string', nonEmpty: true },
          batch: { type: 'number', integer: true, min: 1 },
          pay: { type: 'number', min: 0 },
          needs: { type: 'string', pattern: ID },
          stations: {
            type: 'array',
            minItems: 1,
            items: { type: 'object', fields: { object: { type: 'string', nonEmpty: true }, label: { type: 'string', nonEmpty: true }, ms: { type: 'number', integer: true, min: 0 } } },
          },
        },
      },
    },
  },
};

export const CONTENT_FILES = {
  npcs: 'data/npcs.json',
  dialogue: 'data/dialogue.json',
  bikes: 'data/bikes.json',
  items: 'data/items.json',
  story: 'data/story.json',
  world: 'data/world.json',
  skills: 'data/skills.json',
  racing: 'data/racing.json',
  tracks: 'data/tracks.json',
  riders: 'data/riders.json',
  shops: 'data/shops.json',
} as const;

export type RawContent = Record<keyof typeof CONTENT_FILES, unknown>;

const SCHEMAS: Record<keyof typeof CONTENT_FILES, Schema> = {
  npcs: NPCS_SCHEMA,
  dialogue: DIALOGUE_SCHEMA,
  bikes: BIKES_SCHEMA,
  items: ITEMS_SCHEMA,
  story: STORY_SCHEMA,
  world: WORLD_SCHEMA,
  skills: SKILLS_SCHEMA,
  racing: RACING_SCHEMA,
  tracks: TRACKS_SCHEMA,
  riders: RIDERS_SCHEMA,
  shops: SHOPS_SCHEMA,
};

/** Checks raw file contents and returns the typed content, or every problem found. */
export function checkContent(raw: RawContent, manifest: Manifest, maps: Map<string, BakedMap>): { content: Content | null; errors: ContentError[] } {
  const errors = (Object.keys(CONTENT_FILES) as (keyof typeof CONTENT_FILES)[]).flatMap((k) => validate(CONTENT_FILES[k], raw[k], SCHEMAS[k]));
  if (errors.length) return { content: null, errors };

  const content: Content = {
    npcs: (raw.npcs as { npcs: NpcDef[] }).npcs,
    dialogue: (raw.dialogue as Content).dialogue,
    bikes: raw.bikes as BikesData,
    items: (raw.items as { items: Record<string, ItemDef> }).items,
    story: raw.story as StoryData,
    world: raw.world as WorldData,
    skills: raw.skills as SkillsData,
    racing: raw.racing as RacingData,
    tracks: raw.tracks as TracksData,
    riders: raw.riders as RidersData,
    shops: raw.shops as ShopsData,
  };
  const file = CONTENT_FILES.npcs;
  const seen = new Set<string>();
  content.npcs.forEach((n, i) => {
    const at = (f: string) => `npcs[${i}].${f}`;
    if (seen.has(n.id)) errors.push({ file, field: at('id'), message: `"${n.id}" is used twice` });
    seen.add(n.id);
    if (!manifest.characters.sheets[n.sprite]) errors.push({ file, field: at('sprite'), message: `no character sheet "${n.sprite}"` });
    if (!content.dialogue[n.dialogue]) errors.push({ file, field: at('dialogue'), message: `no dialogue "${n.dialogue}" in ${CONTENT_FILES.dialogue}` });
    n.talk?.forEach((t, j) => {
      if (!content.dialogue[t.dialogue]) errors.push({ file, field: at(`talk[${j}].dialogue`), message: `no dialogue "${t.dialogue}" in ${CONTENT_FILES.dialogue}` });
    });
    if ((n.map === undefined) !== (n.tile === undefined)) errors.push({ file, field: at(n.map ? 'tile' : 'map'), message: 'map and tile must be given together' });
    if (n.map !== undefined && n.tile) {
      const m = maps.get(n.map);
      if (!m) errors.push({ file, field: at('map'), message: `no map "${n.map}"` });
      else if (Grid.fromMap(m).isBlocked(n.tile[0], n.tile[1])) errors.push({ file, field: at('tile'), message: `tile ${n.tile.join(',')} is blocked on ${n.map}` });
    }
  });
  errors.push(...checkCareerContent(content, maps));
  errors.push(...checkRaceContent(content, maps));
  errors.push(...checkShopContent(CONTENT_FILES.shops, content.shops, content.bikes, seen, maps));
  return { content, errors };
}

/** Cross-checks between the bike, item, story and world files and the maps. */
function checkCareerContent(c: Content, maps: Map<string, BakedMap>): ContentError[] {
  const errors: ContentError[] = [];
  const err = (file: string, field: string, message: string) => errors.push({ file, field, message });
  const { bikes, story, world } = c;

  const statIds = new Set(bikes.stats.map((s) => s.id));
  const slotIds = new Set(bikes.slots.map((s) => s.id));
  bikes.slots.forEach((s, i) => {
    for (const k of Object.keys(s.weights)) if (!statIds.has(k)) err(CONTENT_FILES.bikes, `slots[${i}].weights.${k}`, `no stat "${k}"`);
  });
  for (const st of bikes.stats) {
    const sum = bikes.slots.reduce((a, s) => a + (s.weights[st.id] ?? 0), 0);
    if (Math.abs(sum - 1) > 0.001) err(CONTENT_FILES.bikes, 'slots', `the ${st.id} weights add up to ${sum.toFixed(3)}, not 1`);
  }
  bikes.brands.forEach((b, i) => {
    for (const k of Object.keys(b.lean)) if (!statIds.has(k)) err(CONTENT_FILES.bikes, `brands[${i}].lean.${k}`, `no stat "${k}"`);
    const total = bikes.stats.reduce((a, st) => a + (b.lean[st.id] ?? 1), 0);
    if (Math.abs(total - bikes.stats.length) > 0.001) err(CONTENT_FILES.bikes, `brands[${i}].lean`, `adds up to ${total.toFixed(3)}, not ${bikes.stats.length}, so one brand would be better overall`);
  });
  if (!bikes.classes.some((k) => k.id === bikes.starter.class)) err(CONTENT_FILES.bikes, 'starter.class', `no class "${bikes.starter.class}"`);
  if (!slotIds.has(bikes.starter.brokenSlot)) err(CONTENT_FILES.bikes, 'starter.brokenSlot', `no slot "${bikes.starter.brokenSlot}"`);

  for (const [id, item] of Object.entries(c.items)) {
    if (item.part && !slotIds.has(item.part.slot)) err(CONTENT_FILES.items, `items.${id}.part.slot`, `no slot "${item.part.slot}"`);
  }

  const npcIds = new Set(c.npcs.map((n) => n.id));
  const item = (field: string, id: string) => !c.items[id] && err(CONTENT_FILES.story, field, `no item "${id}" in ${CONTENT_FILES.items}`);
  const lines = (field: string, id: string | undefined) => id && !c.dialogue[id] && err(CONTENT_FILES.story, field, `no dialogue "${id}" in ${CONTENT_FILES.dialogue}`);
  lines('intro', story.intro);
  story.steps.forEach((s, i) => {
    const at = (f: string) => `steps[${i}].${f}`;
    if (!!s.on.talk === !!s.on.use) err(CONTENT_FILES.story, at('on'), 'needs exactly one of talk or use');
    if (s.on.talk && !npcIds.has(s.on.talk)) err(CONTENT_FILES.story, at('on.talk'), `no NPC "${s.on.talk}"`);
    if (s.on.use) {
      const onMaps = s.on.map ? [maps.get(s.on.map)] : [...maps.values()];
      if (s.on.map && !onMaps[0]) err(CONTENT_FILES.story, at('on.map'), `no map "${s.on.map}"`);
      else if (!onMaps.some((m) => m?.objects.some((o) => o.props.action === s.on.use))) err(CONTENT_FILES.story, at('on.use'), `no object with action "${s.on.use}"`);
    }
    lines(at('lines'), s.lines);
    lines(at('notReady'), s.notReady);
    s.needs?.items?.forEach((id, j) => item(at(`needs.items[${j}]`), id));
    s.effects?.give?.forEach((id, j) => item(at(`effects.give[${j}]`), id));
    s.effects?.take?.forEach((id, j) => item(at(`effects.take[${j}]`), id));
    if (s.effects?.fit) {
      item(at('effects.fit'), s.effects.fit);
      if (c.items[s.effects.fit] && !c.items[s.effects.fit].part) err(CONTENT_FILES.story, at('effects.fit'), `"${s.effects.fit}" is not a part`);
    }
  });

  const objectOn = (field: string, mapId: string, name: string) => {
    const m = maps.get(mapId);
    if (!m) err(CONTENT_FILES.world, field, `no map "${mapId}"`);
    else if (!m.objects.some((o) => o.name === name)) err(CONTENT_FILES.world, field, `no object "${name}" on ${mapId}`);
  };
  world.locks.forEach((l, i) => objectOn(`locks[${i}].object`, l.map, l.object));
  world.worldMap.forEach((d, i) => {
    const m = maps.get(d.map);
    if (!m) err(CONTENT_FILES.world, `worldMap[${i}].map`, `no map "${d.map}"`);
    else if (!m.objects.some((o) => o.type === 'spawn' && o.name === d.spawn)) err(CONTENT_FILES.world, `worldMap[${i}].spawn`, `no spawn "${d.spawn}" on ${d.map}`);
  });
  world.jobs.forEach((j, i) => {
    objectOn(`jobs[${i}].start`, j.map, j.start);
    j.stations.forEach((s, k) => objectOn(`jobs[${i}].stations[${k}].object`, j.map, s.object));
  });
  return errors;
}

export interface NpcPlacement {
  npc: NpcDef;
  x: number;
  y: number;
  facing: Facing;
}

/** NPCs standing on one map: those placed by tile in npcs.json, plus the map's own npc spots. */
export function npcsOnMap(content: Content, map: BakedMap): NpcPlacement[] {
  const byId = new Map(content.npcs.map((n) => [n.id, n]));
  const out: NpcPlacement[] = [];
  for (const n of content.npcs) if (n.map === map.id && n.tile) out.push({ npc: n, x: n.tile[0], y: n.tile[1], facing: n.facing ?? 'down' });
  for (const o of map.objects) {
    if (o.type !== 'npc') continue;
    const n = byId.get(String(o.props.npc));
    if (!n || n.map) continue;
    const t = objectTile(o, map.tileSize);
    out.push({ npc: n, x: t.x, y: t.y, facing: 'down' });
  }
  return out;
}
