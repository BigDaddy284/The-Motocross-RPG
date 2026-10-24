import { describe, expect, it } from 'vitest';
import { newCareerState, type CareerState } from '../src/core/career';
import { checkContent } from '../src/core/content';
import { parseSave } from '../src/core/saves';
import {
  SPARE,
  buyPart,
  dumpSpare,
  fitSpare,
  noteActivity,
  partPrice,
  repairPart,
  repairQuote,
  resaleValue,
  sellSpare,
  shopForAction,
  shopStock,
  shopState,
  spareCount,
  type ShopDef,
} from '../src/core/shops';
import { formatError } from '../src/core/validate';
import { loadManifest, loadMaps, rawContent } from './helpers';

const maps = loadMaps();
const content = checkContent(rawContent(), loadManifest(), maps).content!;
const { bikes, story, shops } = content;
const shop = (id: string) => shops.shops.find((s) => s.id === id) as ShopDef;
const bikeShop = shop('shop.bike');
const tyreShop = shop('shop.tyres');
const garage = shop('garage');

function career(money = 100000): CareerState {
  const c = newCareerState(bikes, story, 'hondmoto', () => 0.5);
  c.money = money;
  shopState(c, () => 0.25);
  return c;
}

describe('prices and repairs', () => {
  it('price parts by slot, grade and class (Spec 14.4)', () => {
    expect(partPrice(shops, 'top_end', 1, '50cc')).toBe(3500);
    expect(partPrice(shops, 'top_end', 3, '50cc')).toBe(14000);
    expect(partPrice(shops, 'forks', 2, '65cc')).toBe(28800);
  });

  it('repair one grade down at 70% of a new part at that grade (Spec 7.4)', () => {
    expect(repairQuote(shops, 'forks', { grade: 3, condition: 0.34 }, '50cc')).toEqual({ ok: true, grade: 2, cost: 16800 });
    expect(repairQuote(shops, 'forks', { grade: 1, condition: 0.34 }, '50cc').ok).toBe(false);
    expect(repairQuote(shops, 'forks', { grade: 4, condition: 0 }, '50cc').ok).toBe(false);
    const c = career();
    c.bike.parts.forks = { grade: 3, condition: 0.34 };
    expect(repairPart(shops, bikes, c, 'forks').ok).toBe(true);
    expect(c.bike.parts.forks).toEqual({ grade: 2, condition: 1 });
    expect(c.money).toBe(100000 - 16800);
  });
});

describe('shop stock', () => {
  it('always has the lowest grade of every speciality slot, and nothing for other classes', () => {
    const stock = shopStock(shops, bikeShop, career(), '50cc');
    for (const slot of bikeShop.sells!.slots) expect(stock.some((s) => s.slot === slot && s.grade === 1 && s.always)).toBe(true);
    expect(stock.every((s) => s.grade <= 3)).toBe(true);
    expect(shopStock(shops, bikeShop, career(), '450f')).toEqual([]);
  });

  it('stays the same until it refreshes after 3 race days or 10 activities (Spec 14.6)', () => {
    const c = career();
    const keys = () => shopStock(shops, bikeShop, c, '50cc').map((s) => s.key);
    const first = keys();
    expect(keys()).toEqual(first);
    expect(noteActivity(shops, c, 'raceDay')).toBe(false);
    expect(noteActivity(shops, c, 'raceDay')).toBe(false);
    expect(noteActivity(shops, c, 'raceDay')).toBe(true);
    expect(c.shops!.refresh).toBe(1);
    for (let i = 0; i < 9; i++) expect(noteActivity(shops, c, 'activity')).toBe(false);
    expect(noteActivity(shops, c, 'activity')).toBe(true);
    // Over many refreshes, higher grades come and go.
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      for (const s of shopStock(shops, bikeShop, c, '50cc')) seen.add(s.grade);
      for (let k = 0; k < 3; k++) noteActivity(shops, c, 'raceDay');
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('a higher-grade part sells out until the next refresh; Grade 1 never does', () => {
    const c = career();
    let extra = shopStock(shops, bikeShop, c, '50cc').find((s) => !s.always);
    for (let i = 0; !extra && i < 50; i++) {
      for (let k = 0; k < 3; k++) noteActivity(shops, c, 'raceDay');
      extra = shopStock(shops, bikeShop, c, '50cc').find((s) => !s.always);
    }
    expect(buyPart(shops, bikes, c, extra!, false).ok).toBe(true);
    const again = shopStock(shops, bikeShop, c, '50cc').find((s) => s.key === extra!.key)!;
    expect(again.soldOut).toBe(true);
    expect(buyPart(shops, bikes, c, again, false).ok).toBe(false);
    const g1 = shopStock(shops, bikeShop, c, '50cc').find((s) => s.always)!;
    expect(buyPart(shops, bikes, c, g1, false).ok).toBe(true);
    expect(buyPart(shops, bikes, c, g1, false).ok).toBe(true);
    for (let k = 0; k < 3; k++) noteActivity(shops, c, 'raceDay');
    expect(c.shops!.sold).toEqual([]);
  });
});

describe('buying, fitting and selling', () => {
  const tyres = (c: CareerState) => shopStock(shops, tyreShop, c, '50cc').find((s) => s.slot === 'wheels_tyres' && s.grade === 1)!;

  it('buy and fit puts the old part in the bag, and sends a broken one to the dump', () => {
    const c = career();
    c.bike.parts.wheels_tyres = { grade: 1, condition: 0.18 };
    const r = buyPart(shops, bikes, c, tyres(c), true);
    expect(r.ok).toBe(true);
    expect(c.money).toBe(100000 - 2500);
    expect(c.bike.parts.wheels_tyres).toEqual({ grade: 1, condition: 1 });
    expect(c.bag).toEqual([{ id: SPARE, part: { slot: 'wheels_tyres', class: '50cc', grade: 1, condition: 0.18 } }]);

    c.bike.parts.wheels_tyres.condition = 0;
    expect(buyPart(shops, bikes, c, tyres(c), true).message).toMatch(/dump/);
    expect(spareCount(c)).toBe(1);
  });

  it("can't buy what you can't afford", () => {
    const c = career(1000);
    expect(buyPart(shops, bikes, c, tyres(c), true)).toEqual({ ok: false, message: "You can't afford it." });
    expect(c.money).toBe(1000);
  });

  it('pays full resale at a specialist and half elsewhere, and never for broken parts (Spec 14.5)', () => {
    const c = career();
    const part = { slot: 'wheels_tyres', class: '50cc', grade: 2, condition: 0.5 };
    const tyreValue = resaleValue(shops, tyreShop, c, part)!;
    const base = 5000 * (0.2 + 0.4 * 0.5);
    expect(tyreValue).toBeGreaterThanOrEqual(Math.round(base * 0.9));
    expect(tyreValue).toBeLessThanOrEqual(Math.round(base * 1.1));
    const bikeShopValue = resaleValue(shops, bikeShop, c, part)!;
    expect(bikeShopValue).toBeLessThan(tyreValue);
    expect(resaleValue(shops, tyreShop, c, { ...part, condition: 0 })).toBeNull();
    expect(resaleValue(shops, garage, c, part)).toBeNull();

    c.bag.push({ id: SPARE, part });
    expect(sellSpare(shops, tyreShop, c, 0).ok).toBe(true);
    expect(c.money).toBe(100000 + tyreValue);
    expect(c.bag).toEqual([]);
  });

  it('the garage fits a spare for the bench fee and swaps the old part into the bag', () => {
    const c = career();
    const before = c.bike.parts.forks;
    c.bag.push({ id: 'task.parts_order' }, { id: SPARE, part: { slot: 'forks', class: '50cc', grade: 2, condition: 1 } });
    expect(fitSpare(shops, bikes, garage, c, 1).ok).toBe(true);
    expect(c.money).toBe(100000 - 500);
    expect(c.bike.parts.forks).toEqual({ grade: 2, condition: 1 });
    expect(c.bag).toEqual([{ id: 'task.parts_order' }, { id: SPARE, part: { slot: 'forks', class: '50cc', ...before } }]);
    expect(dumpSpare(c, 0)).toBe(false);
    expect(dumpSpare(c, 1)).toBe(true);
    expect(c.bag).toEqual([{ id: 'task.parts_order' }]);
  });

  it(`holds at most ${shops.spareLimit} spares`, () => {
    const c = career();
    for (let i = 0; i < shops.spareLimit; i++) c.bag.push({ id: SPARE, part: { slot: 'brakes', class: '50cc', grade: 1, condition: 0.5 } });
    expect(buyPart(shops, bikes, c, tyres(c), false).ok).toBe(false);
    expect(buyPart(shops, bikes, c, tyres(c), true).ok).toBe(false);
    c.bike.parts.wheels_tyres.condition = 0;
    expect(buyPart(shops, bikes, c, tyres(c), true).ok).toBe(true);
  });
});

describe('shops on the maps', () => {
  it('each shop counter and the garage bench open the right shop', () => {
    expect(shopForAction(shops, 'int-home-bike-shop', 'shop.bike_parts')?.shop.id).toBe('shop.bike');
    expect(shopForAction(shops, 'int-home-tyre-shop', 'shop.tyres_wheels')?.shop.id).toBe('shop.tyres');
    expect(shopForAction(shops, 'int-home-local-garage', 'service.paid_repair')).toMatchObject({ shop: { id: 'garage' }, fit: false });
    expect(shopForAction(shops, 'int-home-local-garage', 'workshop.fit_tune')).toMatchObject({ shop: { id: 'garage' }, fit: true });
  });

  it('a broken shops file names the field', () => {
    const r = rawContent() as ReturnType<typeof rawContent> & { shops: { shops: Record<string, unknown>[] } };
    (r.shops.shops[0].sells as { slots: string[] }).slots.push('jetpack');
    r.shops.shops[1].map = 'int-home-nowhere';
    const { errors } = checkContent(r, loadManifest(), maps);
    expect(errors.map(formatError)).toEqual([
      'data/shops.json: shops[0].sells.slots[7]: no slot "jetpack"',
      'data/shops.json: shops[1].map: no map "int-home-nowhere"',
    ]);
  });

  it('a save with spares and shop stock loads', () => {
    const c = career();
    c.bag.push({ id: SPARE, part: { slot: 'forks', class: '50cc', grade: 2, condition: 0.5 } });
    const save = { version: 3, savedAt: 'now', rider: { name: 'R', look: 'x' }, position: { map: 'm', x: 1, y: 1, facing: 'down' }, flags: {}, stats: { playSeconds: 0 }, career: c };
    expect(parseSave(JSON.stringify(save))?.career.shops?.seed).toBe(c.shops!.seed);
    expect(parseSave(JSON.stringify({ ...save, career: { ...c, bag: [{ id: SPARE, part: { slot: 'forks' } }] } }))).toBeNull();
  });
});
