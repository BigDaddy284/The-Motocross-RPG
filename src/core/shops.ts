import { bikeStats, formatMoney, pence, type BikesData, type CareerState, type Part } from './career';
import type { BakedMap } from './mapTypes';
import { seededRng } from './race';
import type { ContentError, Schema } from './validate';

// Parts shops, the garage's paid repairs and fitting spares (GDD 8.3 to 8.5, Spec 7.4 and 14.4 to
// 14.6). Pure rules with no graphics. Money is in pence, prices in shops.json are in pounds.

export interface ShopDef {
  id: string;
  name: string;
  /** Shown at the top of the shop panel. */
  greeting: string;
  /** Talking to this NPC opens the shop. */
  npc: string;
  map: string;
  /** Map object actions that open the shop. The first tab opens, or Fit for the fitting bench. */
  actions: string[];
  /** The shop stays shut until this flag is set. */
  needs?: string;
  /** Parts for sale: the shop's speciality slots. */
  sells?: {
    slots: string[];
    /** Lowest and highest grade stocked (Area 1: 1 to 3, Spec 14.5a). The lowest is always in stock. */
    grades: [number, number];
    classes: string[];
    /** Chance at each stock refresh that one part of this grade is in for a slot (GDD 8.3: rarer stock rotates). */
    extraChance: Record<string, number>;
  };
  /** Paid condition repairs on the fitted parts (Spec 7.4). */
  repairs?: boolean;
  /** Pounds to fit a spare from the bag on the bench. */
  fitFee?: number;
  /** The map object that does the fitting, if it differs from the counter. */
  fitAction?: string;
}

export interface ShopsData {
  note?: string;
  /** Pounds for a new Grade 1 part of each slot on a 50cc (Spec 14.4 slotBase). */
  slotBase: Record<string, number>;
  /** Spec 14.4 classPriceFactor. */
  classPriceFactor: Record<string, number>;
  /** Each grade costs this many times the one below (Round 107, 5C). */
  gradeFactor: number;
  /** A repair costs this share of a new part at the grade it drops to (Round 125, 1C). */
  repairShare: number;
  /** Spec 14.5: price × (base + perCondition × condition) × shop factor × demand. */
  resale: { base: number; perCondition: number; otherShop: number; demand: [number, number] };
  /** Spec 14.6: stock refreshes after this many race days, or this many other activities (shift batches, practice sessions). */
  rotation: { raceDays: number; activities: number };
  /** Spare parts the rider can carry (the van holds twenty parts). */
  spareLimit: number;
  shops: ShopDef[];
}

/** A part carried as a spare, in the bag. */
export interface SparePart extends Part {
  slot: string;
  class: string;
}

/** Stock rotation and what has sold since the last refresh. Kept on the career, made on first use. */
export interface ShopState {
  seed: number;
  refresh: number;
  raceDays: number;
  activities: number;
  /** Stock keys bought since the last refresh. */
  sold: string[];
}

export interface StockItem {
  key: string;
  slot: string;
  grade: number;
  /** Pence. */
  price: number;
  /** The default grade never runs out. */
  always: boolean;
  soldOut: boolean;
}

export const SPARE = 'spare';

export function shopState(career: CareerState, rng: () => number = Math.random): ShopState {
  career.shops ??= { seed: Math.floor(rng() * 2 ** 32) >>> 0, refresh: 0, raceDays: 0, activities: 0, sold: [] };
  return career.shops;
}

/** Counts a race day or another activity towards the next stock refresh. Returns true when stock refreshed. */
export function noteActivity(data: ShopsData, career: CareerState, kind: 'raceDay' | 'activity'): boolean {
  const s = shopState(career);
  if (kind === 'raceDay') s.raceDays += 1;
  else s.activities += 1;
  if (s.raceDays < data.rotation.raceDays && s.activities < data.rotation.activities) return false;
  s.refresh += 1;
  s.raceDays = 0;
  s.activities = 0;
  s.sold = [];
  return true;
}

/** Spec 14.4: slotBase × 2^(grade − 1) × classPriceFactor, in pence. */
export function partPrice(data: ShopsData, slot: string, grade: number, cls: string): number {
  return pence((data.slotBase[slot] ?? 0) * data.gradeFactor ** (grade - 1) * (data.classPriceFactor[cls] ?? 1));
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A number from 0 to 1 that stays the same for this career, refresh and key. */
function roll(s: ShopState, key: string): number {
  return seededRng((s.seed ^ hash(`${key}#${s.refresh}`)) >>> 0)();
}

/** Whether the shop sells parts for this bike's class. */
export const sellsFor = (shop: ShopDef, cls: string) => !!shop.sells?.classes.includes(cls);

/** What is on the shelves for a class right now: the lowest grade always, higher grades as rotation brings them in. */
export function shopStock(data: ShopsData, shop: ShopDef, career: CareerState, cls: string): StockItem[] {
  const sells = shop.sells;
  if (!sells || !sellsFor(shop, cls)) return [];
  const s = shopState(career);
  const out: StockItem[] = [];
  const [lo, hi] = sells.grades;
  for (const slot of sells.slots) {
    for (let g = lo; g <= hi; g++) {
      const key = `${shop.id}:${cls}:${slot}:${g}`;
      const always = g === lo;
      if (!always && roll(s, key) >= (sells.extraChance[String(g)] ?? 0)) continue;
      out.push({ key, slot, grade: g, price: partPrice(data, slot, g, cls), always, soldOut: !always && s.sold.includes(key) });
    }
  }
  return out;
}

/** Spec 14.5 demand: 0.9 to 1.1 per shop, new at each stock refresh. */
export function demand(data: ShopsData, shop: ShopDef, career: CareerState): number {
  const [lo, hi] = data.resale.demand;
  return lo + (hi - lo) * roll(shopState(career), `${shop.id}:demand`);
}

/** Pence this shop pays for a spare, or null when it can't buy it. Broken parts can't be sold (Round 125). */
export function resaleValue(data: ShopsData, shop: ShopDef, career: CareerState, part: SparePart): number | null {
  if (!shop.sells || part.condition <= 0) return null;
  const r = data.resale;
  const factor = shop.sells.slots.includes(part.slot) ? 1 : r.otherShop;
  return Math.round(partPrice(data, part.slot, part.grade, part.class) * (r.base + r.perCondition * part.condition) * factor * demand(data, shop, career));
}

export type RepairQuote = { ok: true; grade: number; cost: number } | { ok: false; reason: string };

/** Spec 7.4: one grade lower at 100% for 70% of a new part at that grade. Grade 1 and broken parts can't be repaired. */
export function repairQuote(data: ShopsData, slot: string, part: Part, cls: string): RepairQuote {
  if (part.condition <= 0) return { ok: false, reason: 'Broken: it can only be replaced.' };
  if (part.grade <= 1) return { ok: false, reason: "Grade 1 can't be repaired. Replace it when it wears out." };
  if (part.condition >= 1) return { ok: false, reason: 'Like new: nothing to repair.' };
  const grade = part.grade - 1;
  return { ok: true, grade, cost: Math.round(partPrice(data, slot, grade, cls) * data.repairShare) };
}

export type Result = { ok: true; message: string } | { ok: false; message: string };

const spares = (career: CareerState) => career.bag.filter((b) => b.part);

export function spareCount(career: CareerState): number {
  return spares(career).length;
}

/**
 * Puts a part on the bike and deals with the old one: a broken part goes to the dump, anything
 * else into the bag as a spare. Returns what happened to the old part.
 */
function swapIn(bikes: BikesData, career: CareerState, slot: string, part: Part): string {
  const old = career.bike.parts[slot];
  career.bike.parts[slot] = { grade: part.grade, condition: part.condition };
  const name = slotName(bikes, slot);
  if (!old) return '';
  if (old.condition <= 0) return ` Your broken ${name} went to the dump.`;
  career.bag.push({ id: SPARE, part: { slot, class: career.bike.class, grade: old.grade, condition: old.condition } });
  return ` Your old G${old.grade} ${name} (${Math.round(old.condition * 100)}%) went in your bag.`;
}

export const slotName = (bikes: BikesData, slot: string) => (bikes.slots.find((s) => s.id === slot)?.name ?? slot).toLowerCase();

/** Whether there is room for one more spare after this action, which may free a bag space first. */
function roomFor(data: ShopsData, career: CareerState, slot: string | null, freed = 0): boolean {
  const old = slot ? career.bike.parts[slot] : undefined;
  const adds = slot === null ? 1 : old && old.condition > 0 ? 1 : 0;
  return spareCount(career) - freed + adds <= data.spareLimit;
}

const fullMessage = (data: ShopsData) => `Your spares are full (${data.spareLimit} parts). Sell or dump some first.`;

/** Buys a stock item, either fitted in the shop or carried away as a spare. */
export function buyPart(data: ShopsData, bikes: BikesData, career: CareerState, item: StockItem, fit: boolean): Result {
  if (item.soldOut) return { ok: false, message: 'Sold out until the stock changes.' };
  if (career.money < item.price) return { ok: false, message: "You can't afford it." };
  if (!roomFor(data, career, fit ? item.slot : null)) return { ok: false, message: fullMessage(data) };
  career.money -= item.price;
  if (!item.always) shopState(career).sold.push(item.key);
  const name = `G${item.grade} ${slotName(bikes, item.slot)}`;
  if (!fit) {
    career.bag.push({ id: SPARE, part: { slot: item.slot, class: career.bike.class, grade: item.grade, condition: 1 } });
    return { ok: true, message: `Bought a new ${name}. It's in your bag.` };
  }
  return { ok: true, message: `New ${name} fitted.${swapIn(bikes, career, item.slot, { grade: item.grade, condition: 1 })}` };
}

/** Sells a spare from the bag, by its bag index. */
export function sellSpare(data: ShopsData, shop: ShopDef, career: CareerState, index: number): Result {
  const part = career.bag[index]?.part;
  if (!part) return { ok: false, message: 'Nothing to sell.' };
  const value = resaleValue(data, shop, career, part);
  if (value === null) return { ok: false, message: "This shop can't buy that." };
  career.bag.splice(index, 1);
  career.money += value;
  return { ok: true, message: `Sold for ${formatMoney(value)}.` };
}

/** Sends a spare to the dump: deleted, no resale (Spec 7.2). */
export function dumpSpare(career: CareerState, index: number): boolean {
  if (!career.bag[index]?.part) return false;
  career.bag.splice(index, 1);
  return true;
}

/** Repairs a fitted part at the garage. */
export function repairPart(data: ShopsData, bikes: BikesData, career: CareerState, slot: string): Result {
  const part = career.bike.parts[slot];
  if (!part) return { ok: false, message: 'Nothing fitted there.' };
  const q = repairQuote(data, slot, part, career.bike.class);
  if (!q.ok) return { ok: false, message: q.reason };
  if (career.money < q.cost) return { ok: false, message: "You can't afford it." };
  career.money -= q.cost;
  career.bike.parts[slot] = { grade: q.grade, condition: 1 };
  return { ok: true, message: `Your ${slotName(bikes, slot)} is repaired: G${q.grade} at 100%.` };
}

/** Fits a spare from the bag on the bench, for the bench fee. */
export function fitSpare(data: ShopsData, bikes: BikesData, shop: ShopDef, career: CareerState, index: number): Result {
  const part = career.bag[index]?.part;
  if (!part) return { ok: false, message: 'Nothing to fit.' };
  if (part.class !== career.bike.class) return { ok: false, message: `That part is for a ${part.class}.` };
  const fee = pence(shop.fitFee ?? 0);
  if (career.money < fee) return { ok: false, message: "You can't afford the bench fee." };
  if (!roomFor(data, career, part.slot, 1)) return { ok: false, message: fullMessage(data) };
  career.money -= fee;
  career.bag.splice(index, 1);
  return { ok: true, message: `G${part.grade} ${slotName(bikes, part.slot)} fitted.${swapIn(bikes, career, part.slot, part)}` };
}

/** How each bike stat would change with this part fitted, for the stats that change. */
export function statChange(bikes: BikesData, career: CareerState, slot: string, part: Part): { name: string; from: number; to: number }[] {
  const before = bikeStats(bikes, career.bike);
  const after = bikeStats(bikes, { ...career.bike, parts: { ...career.bike.parts, [slot]: part } });
  return bikes.stats.filter((s) => before[s.id] !== after[s.id]).map((s) => ({ name: s.name, from: before[s.id], to: after[s.id] }));
}

/** The shop that a map object's action opens, and the tab it opens on. */
export function shopForAction(data: ShopsData, map: string, action: string): { shop: ShopDef; fit: boolean } | null {
  const shop = data.shops.find((s) => s.map === map && (s.actions.includes(action) || s.fitAction === action));
  return shop ? { shop, fit: shop.fitAction === action } : null;
}

// ---- content checks ----

const ID = /^[a-z0-9_.-]+$/;
const IDS = { type: 'string', pattern: ID } as const;
const S = { type: 'string', nonEmpty: true } as const;
const N0 = { type: 'number', min: 0 } as const;
const GRADE = { type: 'number', integer: true, min: 1, max: 10 } as const;

export const SHOPS_SCHEMA: Schema = {
  type: 'object',
  optional: ['note'],
  fields: {
    note: { type: 'string' },
    slotBase: { type: 'record', values: N0 },
    classPriceFactor: { type: 'record', values: N0 },
    gradeFactor: { type: 'number', min: 1 },
    repairShare: { type: 'number', min: 0, max: 1 },
    resale: {
      type: 'object',
      fields: { base: N0, perCondition: N0, otherShop: { type: 'number', min: 0, max: 1 }, demand: { type: 'array', items: N0, minItems: 2, maxItems: 2 } },
    },
    rotation: { type: 'object', fields: { raceDays: { type: 'number', integer: true, min: 1 }, activities: { type: 'number', integer: true, min: 1 } } },
    spareLimit: { type: 'number', integer: true, min: 1 },
    shops: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        optional: ['needs', 'sells', 'repairs', 'fitFee', 'fitAction'],
        fields: {
          id: IDS,
          name: S,
          greeting: S,
          npc: IDS,
          map: IDS,
          actions: { type: 'array', items: IDS },
          needs: IDS,
          sells: {
            type: 'object',
            fields: {
              slots: { type: 'array', minItems: 1, items: IDS },
              grades: { type: 'array', items: GRADE, minItems: 2, maxItems: 2 },
              classes: { type: 'array', minItems: 1, items: IDS },
              extraChance: { type: 'record', values: { type: 'number', min: 0, max: 1 } },
            },
          },
          repairs: { type: 'boolean' },
          fitFee: N0,
          fitAction: IDS,
        },
      },
    },
  },
};

/** Cross-checks shops.json against the bikes, NPCs and maps. */
export function checkShopContent(file: string, data: ShopsData, bikes: BikesData, npcIds: Set<string>, maps: Map<string, BakedMap>): ContentError[] {
  const errors: ContentError[] = [];
  const err = (field: string, message: string) => errors.push({ file, field, message });
  const slotIds = new Set(bikes.slots.map((s) => s.id));
  for (const s of bikes.slots) if (data.slotBase[s.id] === undefined) err('slotBase', `no price for slot "${s.id}"`);
  for (const k of Object.keys(data.slotBase)) if (!slotIds.has(k)) err(`slotBase.${k}`, `no slot "${k}"`);
  for (const c of bikes.classes) if (data.classPriceFactor[c.id] === undefined) err('classPriceFactor', `no factor for class "${c.id}"`);
  if (data.resale.demand[0] > data.resale.demand[1]) err('resale.demand', 'the lowest demand is above the highest');
  const seen = new Set<string>();
  data.shops.forEach((s, i) => {
    const at = (f: string) => `shops[${i}].${f}`;
    if (seen.has(s.id)) err(at('id'), `"${s.id}" is used twice`);
    seen.add(s.id);
    if (!npcIds.has(s.npc)) err(at('npc'), `no NPC "${s.npc}"`);
    const m = maps.get(s.map);
    if (!m) err(at('map'), `no map "${s.map}"`);
    const hasAction = (a: string) => m?.objects.some((o) => o.props.action === a);
    s.actions.forEach((a, j) => m && !hasAction(a) && err(at(`actions[${j}]`), `no object with action "${a}" on ${s.map}`));
    if (s.fitAction && m && !hasAction(s.fitAction)) err(at('fitAction'), `no object with action "${s.fitAction}" on ${s.map}`);
    if (!s.sells && !s.repairs && s.fitFee === undefined) err(at('sells'), 'the shop neither sells, repairs nor fits anything');
    if (s.sells) {
      s.sells.slots.forEach((sl, j) => !slotIds.has(sl) && err(at(`sells.slots[${j}]`), `no slot "${sl}"`));
      if (s.sells.grades[0] > s.sells.grades[1]) err(at('sells.grades'), 'the lowest grade is above the highest');
    }
  });
  return errors;
}
