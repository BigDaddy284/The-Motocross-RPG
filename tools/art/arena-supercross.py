"""Draws the Supercross Arena: the indoor arena that fills the top of the Supercross venue map, the
default venue for every supercross event (Boss, 30 Oct 2026).

A big corrugated-steel hall seen top-down three-quarter like the other buildings: a curved roof
with skylights and vents, a blue clad front with high windows and supercross posters, the
"SUPERCROSS ARENA" sign and a glass entrance with double doors under a canopy. Drawn at half size
and doubled, for the style guide's 2 px pixel clusters, with every colour snapped to the
reference palette (art/palette/palette-ref-v1.hex). 28 x 12 tiles; the double doors are tiles 12
and 13 of the bottom row, where the map's venue trigger is.

    python3 tools/art/arena-supercross.py <palette.hex> <out.png> [preview.png] [--sign=TEXT] [--poster=WORD]

--sign and --poster change the wording, for the EnduroCross arena drawn from this one (Boss, 30 Oct
2026: "the same as Supercross but with updated signage"):

    python3 tools/art/arena-supercross.py <palette.hex> endurocross-arena.png --sign="ENDUROCROSS ARENA" --poster=ENDUROCROSS
"""
import sys
from pathlib import Path

from PIL import Image

TILE = 32  # a 64 px tile at half size
W, H = 28 * TILE, 12 * TILE
DOOR_X = 12 * TILE  # the double doors: tiles 12 and 13
ROOF_BOTTOM = 7 * TILE + 16  # where the roof meets the front wall
SIGN = 'SUPERCROSS ARENA'
POSTER = 'SUPERCROSS'

FONT = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
    'C': ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'],
}


def load_palette(path):
    return [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in Path(path).read_text().split()]


class Canvas:
    def __init__(self, pal):
        self.pal = pal
        self.img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        self.px = self.img.load()
        self.cache = {}

    def c(self, rgb):
        if rgb not in self.cache:
            self.cache[rgb] = min(self.pal, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, rgb))) + (255,)
        return self.cache[rgb]

    def put(self, x, y, rgb):
        if 0 <= x < W and 0 <= y < H:
            self.px[x, y] = self.c(rgb)

    def rect(self, x0, y0, x1, y1, rgb):
        for y in range(max(0, y0), min(H, y1)):
            for x in range(max(0, x0), min(W, x1)):
                self.px[x, y] = self.c(rgb)

    def frame(self, x0, y0, x1, y1, rgb):
        self.rect(x0, y0, x1, y0 + 1, rgb)
        self.rect(x0, y1 - 1, x1, y1, rgb)
        self.rect(x0, y0, x0 + 1, y1, rgb)
        self.rect(x1 - 1, y0, x1, y1, rgb)

    def text(self, s, x, y, rgb, scale=1, shadow=None):
        for ch in s:
            g = FONT[ch]
            for gy, row in enumerate(g):
                for gx, on in enumerate(row):
                    if on == '#':
                        if shadow:
                            self.rect(x + gx * scale + 1, y + gy * scale + 1, x + (gx + 1) * scale + 1, y + (gy + 1) * scale + 1, shadow)
                        self.rect(x + gx * scale, y + gy * scale, x + (gx + 1) * scale, y + (gy + 1) * scale, rgb)
            x += (len(g[0]) + 1) * scale


def text_width(s, scale):
    return sum((len(FONT[ch][0]) + 1) * scale for ch in s) - scale


OUTLINE = (0x27, 0x29, 0x2C)


def roof(cv):
    # A curved roof seen from above: darker at the back, a light crown, mid on the front slope.
    for y in range(0, ROOF_BOTTOM):
        t = y / ROOF_BOTTOM
        crown = 1 - abs(t - 0.42) / 0.58
        base = 92 + int(48 * crown)
        for x in range(W):
            rib = x % 6
            shade = base + (14 if rib == 0 else -10 if rib == 3 else 0)
            cv.put(x, y, (shade - 10, shade, shade + 14))
    # Seams between roof sheets.
    for y in (40, 92, 150, 200):
        cv.rect(0, y, W, y + 1, (78, 86, 100))
    # Skylights: two long glazed strips along the crown.
    for x0, x1 in ((40, 400), (496, 856)):
        cv.rect(x0, 104, x1, 120, (60, 74, 92))
        for x in range(x0 + 2, x1 - 2, 12):
            cv.rect(x, 106, x + 10, 118, (132, 176, 204))
            cv.rect(x, 106, x + 10, 108, (196, 226, 236))
        cv.frame(x0, 104, x1, 120, OUTLINE)
    # Roof vents and plant.
    for x in (120, 300, 600, 780):
        cv.rect(x, 52, x + 22, 70, (150, 156, 164))
        cv.rect(x, 52, x + 22, 56, (196, 200, 204))
        for gx in range(x + 3, x + 20, 4):
            cv.rect(gx, 60, gx + 2, 68, (70, 74, 82))
        cv.frame(x, 52, x + 22, 70, OUTLINE)
    for x in (200, 680):
        cv.rect(x, 160, x + 40, 186, (176, 180, 186))
        cv.rect(x + 6, 164, x + 20, 182, (90, 96, 106))
        cv.rect(x + 24, 164, x + 36, 172, (120, 126, 136))
        cv.frame(x, 160, x + 40, 186, OUTLINE)
    # Eaves: a dark gutter where the roof meets the front wall.
    cv.rect(0, ROOF_BOTTOM - 6, W, ROOF_BOTTOM - 2, (70, 76, 88))
    cv.rect(0, ROOF_BOTTOM - 2, W, ROOF_BOTTOM, (210, 214, 218))


def wall(cv):
    y0 = ROOF_BOTTOM
    # Blue cladding with vertical ribs, a light trim band under the eaves and a dark plinth.
    for y in range(y0, H):
        for x in range(W):
            rib = x % 8
            v = (52, 92, 138) if rib not in (0, 1) else (40, 72, 112) if rib == 0 else (76, 118, 164)
            cv.put(x, y, v)
    cv.rect(0, y0, W, y0 + 14, (224, 226, 222))
    cv.rect(0, y0 + 14, W, y0 + 16, (150, 154, 156))
    cv.rect(0, H - 8, W, H, (96, 98, 104))
    cv.rect(0, H - 8, W, H - 7, (60, 62, 70))
    # High windows along the hall.
    for x0 in list(range(24, 300, 40)) + list(range(596, 872, 40)):
        cv.rect(x0, y0 + 22, x0 + 28, y0 + 34, (60, 74, 92))
        cv.rect(x0 + 2, y0 + 24, x0 + 26, y0 + 32, (132, 176, 204))
        cv.rect(x0 + 2, y0 + 24, x0 + 26, y0 + 26, (196, 226, 236))
        cv.frame(x0, y0 + 22, x0 + 28, y0 + 34, OUTLINE)


def poster(cv, x, y, word):
    w, h = max(64, text_width(word, 1) + 6), 46
    cv.rect(x, y, x + w, y + h, (238, 234, 220))
    cv.rect(x + 2, y + 2, x + w - 2, y + 14, (30, 30, 36))
    cv.text(word, x + (w - text_width(word, 1)) // 2, y + 5, (250, 250, 242))
    # A rider over a jump: chequered strip, ramp and bike.
    for i in range(0, w - 4, 4):
        cv.rect(x + 2 + i, y + h - 8, x + 4 + i, y + h - 6, (30, 30, 36) if (i // 4) % 2 else (250, 250, 242))
        cv.rect(x + 4 + i, y + h - 6, x + 6 + i, y + h - 4, (30, 30, 36) if (i // 4) % 2 else (250, 250, 242))
    cv.rect(x + 8, y + 30, x + 26, y + 38, (170, 110, 60))
    cv.rect(x + 14, y + 26, x + 26, y + 30, (170, 110, 60))
    cv.rect(x + 34, y + 20, x + 50, y + 24, (220, 60, 40))
    cv.rect(x + 32, y + 24, x + 36, y + 28, (30, 30, 36))
    cv.rect(x + 48, y + 24, x + 52, y + 28, (30, 30, 36))
    cv.rect(x + 40, y + 16, x + 44, y + 20, (240, 140, 30))
    cv.frame(x, y, x + w, y + h, OUTLINE)


def entrance(cv):
    y0 = ROOF_BOTTOM
    ex0, ex1 = DOOR_X - 40, DOOR_X + 2 * TILE + 40
    # The entrance bay: a light block standing proud of the cladding.
    cv.rect(ex0, y0 + 16, ex1, H, (206, 204, 196))
    for x in range(ex0, ex1, 16):
        cv.rect(x, y0 + 16, x + 1, H - 8, (176, 174, 168))
    cv.rect(ex0, H - 8, ex1, H, (120, 120, 124))
    cv.frame(ex0, y0 + 14, ex1, H, OUTLINE)
    # Canopy over the doors, with downlights.
    cy = H - 66
    cv.rect(ex0 - 6, cy, ex1 + 6, cy + 8, (64, 66, 74))
    cv.rect(ex0 - 6, cy, ex1 + 6, cy + 2, (150, 154, 160))
    cv.frame(ex0 - 6, cy, ex1 + 6, cy + 8, OUTLINE)
    for x in range(ex0 + 6, ex1 - 2, 22):
        cv.rect(x, cy + 8, x + 6, cy + 10, (250, 236, 170))
    # Glass beside the doors.
    for gx0, gx1 in ((ex0 + 6, DOOR_X - 4), (DOOR_X + 2 * TILE + 4, ex1 - 6)):
        cv.rect(gx0, cy + 14, gx1, H - 10, (60, 74, 92))
        cv.rect(gx0 + 2, cy + 16, gx1 - 2, H - 12, (120, 164, 196))
        cv.rect(gx0 + 2, cy + 16, gx1 - 2, cy + 20, (196, 226, 236))
        cv.rect(gx0 + 4, cy + 22, gx0 + 6, H - 16, (196, 226, 236))
        cv.frame(gx0, cy + 14, gx1, H - 10, OUTLINE)
    # The double doors: two glass leaves in a steel frame, push bars, a step.
    dx0, dx1 = DOOR_X + 2, DOOR_X + 2 * TILE - 2
    dy0 = cy + 12
    cv.rect(dx0 - 2, dy0 - 2, dx1 + 2, H - 6, (52, 54, 62))
    for lx0, lx1 in ((dx0 + 2, DOOR_X + TILE - 1), (DOOR_X + TILE + 1, dx1 - 2)):
        cv.rect(lx0, dy0, lx1, H - 8, (78, 82, 92))
        cv.rect(lx0 + 3, dy0 + 3, lx1 - 3, H - 14, (120, 164, 196))
        cv.rect(lx0 + 3, dy0 + 3, lx1 - 3, dy0 + 7, (196, 226, 236))
        cv.rect(lx0 + 5, dy0 + 9, lx0 + 7, H - 18, (196, 226, 236))
        cv.rect(lx0 + 3, dy0 + 26, lx1 - 3, dy0 + 29, (200, 204, 210))
        cv.frame(lx0, dy0, lx1, H - 8, OUTLINE)
    # Handles meeting in the middle.
    cv.rect(DOOR_X + TILE - 5, dy0 + 18, DOOR_X + TILE - 3, dy0 + 34, (226, 196, 90))
    cv.rect(DOOR_X + TILE + 3, dy0 + 18, DOOR_X + TILE + 5, dy0 + 34, (226, 196, 90))
    cv.rect(dx0 - 6, H - 6, dx1 + 6, H - 2, (160, 160, 164))
    cv.rect(dx0 - 6, H - 2, dx1 + 6, H, (110, 110, 116))
    cv.frame(dx0 - 2, dy0 - 2, dx1 + 2, H - 6, OUTLINE)
    # The sign over the entrance, as the other buildings' signs: dark board, white letters, red rule.
    name = SIGN
    tw = text_width(name, 2)
    sx0 = DOOR_X + TILE - tw // 2 - 14
    sx1 = DOOR_X + TILE + tw // 2 + 14
    sy0, sy1 = y0 + 20, y0 + 50
    cv.rect(sx0, sy0, sx1, sy1, (34, 36, 42))
    cv.rect(sx0 + 2, sy0 + 2, sx1 - 2, sy0 + 3, (70, 72, 80))
    cv.rect(sx0 + 6, sy1 - 5, sx0 + 46, sy1 - 3, (206, 50, 40))
    cv.text(name, DOOR_X + TILE - tw // 2, sy0 + 6, (250, 250, 242), 2, shadow=(90, 92, 100))
    cv.frame(sx0, sy0, sx1, sy1, OUTLINE)
    # Wall lamps either side of the sign.
    for x in (sx0 - 12, sx1 + 6):
        cv.rect(x, sy0 + 8, x + 6, sy0 + 20, (226, 196, 90))
        cv.rect(x + 1, sy0 + 10, x + 5, sy0 + 16, (250, 236, 170))
        cv.frame(x, sy0 + 8, x + 6, sy0 + 20, OUTLINE)


def flags(cv):
    # Chequered flags and team banners along the eaves.
    for x in (60, 220, 380, 500, 660, 820):
        cv.rect(x, ROOF_BOTTOM - 30, x + 2, ROOF_BOTTOM, (60, 62, 70))
        for fy in range(3):
            for fx in range(4):
                cv.rect(x + 2 + fx * 4, ROOF_BOTTOM - 30 + fy * 4, x + 6 + fx * 4, ROOF_BOTTOM - 26 + fy * 4,
                        (30, 30, 36) if (fx + fy) % 2 else (250, 250, 242))
        cv.frame(x + 2, ROOF_BOTTOM - 30, x + 18, ROOF_BOTTOM - 18, OUTLINE)


def draw(pal):
    cv = Canvas(pal)
    roof(cv)
    wall(cv)
    for x in (40, 184, 640, 784):
        poster(cv, x, H - 66, POSTER)
    entrance(cv)
    flags(cv)
    cv.frame(0, 0, W, H, OUTLINE)
    cv.frame(0, ROOF_BOTTOM - 1, W, ROOF_BOTTOM, OUTLINE)
    return cv.img


def main():
    global SIGN, POSTER
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    for a in sys.argv[1:]:
        if a.startswith('--sign='):
            SIGN = a[len('--sign='):]
        elif a.startswith('--poster='):
            POSTER = a[len('--poster='):]
    pal = load_palette(args[0])
    img = draw(pal).resize((W * 2, H * 2), Image.NEAREST)
    img.save(args[1])
    if len(args) > 2:
        img.resize((W, H), Image.NEAREST).save(args[2])


if __name__ == '__main__':
    main()
