// The bike strapped in a truck bed (Boss, 30 Oct 2026: "remove the red stand from under the bike
// in all angles and have black straps to the bed of the truck either side behind the driver's
// cab"). The bike pictures are the area map's bikes on their paddock stands, so the stand is taken
// off here, from the pixels, and the handlebar ends are found for the tie-down straps. Pure pixel
// work on RGBA arrays, so it is tested without Phaser; VanView turns the results into textures.

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** The stand's reds: its paint, highlight and shadow. */
const STAND_RED = (r: number, g: number, b: number) => (r > 150 && g < 70 && b < 70) || (r === 100 && g === 32 && b === 31);
/** The bike's outline and the engine grey that fills where the stand's post crossed the bike. */
const OUTLINE: [number, number, number] = [39, 42, 44];
const ENGINE: [number, number, number] = [85, 85, 94];
/** The handlebar side on is narrower than this; the bike below it is wider. */
const BAR_WIDTH = 7;
/** How wide the stand's outline is on each side of its paint. */
const EDGE = 2;

const at = (img: Rgba, x: number, y: number) => (y * img.width + x) * 4;

/**
 * The stand's pixels in a side-on picture: the stand red found at the same place in the same
 * colour in every brand's picture (a red brand's bodywork differs between brands, the stand
 * doesn't). Null when the pictures have no stand there, such as end-on, where the bike hides it.
 */
export function standMask(brands: Rgba[]): boolean[] | null {
  const [first] = brands;
  if (!first) return null;
  const n = first.width * first.height;
  const mask = new Array<boolean>(n).fill(false);
  let any = false;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const d = first.data;
    if (!d[p + 3] || !STAND_RED(d[p], d[p + 1], d[p + 2])) continue;
    if (brands.every((b) => b.data[p] === d[p] && b.data[p + 1] === d[p + 1] && b.data[p + 2] === d[p + 2] && b.data[p + 3] === d[p + 3])) {
      mask[i] = true;
      any = true;
    }
  }
  return any ? mask : null;
}

/**
 * The picture with the stand taken off. Below the first row where the stand is at its full width,
 * its columns (outline and all) are cleared; above that, where its post crosses the bike, the
 * stand red becomes engine grey. Columns left open underneath get the bike's outline back.
 */
export function withoutStand(img: Rgba, mask: boolean[] | null): Rgba {
  const out: Rgba = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  if (!mask) return out;
  const { width, height } = img;
  let x0 = width;
  let x1 = -1;
  const rowCount = new Array<number>(height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      rowCount[y]++;
    }
  }
  if (x1 < 0) return out;
  const full = Math.max(...rowCount);
  const cut = rowCount.findIndex((c) => c === full);
  const c0 = Math.max(0, x0 - EDGE);
  const c1 = Math.min(width - 1, x1 + EDGE);
  for (let y = 0; y < cut; y++) {
    for (let x = x0; x <= x1; x++) if (mask[y * width + x]) out.data.set(ENGINE, at(out, x, y));
  }
  for (let x = c0; x <= c1; x++) {
    let cleared = false;
    for (let y = cut; y < height; y++) {
      const p = at(out, x, y);
      if (out.data[p + 3]) cleared = true;
      out.data[p + 3] = 0;
    }
    if (!cleared) continue;
    for (let y = cut - 1; y >= 0; y--) {
      const p = at(out, x, y);
      if (!out.data[p + 3]) continue;
      out.data.set(OUTLINE, p);
      break;
    }
  }
  return out;
}

export interface BikeShape {
  /** The middle of the drawn pixels. */
  middle: [number, number];
  /** The bottom of the drawn pixels: where the wheels stand. */
  bottom: number;
  /** The handlebar's two grips, where the straps are tied: far and near side on, left and right end-on. */
  bars: [number, number][];
}

/**
 * Where the bike is in its picture. Side on, the handlebar is the narrow upright at the top; end-on
 * it is the widest row. Its two grips are where the straps go.
 */
export function bikeShape(img: Rgba, sideOn: boolean, barSpan?: number): BikeShape {
  const { width, height, data } = img;
  let [x0, y0, x1, y1] = [width, height, -1, -1];
  const rows: { left: number; right: number }[] = [];
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (!data[at(img, x, y) + 3]) continue;
      if (left < 0) left = x;
      right = x;
    }
    rows.push({ left, right });
    if (left < 0) continue;
    x0 = Math.min(x0, left);
    x1 = Math.max(x1, right);
    y0 = Math.min(y0, y);
    y1 = y;
  }
  if (x1 < 0) return { middle: [width / 2, height / 2], bottom: height, bars: [[width / 2, height / 2]] };
  const middle: [number, number] = [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
  if (sideOn) {
    // Side on, the handlebar runs up the picture from the top: its top is the far grip. The near
    // grip is barSpan below it (the bars' width seen from above, squashed as the bed is), or else
    // the last row before the bike widens out (Boss, 30 Oct 2026: a strap from each grip).
    const top = rows[y0];
    const x = (top.left + top.right + 1) / 2;
    let near = y0;
    while (near + 1 <= y1 && rows[near + 1].left >= 0 && rows[near + 1].right - rows[near + 1].left < BAR_WIDTH) near++;
    return { middle, bottom: y1 + 1, bars: [[x, y0 + 0.5], [x, barSpan === undefined ? near + 0.5 : y0 + 0.5 + barSpan]] };
  }
  const widest = Math.max(...rows.map((r) => (r.left < 0 ? 0 : r.right - r.left)));
  const at0 = rows.findIndex((r) => r.left >= 0 && r.right - r.left === widest);
  const r = rows[at0];
  return { middle, bottom: y1 + 1, bars: [[r.left + 0.5, at0 + 0.5], [r.right + 0.5, at0 + 0.5]] };
}
