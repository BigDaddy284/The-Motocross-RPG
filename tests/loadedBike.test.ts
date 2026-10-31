import { describe, expect, it } from 'vitest';
import { bikeShape, standMask, withoutStand, type Rgba } from '../src/core/loadedBike';

// The bike strapped in the truck bed (Boss, 30 Oct 2026): no stand, straps from the handlebars.

const RED = [194, 28, 21, 255];
const BLUE = [59, 134, 218, 255];
const GREY = [85, 85, 94, 255];
const OUT = [39, 42, 44, 255];

/** A picture from rows of characters: . empty, b bodywork (the brand's colour), s stand red, # outline. */
function pic(rows: string[], body: number[]): Rgba {
  const width = rows[0].length;
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    const col = c === 'b' ? body : c === 's' ? RED : c === '#' ? OUT : c === 'g' ? GREY : null;
    if (col) data.set(col, (y * width + x) * 4);
  }));
  return { data, width, height: rows.length };
}

const SIDE = [
  '..##......',
  '.#bb####..',
  '#bbbbbbb#.',
  '#bbsbbbbb#',
  '##bssbbb##',
  '..#sss#...',
  '..#sss#...',
  '..#####...',
];

describe('the loaded bike (Boss, 30 Oct 2026)', () => {
  it('finds the stand only where every brand has the same red, so red bodywork stays', () => {
    const mask = standMask([pic(SIDE, BLUE), pic(SIDE, RED)])!;
    expect(mask.filter(Boolean).length).toBe(9);
    // A red brand alone can't tell its bodywork from the stand.
    expect(standMask([pic(SIDE, RED)])!.filter(Boolean).length).toBeGreaterThan(9);
  });

  it('takes the stand off below its full width and greys where its post crossed the bike', () => {
    const red = pic(SIDE, RED);
    const out = withoutStand(red, standMask([pic(SIDE, BLUE), red]));
    const px = (x: number, y: number) => [...out.data.slice((y * out.width + x) * 4, (y * out.width + x) * 4 + 4)];
    for (let y = 5; y < 8; y++) for (let x = 0; x < 10; x++) expect(px(x, y)[3]).toBe(0);
    expect(px(3, 3)).toEqual(GREY);
    expect(px(2, 2)).toEqual(RED);
    // The bike's underside gets its outline back where the stand was cut away.
    expect(px(4, 4)).toEqual(OUT);
  });

  it('leaves end-on pictures alone', () => {
    const img = pic(SIDE, BLUE);
    expect(withoutStand(img, null).data).toEqual(img.data);
  });

  it('ties a strap to each grip: far and near side on, left and right end-on', () => {
    const side = bikeShape(pic(SIDE, BLUE), true);
    expect(side.bars).toEqual([[3, 0.5], [3, 1.5]]);
    expect(side.bottom).toBe(8);
    const end = bikeShape(pic(['..#..', '#####', '.#b#.', '..#..'], BLUE), false);
    expect(end.bars).toEqual([[0.5, 1.5], [4.5, 1.5]]);
  });
});
