"""Draws the No-Turn Takedown venue's drag strip art (Boss, 30 Oct 2026): the VIP grandstand on the
far side of the strip, the raised start platform at its left end, and the start and finish lines
laid over the tarmac. Drawn at half size and doubled, for the style guide's 2 px pixel clusters,
with every colour snapped to the reference palette (art/palette/palette-ref-v1.hex).

    python3 tools/art/drag-strip.py <palette.hex> <out-folder>

Writes vip-grandstand.png (24 x 4 tiles), start-platform.png (2 x 6 tiles, across the strip),
no-turn-track.png (27 x 4 tiles: the dirt No-Turn track from the platform's four start gates to the
map's right edge, with a tabletop, a double, whoops and a step-up, hay bales along its sides), start-line-v.png and
finish-line-v.png (1 tile, laid over a strip tile, transparent either side).
"""
import sys
from pathlib import Path

from PIL import Image

HALF = 32  # a 64 px tile at half size
OUTLINE = (0x27, 0x29, 0x2C)
FONT = {
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    'N': ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
    'I': ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
    'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    '-': ['...', '...', '...', '###', '...', '...', '...'],
    ' ': ['...', '...', '...', '...', '...', '...', '...'],
}


def load_palette(path):
    return [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in Path(path).read_text().split()]


class Canvas:
    def __init__(self, pal, w, h):
        self.pal, self.w, self.h = pal, w, h
        self.img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        self.px = self.img.load()
        self.cache = {}

    def c(self, rgb):
        if rgb not in self.cache:
            self.cache[rgb] = min(self.pal, key=lambda p: sum((a - b) ** 2 for a, b in zip(p, rgb))) + (255,)
        return self.cache[rgb]

    def rect(self, x0, y0, x1, y1, rgb):
        for y in range(max(0, y0), min(self.h, y1)):
            for x in range(max(0, x0), min(self.w, x1)):
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

    def doubled(self):
        return self.img.resize((self.w * 2, self.h * 2), Image.NEAREST)


def text_width(s, scale):
    return sum((len(FONT[ch][0]) + 1) * scale for ch in s) - scale


def grandstand(pal):
    """A long covered stand seen from the strip: roof, fascia with the name, tiered seats, the VIP
    box in the middle with its glass front, and a low sponsor wall along the front."""
    W, H = 24 * HALF, 4 * HALF
    cv = Canvas(pal, W, H)
    roof_h, fascia_h, wall_h = 18, 20, 14
    # Roof: a steel canopy, ribbed.
    for x in range(W):
        rib = x % 8
        shade = 120 + (16 if rib == 0 else -10 if rib == 4 else 0)
        cv.rect(x, 0, x + 1, roof_h, (shade - 8, shade, shade + 10))
    cv.rect(0, roof_h, W, roof_h + fascia_h, (34, 36, 42))
    cv.rect(0, roof_h + fascia_h - 2, W, roof_h + fascia_h, (206, 50, 40))
    name = 'NO-TURN TAKEDOWN'
    cv.text(name, (W - text_width(name, 2)) // 2, roof_h + 3, (250, 250, 242), 2, shadow=(90, 92, 100))
    # Seats: rows stepping down to the front, red and white blocks, with aisles.
    top, bottom = roof_h + fascia_h, H - wall_h
    rows = (bottom - top) // 6
    for r in range(rows):
        y = top + r * 6
        cv.rect(0, y, W, y + 6, (70, 72, 80))
        for x in range(2, W - 2, 6):
            if (x // 6) % 16 == 0:
                continue  # an aisle
            seat = (200, 52, 44) if r % 2 == 0 else (236, 232, 222)
            cv.rect(x, y + 1, x + 4, y + 4, seat)
            cv.rect(x, y + 4, x + 4, y + 5, (40, 40, 46))
        # Spectators here and there.
        for x in range(8 + r * 13 % 40, W - 8, 37 + r * 5):
            cv.rect(x, y - 1, x + 4, y + 3, ((240, 190, 150), (120, 80, 60), (200, 160, 120))[(x + r) % 3])
            cv.rect(x, y + 3, x + 4, y + 5, ((60, 100, 200), (40, 140, 70), (230, 180, 40), (30, 30, 36))[(x // 3 + r) % 4])
    # The VIP box: a glass-fronted lounge across the middle, with gold trim.
    vx0, vx1 = W // 2 - 70, W // 2 + 70
    cv.rect(vx0, top, vx1, bottom, (46, 48, 58))
    cv.rect(vx0 + 4, top + 4, vx1 - 4, bottom - 6, (110, 170, 220))
    for x in range(vx0 + 4, vx1 - 4, 14):
        cv.rect(x, top + 4, x + 2, bottom - 6, (60, 64, 76))
        cv.rect(x + 4, top + 6, x + 6, bottom - 10, (190, 225, 245))
    cv.rect(vx0, top, vx1, top + 2, (226, 196, 90))
    cv.rect(vx0, bottom - 6, vx1, bottom - 4, (226, 196, 90))
    cv.text('VIP', W // 2 - text_width('VIP', 1) // 2, bottom - 4 - 8 - 3, (226, 196, 90))
    cv.frame(vx0, top, vx1, bottom, OUTLINE)
    # The low wall along the front, with sponsor panels.
    cv.rect(0, bottom, W, H, (168, 168, 160))
    cv.rect(0, bottom, W, bottom + 2, (200, 200, 192))
    for i, x in enumerate(range(12, W - 40, 64)):
        colour = ((206, 50, 40), (40, 90, 170), (230, 180, 40), (40, 140, 70))[i % 4]
        cv.rect(x, bottom + 4, x + 40, H - 3, colour)
        cv.rect(x + 4, bottom + 7, x + 36, bottom + 8, (250, 250, 242))
        cv.frame(x, bottom + 4, x + 40, H - 3, OUTLINE)
    cv.frame(0, 0, W, H, OUTLINE)
    cv.frame(0, roof_h, W, roof_h + fascia_h, OUTLINE)
    return cv.doubled()


def start_platform(pal):
    """The raised start platform across the strip's left end: a steel deck on legs, a drop-off edge
    on the strip side, rails along the back and front, and steps up from the car park."""
    W, H = 2 * HALF, 6 * HALF
    cv = Canvas(pal, W, H)
    cv.rect(4, 6, W - 10, H - 10, (130, 134, 142))
    for y in range(8, H - 12, 6):
        cv.rect(6, y, W - 12, y + 1, (110, 114, 122))
    for x in range(10, W - 12, 8):
        cv.rect(x, 8, x + 1, H - 12, (150, 154, 160))
    # The drop-off edge, chequered, on the strip side.
    for i, y in enumerate(range(6, H - 10, 4)):
        cv.rect(W - 10, y, W - 6, y + 4, (30, 30, 36) if i % 2 else (250, 250, 242))
    # Shadow under the deck, so it reads as raised.
    cv.rect(W - 6, 10, W - 2, H - 6, (40, 42, 48))
    cv.rect(8, H - 10, W - 2, H - 6, (40, 42, 48))
    # Rails top and bottom, and steps on the back.
    for y in (4, H - 12):
        cv.rect(4, y, W - 10, y + 2, (226, 196, 90))
    for i in range(4):
        cv.rect(0, H // 2 - 10 + i * 5, 4, H // 2 - 7 + i * 5, (100, 104, 112))
    cv.frame(4, 6, W - 10, H - 10, OUTLINE)
    return cv.doubled()


DIRT = (150, 100, 60)
DIRT_LIGHT = (184, 132, 84)
DIRT_DARK = (112, 72, 44)
DIRT_SHADOW = (84, 54, 36)


def jump_face(cv, x0, x1, y0, y1, lift):
    """A mound across the track, x0 to x1, seen from above and the front: the take-off face lit,
    the landing face in shade, a front face `lift` px deep to show its height, and its shadow."""
    mid = (x0 + x1) // 2
    cv.rect(x1, y0 + 2, x1 + lift, y1 + 2, DIRT_SHADOW)  # cast shadow, behind it
    for x in range(x0, x1):
        t = (x - x0) / max(1, x1 - x0)
        colour = DIRT_LIGHT if x < mid - (x1 - x0) // 6 else DIRT if x < mid + (x1 - x0) // 6 else DIRT_DARK
        cv.rect(x, y0 - lift, x + 1, y1 - lift, colour)
        cv.rect(x, y1 - lift, x + 1, y1, (122, 82, 50))
    cv.rect(x0, y0 - lift, x1, y0 - lift + 1, (210, 168, 120))


def no_turn_track(pal):
    """The dirt No-Turn track as it is built in the track editor, seen from the car park: four start
    gates on the platform's edge, then a tabletop, a double, whoops and a step-up, running on off
    the right of the map. Hay bales mark its sides."""
    W, H = 27 * HALF, 4 * HALF
    cv = Canvas(pal, W, H)
    top, bottom = 8, H - 8
    cv.rect(0, top, W, bottom, DIRT)
    # Ruts and grooves along the racing lines.
    for lane in range(4):
        y = top + 6 + lane * ((bottom - top - 12) // 3)
        for x in range(0, W, 3):
            if (x * 7 + lane * 5) % 11 < 7:
                cv.rect(x, y, x + 2, y + 1, DIRT_DARK)
    for x in range(0, W, 5):
        cv.rect(x, top + 2 + (x * 13) % 9, x + 1, top + 3 + (x * 13) % 9, DIRT_LIGHT)
        cv.rect(x + 2, bottom - 4 - (x * 7) % 9, x + 3, bottom - 3 - (x * 7) % 9, DIRT_LIGHT)
    # Banked edges.
    cv.rect(0, top, W, top + 2, DIRT_DARK)
    cv.rect(0, bottom - 2, W, bottom, DIRT_LIGHT)
    # Four start gates on the platform's edge: steel frames with the gates up.
    lane_h = (bottom - top) // 4
    for i in range(4):
        y0 = top + i * lane_h
        cv.rect(0, y0 + 2, 6, y0 + lane_h - 2, (90, 94, 102))
        cv.rect(1, y0 + 4, 5, y0 + lane_h - 4, (226, 196, 90))
        cv.rect(6, y0 + 3, 8, y0 + lane_h - 3, (40, 42, 48))
        cv.text(str(i + 1), 2, y0 + lane_h // 2 - 3, (30, 30, 36)) if str(i + 1) in FONT else None
        cv.frame(0, y0 + 2, 6, y0 + lane_h - 2, OUTLINE)
    # The jumps, left to right.
    jump_face(cv, 70, 150, top + 2, bottom - 2, 6)    # tabletop
    cv.rect(88, top + 2 - 6, 132, bottom - 2 - 6, (170, 118, 74))  # its flat top
    jump_face(cv, 230, 262, top + 2, bottom - 2, 5)   # double: take-off
    jump_face(cv, 300, 332, top + 2, bottom - 2, 5)   # double: landing
    for x in range(410, 520, 18):                     # whoops
        jump_face(cv, x, x + 12, top + 2, bottom - 2, 2)
    jump_face(cv, 590, 640, top + 2, bottom - 2, 4)   # step-up
    cv.rect(640, top + 2 - 7, 700, bottom - 2 - 7, (170, 118, 74))
    cv.rect(640, bottom - 2 - 7, 700, bottom - 2, (122, 82, 50))
    jump_face(cv, 780, W, top + 2, bottom - 2, 6)     # a tabletop running on out of sight
    # Hay bales along both sides, a gap now and then.
    for x in range(20, W - 8, 26):
        if (x // 26) % 5 == 3:
            continue
        for y in (top - 6, bottom - 2):
            cv.rect(x, y, x + 16, y + 8, (214, 178, 88))
            cv.rect(x, y + 6, x + 16, y + 8, (170, 136, 60))
            cv.rect(x + 5, y, x + 6, y + 8, (186, 150, 70))
            cv.rect(x + 10, y, x + 11, y + 8, (186, 150, 70))
            cv.frame(x, y, x + 16, y + 8, OUTLINE)
    return cv.doubled()


def line(pal, chequered):
    W = H = HALF
    cv = Canvas(pal, W, H)
    if chequered:
        for y in range(0, H, 4):
            for x in range(12, 20, 4):
                cv.rect(x, y, x + 4, y + 4, (30, 30, 36) if ((x - 12) // 4 + y // 4) % 2 else (250, 250, 242))
    else:
        cv.rect(14, 0, 18, H, (250, 250, 242))
    return cv.doubled()


def main():
    pal = load_palette(sys.argv[1])
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    grandstand(pal).save(out / 'vip-grandstand.png')
    start_platform(pal).save(out / 'start-platform.png')
    no_turn_track(pal).save(out / 'no-turn-track.png')
    line(pal, False).save(out / 'start-line-v.png')
    line(pal, True).save(out / 'finish-line-v.png')


if __name__ == '__main__':
    main()
