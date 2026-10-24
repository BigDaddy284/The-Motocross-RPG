// The rider's career state beyond where they stand: money, the bike, the bag, the opening chain
// and shift work. Pure rules with no graphics, so they can be tested and reused by a later
// standalone economy tool (GDD 2.2).

import type { ShopState, SparePart } from './shops';
import { newSkillState, type SkillState } from './skills';

export interface StatDef {
  id: string;
  name: string;
}

export interface SlotDef {
  id: string;
  name: string;
  /** How much of each bike stat this slot supplies. Each stat's weights add up to 1 across slots. */
  weights: Record<string, number>;
  engine?: boolean;
}

export interface BrandDef {
  id: string;
  name: string;
  starter: string;
  character: string;
  /** Stat multipliers for the brand's frame character. They add up to the number of stats, so no brand is best. */
  lean: Record<string, number>;
}

export interface BikesData {
  stats: StatDef[];
  slots: SlotDef[];
  classes: { id: string; name: string; ceiling: number }[];
  starter: { class: string; grade: number; condition: [number, number]; brokenSlot: string };
  brands: BrandDef[];
}

export interface ItemDef {
  name: string;
  desc: string;
  part?: { slot: string; grade: number; condition: number };
}

export interface StoryEffects {
  /** Pounds, positive or negative. */
  money?: number;
  give?: string[];
  take?: string[];
  /** Fits a part item from the bag into its bike slot. */
  fit?: string;
  flags?: string[];
}

export interface StoryStep {
  id: string;
  journal: string;
  on: { talk?: string; use?: string; map?: string };
  /** Uses of different objects needed before the step completes (default 1). */
  times?: number;
  needs?: { money?: number; items?: string[] };
  /** Lines shown when the needs are not met. */
  notReady?: string;
  confirm?: string;
  lines?: string;
  effects?: StoryEffects;
  toast?: string;
}

export interface StoryData {
  startMoney: number;
  intro: string;
  steps: StoryStep[];
  done: string;
  /** Task lines once the opening chain is over: the first whose if is set, or whose unless is not. */
  after?: { if?: string; unless?: string; text: string }[];
}

export interface JobDef {
  id: string;
  name: string;
  map: string;
  /** Object that starts a shift. */
  start: string;
  product: string;
  batch: number;
  /** Pounds per part. */
  pay: number;
  needs?: string;
  stations: { object: string; label: string; ms: number }[];
}

export interface WorldData {
  /** Testing only: multiplies all shift pay. Review before Final v1. */
  testPayMultiplier?: number;
  locks: { map: string; object: string; flag: string; message: string }[];
  worldMap: { map: string; spawn: string; name: string; note: string }[];
  jobs: JobDef[];
}

export interface Part {
  grade: number;
  /** 0 to 1. A part at 0 is broken. */
  condition: number;
}

export interface Bike {
  brand: string;
  class: string;
  parts: Record<string, Part>;
}

export interface BagItem {
  id: string;
  /** A spare bike part, with its own grade and condition (id "spare"). */
  part?: SparePart;
}

export interface CareerState {
  /** Money in pence, so shift pay like 75p stays exact. */
  money: number;
  bike: Bike;
  bag: BagItem[];
  /** Index of the current opening-chain step, and the objects already used for a multi-use step. */
  story: { step: number; used: string[] };
  /** Running totals such as batches finished per employer, race days and wins. */
  counters: Record<string, number>;
  skills: SkillState;
  /** Shop stock rotation, made on the first shop visit. */
  shops?: ShopState;
}

export const pence = (pounds: number) => Math.round(pounds * 100);

/** A shift job's pay per part in pence, after the testing multiplier. */
export const jobPay = (world: WorldData, job: JobDef) => pence(job.pay * (world.testPayMultiplier ?? 1));

export function formatMoney(p: number): string {
  const sign = p < 0 ? '−' : '';
  const a = Math.abs(p);
  return a % 100 === 0 ? `${sign}£${a / 100}` : `${sign}£${(a / 100).toFixed(2)}`;
}

/** A new starter bike: the starter grade everywhere, random 50–80% condition, and one broken part (GDD 4.1). */
export function starterBike(bikes: BikesData, brand: string, rng: () => number = Math.random): Bike {
  const s = bikes.starter;
  const [lo, hi] = s.condition;
  const parts: Record<string, Part> = {};
  for (const slot of bikes.slots) {
    const c = slot.id === s.brokenSlot ? 0 : lo + rng() * (hi - lo);
    parts[slot.id] = { grade: s.grade, condition: Math.round(c * 100) / 100 };
  }
  return { brand, class: s.class, parts };
}

export function newCareerState(bikes: BikesData, story: StoryData, brand: string, rng?: () => number): CareerState {
  return { money: pence(story.startMoney), bike: starterBike(bikes, brand, rng), bag: [], story: { step: 0, used: [] }, counters: {}, skills: newSkillState() };
}

/** Spec 7.1 and 7.2: 0.80 + 0.20 × condition, and a broken part keeps only 10%. */
export function conditionFactor(c: number): number {
  return c <= 0 ? 0.1 : 0.8 + 0.2 * c;
}

/** Spec 5.3 grade curve for one slot's share of a stat. */
export function partStat(ceiling: number, weight: number, part: Part): number {
  return ceiling * weight * 0.36 * 1.12 ** (part.grade - 1) * conditionFactor(part.condition);
}

/** The bike's six stats, rounded. Brand lean shapes them without changing the total. */
export function bikeStats(bikes: BikesData, bike: Bike): Record<string, number> {
  const ceiling = bikes.classes.find((c) => c.id === bike.class)?.ceiling ?? 0;
  const lean = bikes.brands.find((b) => b.id === bike.brand)?.lean ?? {};
  const out: Record<string, number> = {};
  for (const st of bikes.stats) {
    let v = 0;
    for (const slot of bikes.slots) {
      const w = slot.weights[st.id];
      const part = bike.parts[slot.id];
      if (w && part) v += partStat(ceiling, w, part);
    }
    out[st.id] = Math.round(v * (lean[st.id] ?? 1));
  }
  return out;
}

/** The best a bike of this class can reach on one stat (Grade 10, new, strongest lean), for scaling bars. */
export function statMax(bikes: BikesData, cls: string): number {
  const ceiling = bikes.classes.find((c) => c.id === cls)?.ceiling ?? 0;
  const lean = Math.max(...bikes.brands.flatMap((b) => Object.values(b.lean)));
  return ceiling * 0.36 * 1.12 ** 9 * lean;
}

/** Why the bike can't be ridden, or null when it runs. */
export function bikeProblem(bikes: BikesData, bike: Bike): string | null {
  const broken = bikes.slots.filter((s) => s.engine && bike.parts[s.id]?.condition <= 0);
  return broken.length ? `Won't start: the ${broken[0].name.toLowerCase()} is broken.` : null;
}

export const hasItems = (state: CareerState, ids: string[] = []) => {
  const left = state.bag.map((b) => b.id);
  return ids.every((id) => {
    const i = left.indexOf(id);
    if (i < 0) return false;
    left.splice(i, 1);
    return true;
  });
};

/** Applies a step's effects. Flags live on the save itself, so they are passed in to be set. */
export function applyEffects(state: CareerState, flags: Record<string, boolean>, items: Record<string, ItemDef>, e: StoryEffects = {}): void {
  if (e.money) state.money += pence(e.money);
  for (const id of e.take ?? []) {
    const i = state.bag.findIndex((b) => b.id === id);
    if (i >= 0) state.bag.splice(i, 1);
  }
  for (const id of e.give ?? []) state.bag.push({ id });
  if (e.fit) {
    const i = state.bag.findIndex((b) => b.id === e.fit);
    const part = items[e.fit]?.part;
    if (i >= 0 && part) {
      state.bag.splice(i, 1);
      state.bike.parts[part.slot] = { grade: part.grade, condition: part.condition };
    }
  }
  for (const f of e.flags ?? []) flags[f] = true;
}

// ---- the opening chain ----

export type StoryEvent = { talk: string } | { use: string; map: string; object: string };

export type StoryMatch =
  | { kind: 'ready'; step: StoryStep }
  | { kind: 'notReady'; step: StoryStep; short: number }
  | { kind: 'alreadyUsed'; step: StoryStep };

export function currentStep(story: StoryData, state: CareerState): StoryStep | null {
  return story.steps[state.story.step] ?? null;
}

/** Whether a talk or object use is the current step, and whether the rider can do it yet. */
export function matchStory(story: StoryData, state: CareerState, ev: StoryEvent): StoryMatch | null {
  const step = currentStep(story, state);
  if (!step) return null;
  if ('talk' in ev) {
    if (step.on.talk !== ev.talk) return null;
  } else {
    if (step.on.use !== ev.use || (step.on.map && step.on.map !== ev.map)) return null;
    if (state.story.used.includes(ev.object)) return { kind: 'alreadyUsed', step };
  }
  const needMoney = pence(step.needs?.money ?? 0);
  if (state.money < needMoney || !hasItems(state, step.needs?.items)) return { kind: 'notReady', step, short: Math.max(0, needMoney - state.money) };
  return { kind: 'ready', step };
}

/** Records one use of the current step. Returns true when the step finished and its effects applied. */
export function advanceStory(story: StoryData, state: CareerState, flags: Record<string, boolean>, items: Record<string, ItemDef>, object?: string): boolean {
  const step = currentStep(story, state);
  if (!step) return false;
  if (object) state.story.used.push(object);
  if (state.story.used.length < (step.times ?? 1) && object) return false;
  applyEffects(state, flags, items, step.effects);
  state.story = { step: state.story.step + 1, used: [] };
  return true;
}

/** The task line for the journal. */
export function journal(story: StoryData, state: CareerState, flags: Record<string, boolean> = {}): string {
  const step = currentStep(story, state);
  if (!step) return story.after?.find((a) => (a.if === undefined || flags[a.if]) && (a.unless === undefined || !flags[a.unless]))?.text ?? story.done;
  const n = step.times ?? 1;
  return n > 1 ? `${step.journal} (${state.story.used.length} of ${n})` : step.journal;
}

export function fillText(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}
