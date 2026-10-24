import type { CareerState } from './career';
import type { Facing } from './mapTypes';
import type { KeyValueStore } from './storage';

// Versioned career saves with rotating backups (Spec 21b, section 22 Foundation):
// - every write moves the current save into backup 1, backup 1 into 2, and so on up to 5;
// - a save from an older build loads through the migration steps below;
// - a save that cannot be read is kept under a "corrupt" key and the newest good backup is offered.

export const SAVE_VERSION = 3;
export const BACKUP_COUNT = 5;

export interface SaveData {
  version: number;
  /** Real-world time of the save, for the Load screen only; the game has no clock. */
  savedAt: string;
  rider: { name: string; look: string };
  position: { map: string; x: number; y: number; facing: Facing };
  flags: Record<string, boolean>;
  stats: { playSeconds: number };
  career: CareerState;
}

const V1_SLOTS = ['frame', 'top_end', 'bottom_end', 'intake_exhaust', 'drivetrain', 'forks', 'shock', 'wheels_tyres', 'brakes', 'bodywork'];

type Migration = (old: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a version n save to version n + 1. */
const MIGRATIONS: Record<number, Migration> = {
  // Test build 0.1 had no money, bike or story: start the opening chain with a Hondmoto, the all-rounder.
  1: (old) => ({
    ...old,
    career: {
      money: 15000,
      bike: { brand: 'hondmoto', class: '50cc', parts: Object.fromEntries(V1_SLOTS.map((s) => [s, { grade: 1, condition: s === 'top_end' ? 0 : 0.65 }])) },
      bag: [],
      story: { step: 0, used: [] },
      counters: {},
    },
  }),
  // Test build 0.2 had no skills: every skill starts at level 1.
  2: (old) => ({ ...old, career: { ...(old.career as Record<string, unknown>), skills: { xp: {}, bonus: {} } } }),
};

export type LoadResult =
  | { status: 'ok'; data: SaveData; fromBackup?: number }
  | { status: 'empty' }
  | { status: 'corrupt'; keptAs: string; backup: { index: number; data: SaveData } | null };

export class SaveManager {
  constructor(
    private readonly store: KeyValueStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key(slot: string, backup = 0): string {
    return backup === 0 ? `save:${slot}` : `save:${slot}:backup${backup}`;
  }

  slots(): string[] {
    return this.store
      .keys('save:')
      .map((k) => k.slice('save:'.length))
      .filter((k) => !k.includes(':'));
  }

  write(slot: string, data: Omit<SaveData, 'version' | 'savedAt'>): SaveData {
    const full: SaveData = { ...data, version: SAVE_VERSION, savedAt: this.now().toISOString() };
    const current = this.store.get(this.key(slot));
    if (current !== null) {
      for (let i = BACKUP_COUNT; i > 1; i--) {
        const older = this.store.get(this.key(slot, i - 1));
        if (older !== null) this.store.set(this.key(slot, i), older);
      }
      this.store.set(this.key(slot, 1), current);
    }
    this.store.set(this.key(slot), JSON.stringify(full));
    return full;
  }

  /**
   * Overwrites the current save without moving it into the backups, for frequent small saves
   * such as the rider's spot on every map change, so they don't push out older backups.
   */
  update(slot: string, data: Omit<SaveData, 'version' | 'savedAt'>): SaveData {
    if (this.store.get(this.key(slot)) === null) return this.write(slot, data);
    const full: SaveData = { ...data, version: SAVE_VERSION, savedAt: this.now().toISOString() };
    this.store.set(this.key(slot), JSON.stringify(full));
    return full;
  }

  load(slot: string): LoadResult {
    const raw = this.store.get(this.key(slot));
    if (raw === null) return { status: 'empty' };
    const data = parseSave(raw);
    if (data) return { status: 'ok', data };
    const keptAs = `corrupt:${slot}:${this.now().getTime()}`;
    this.store.set(keptAs, raw);
    return { status: 'corrupt', keptAs, backup: this.newestGoodBackup(slot) };
  }

  /** Makes a backup the current save again, after the player accepts the offer. */
  restoreBackup(slot: string, index: number): SaveData | null {
    const raw = this.store.get(this.key(slot, index));
    const data = raw === null ? null : parseSave(raw);
    if (!data) return null;
    this.store.set(this.key(slot), JSON.stringify(data));
    return data;
  }

  backups(slot: string): { index: number; savedAt: string | null }[] {
    const out = [];
    for (let i = 1; i <= BACKUP_COUNT; i++) {
      const raw = this.store.get(this.key(slot, i));
      if (raw === null) continue;
      out.push({ index: i, savedAt: parseSave(raw)?.savedAt ?? null });
    }
    return out;
  }

  delete(slot: string): void {
    this.store.remove(this.key(slot));
    for (let i = 1; i <= BACKUP_COUNT; i++) this.store.remove(this.key(slot, i));
  }

  private newestGoodBackup(slot: string): { index: number; data: SaveData } | null {
    for (let i = 1; i <= BACKUP_COUNT; i++) {
      const raw = this.store.get(this.key(slot, i));
      const data = raw === null ? null : parseSave(raw);
      if (data) return { index: i, data };
    }
    return null;
  }
}

/** Parses, migrates and checks a save. Returns null for anything that is not a valid save. */
export function parseSave(raw: string): SaveData | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null || typeof obj.version !== 'number') return null;
  if (obj.version > SAVE_VERSION) return null;
  while ((obj.version as number) < SAVE_VERSION) {
    const step = MIGRATIONS[obj.version as number];
    if (!step) return null;
    obj = { ...step(obj), version: (obj.version as number) + 1 };
  }
  return isSaveData(obj) ? obj : null;
}

function isSaveData(o: Record<string, unknown>): o is SaveData & Record<string, unknown> {
  const p = o.position as Record<string, unknown> | undefined;
  const r = o.rider as Record<string, unknown> | undefined;
  return (
    typeof o.savedAt === 'string' &&
    !!r && typeof r.name === 'string' && typeof r.look === 'string' &&
    !!p && typeof p.map === 'string' && Number.isInteger(p.x) && Number.isInteger(p.y) &&
    ['down', 'left', 'right', 'up'].includes(p.facing as string) &&
    typeof o.flags === 'object' && o.flags !== null &&
    typeof (o.stats as Record<string, unknown> | undefined)?.playSeconds === 'number' &&
    isCareer(o.career)
  );
}

function isCareer(v: unknown): boolean {
  const c = v as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return false;
  const bike = c.bike as Record<string, unknown> | undefined;
  const story = c.story as Record<string, unknown> | undefined;
  return (
    Number.isInteger(c.money) &&
    !!bike && typeof bike.brand === 'string' && typeof bike.class === 'string' && typeof bike.parts === 'object' && bike.parts !== null &&
    Object.values(bike.parts).every((p) => Number.isInteger(p?.grade) && typeof p?.condition === 'number') &&
    Array.isArray(c.bag) && c.bag.every((b) => typeof b?.id === 'string' && (b.part === undefined || isSpare(b.part))) &&
    (c.shops === undefined || isShopState(c.shops)) &&
    !!story && Number.isInteger(story.step) && Array.isArray(story.used) &&
    typeof c.counters === 'object' && c.counters !== null &&
    isSkills(c.skills)
  );
}

function isSpare(p: Record<string, unknown>): boolean {
  return typeof p.slot === 'string' && typeof p.class === 'string' && Number.isInteger(p.grade) && typeof p.condition === 'number';
}

function isShopState(v: unknown): boolean {
  const s = v as Record<string, unknown>;
  return typeof s === 'object' && s !== null && [s.seed, s.refresh, s.raceDays, s.activities].every(Number.isInteger) && Array.isArray(s.sold);
}

function isSkills(v: unknown): boolean {
  const s = v as Record<string, unknown> | undefined;
  const numbers = (r: unknown) => typeof r === 'object' && r !== null && Object.values(r).every((x) => typeof x === 'number' && x >= 0);
  return !!s && typeof s === 'object' && numbers(s.xp) && numbers(s.bonus);
}
