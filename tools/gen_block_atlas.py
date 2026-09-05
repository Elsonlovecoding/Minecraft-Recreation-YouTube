#!/usr/bin/env python3
"""Generates assets/block_atlas.png — every shipped block tile as ORIGINAL
pixel art in the vanilla idiom.

Run:  python3 tools/gen_block_atlas.py            (writes the atlas)
      python3 tools/gen_block_atlas.py --sheet out.png   (zoomed contact sheet)

The layout is docs/ATLAS_MAP.md: a 16x16 grid of 16px tiles, indices 0-68
painted here, 69 and 70 left blank for render/atlas.js to paint at boot.
Nothing is copied from any texture pack: each tile is authored procedurally
from a few hand-picked shades and deterministic hash noise, in the visual
language of the classic blocks — a stone that is soft grey blobs quantised
to four values, a cobble of jittered rounded stones with a dark mortar,
bark that runs in broken vertical ridges, planks of four staggered boards,
ores that are angular mineral clusters with one highlight texel each.
Every noise field wraps at 16px so the tiles repeat seamlessly across faces.

Colour conventions the rest of the game depends on (world/chunks.js):
grass top, leaves and ground plants are painted GREEN and the per-column
biome tint MULTIPLIES them, so their hue lives here and the tint only
shifts it. Cutout tiles keep the alpha coverage the meshes were built for
(cactus insets, the 13px-tall portal frame side, water at alpha 180).

No third-party imaging library: the PNG writer at the bottom is a tiny
zlib/struct encoder, so this runs on any Python 3.
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_paint import (  # noqa: E402 — the brushes live next to this file
    SIZE, T, COLS, H, vnoise, fbm, field, ranked, pick, worley, mul, Tile,
    speckle, cobble, bark, ore_blobs, bricks, planks, bevel_block,
)

# ---------------------------------------------------------------------------
# Palettes
# ---------------------------------------------------------------------------

STONE = [(102, 102, 102), (116, 116, 116), (128, 128, 128), (146, 146, 146)]
STONE_W = [2, 4, 4, 2]
COBBLE = [(118, 118, 118), (130, 130, 130), (142, 142, 142), (152, 152, 152)]
DIRT = [(96, 66, 42), (120, 84, 56), (134, 96, 66), (150, 110, 76)]
GRASS = [(58, 96, 44), (72, 118, 52), (84, 134, 58), (98, 152, 66)]
LEAF = [(30, 78, 12), (40, 98, 16), (52, 118, 22), (66, 138, 30)]
SAND = [(206, 194, 146), (216, 205, 160), (224, 214, 170), (232, 222, 180)]
BARK = [(70, 54, 32), (94, 74, 44), (114, 90, 54), (136, 108, 66)]
WOOD = [(148, 118, 70), (164, 132, 80), (176, 144, 88), (190, 158, 100)]
SEAM = (104, 82, 46)
DEEP = [(56, 56, 60), (70, 70, 74), (82, 82, 86), (96, 96, 100)]
END = [(214, 216, 150), (224, 227, 162), (232, 236, 174), (240, 244, 186)]
NETHER = [(64, 20, 20), (86, 30, 30), (104, 42, 40), (126, 56, 52)]

COAL = ((36, 36, 36), (74, 74, 74), (16, 16, 16))
IRON = ((214, 174, 146), (240, 212, 194), (176, 130, 100))
GOLD = ((250, 216, 72), (255, 244, 160), (198, 154, 32))
REDSTONE = ((196, 22, 22), (255, 70, 60), (128, 4, 4))
DIAMOND = ((94, 222, 232), (176, 248, 250), (44, 156, 178))
QUARTZ = ((230, 224, 214), (250, 250, 246), (186, 176, 166))


def stone_tile(salt=1):
    return speckle(STONE, STONE_W, salt, grain=0.08)


def deepslate_tile(salt=58):
    return speckle(DEEP, [2, 4, 4, 2], salt, octaves=((8, 1.0), (16, 0.5)), grain=0.10, ax=0.6, ay=3.0)


def netherrack_tile(salt=33):
    return speckle(NETHER, [2, 4, 4, 2], salt, octaves=((4, 1.0), (8, 0.7), (16, 0.5)), grain=0.12)


# ---------------------------------------------------------------------------
# The tiles
# ---------------------------------------------------------------------------

def grass_top():
    # Fine, even grain: the classic turf is a speckle, not a blotch.
    return speckle(GRASS, [2, 4, 4, 2], 100, octaves=((8, 0.45), (16, 1.0)), grain=0.55)


def grass_side():
    t = speckle(DIRT, [2, 4, 4, 2], 102, grain=0.16)
    cap = speckle(GRASS, [2, 4, 4, 2], 100, octaves=((8, 0.45), (16, 1.0)), grain=0.55)
    for x in range(T):
        depth = 3 + int(H(x, 0, 103) * 3)               # 3..5 texels of turf
        if H(x, 1, 104) < 0.25:
            depth += 1                                  # the odd longer tuft
        for y in range(depth):
            c = cap.get(x, y)
            if y == depth - 1:
                c = mul(c[:3], 0.82) + (255,)           # a shaded underside
            t.set(x, y, c[:3])
    return t


def dirt():
    t = speckle(DIRT, [2, 4, 4, 2], 105, grain=0.16)
    for y in range(T):                                  # the odd pale pebble
        for x in range(T):
            if H(x, y, 106) < 0.03:
                t.set(x, y, (150, 128, 104))
    return t


def sand():
    return speckle(SAND, [2, 4, 4, 2], 107, octaves=((4, 1.0), (8, 0.4)), grain=0.05)


def gravel():
    stones = [(108, 104, 102), (126, 122, 120), (144, 140, 138), (160, 156, 154), (134, 122, 110)]
    return cobble(stones, (96, 92, 90), 108, n=5, mortar_width=0.5, bevel=0.14, grain=0.08)


def oak_log():
    return bark(BARK, [2, 4, 4, 2], 109)


def oak_log_top():
    t = Tile()
    rings = [(200, 168, 106), (170, 138, 82), (156, 124, 72)]

    def px(x, y):
        d = max(abs(x - 7.5), abs(y - 7.5))              # square rings
        if d > 6.6:
            return BARK[int(H(x, y, 110) * 3)]
        if d > 5.6:
            return BARK[1]
        k = int(d + H(x // 2, y // 2, 111) * 0.8)
        c = rings[k % 3] if k % 2 else rings[0]
        return mul(c, 0.96 + H(x, y, 112) * 0.08)
    return t.fill(px)


def oak_planks():
    return planks(WOOD, SEAM, 113)


def oak_leaves():
    t = Tile()
    f = ranked(field(lambda x, y: fbm(x, y, 114, ((8, 1.0), (16, 0.8))) + (H(x, y, 115) - 0.5) * 0.3))
    s = ranked(field(lambda x, y: fbm(x, y, 116, ((4, 1.0), (16, 0.7))) + (H(x, y, 117) - 0.5) * 0.4))

    def px(x, y):
        if f[y * T + x] < 0.33:
            return None                                 # the gaps between leaves
        c = pick(s[y * T + x], LEAF, [2, 4, 4, 2])
        # Leaves next to a gap fall into shadow.
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if f[((y + dy) % T) * T + (x + dx) % T] < 0.33:
                return mul(c, 0.86)
        return c
    return t.fill(px)


def water_still():
    blues = [(30, 66, 142), (38, 82, 164), (50, 100, 186), (66, 118, 204)]
    t = Tile()
    r = ranked(field(lambda x, y: fbm(x, y, 118, ((4, 1.0), (8, 0.5)), ax=2.5, ay=0.8)))
    return t.fill(lambda x, y: (pick(r[y * T + x], blues, [2, 4, 4, 2]), 180))


def bedrock():
    greys = [(34, 34, 34), (58, 58, 58), (84, 84, 84), (112, 112, 112), (136, 136, 136)]
    return speckle(greys, [2, 3, 3, 3, 2], 119, octaves=((4, 1.0), (8, 0.8)), grain=0.18)


def sandstone_side():
    t = speckle(SAND, [1, 3, 4, 2], 120, octaves=((16, 1.0),), grain=0.06, ax=4.0, ay=0.6)
    for y in range(T):                                  # strata: darker bands
        band = H(0, y, 121)
        for x in range(T):
            c = t.get(x, y)[:3]
            if band < 0.28:
                c = mul(c, 0.93)
            if y in (0, 15):
                c = mul(c, 0.90)
            t.set(x, y, c)
    for i in range(5):                                  # short dark cracks
        cx, cy = int(H(i, 5, 122) * T), 2 + int(H(i, 6, 122) * 12)
        for k in range(2 + int(H(i, 7, 122) * 3)):
            t.set(cx + k, cy, (178, 166, 120))
    return t


def sandstone_top():
    t = speckle(SAND, [1, 3, 4, 2], 123, octaves=((4, 1.0), (16, 0.5)), grain=0.05)
    for i in range(6):
        cx, cy = int(H(i, 5, 124) * T), int(H(i, 6, 124) * T)
        t.set(cx, cy, (188, 176, 130))
        t.set(cx + 1, cy, (188, 176, 130))
    return t


def glass():
    t = Tile()
    frame = (214, 232, 238)
    t.rect(0, 0, 15, 0, frame)
    t.rect(0, 15, 15, 15, frame)
    t.rect(0, 0, 0, 15, frame)
    t.rect(15, 0, 15, 15, frame)
    for c in ((0, 0), (15, 0), (0, 15), (15, 15)):
        t.set(c[0], c[1], (180, 204, 212))
    for k in range(6):                                  # a diagonal glint
        t.set(2 + k, 7 - k, (255, 255, 255), 230)
    for k in range(3):
        t.set(9 + k, 4 - k, (255, 255, 255), 200)
    return t


def ore(base, mineral, salt, count=8):
    return ore_blobs(base, mineral, salt, count)


def obsidian():
    dark = [(10, 6, 18), (18, 12, 30), (26, 18, 42), (40, 28, 60)]
    t = speckle(dark, [3, 4, 3, 1], 125, octaves=((4, 1.0), (8, 0.6)), grain=0.05)
    for i in range(6):                                  # faint violet glints
        x, y = int(H(i, 1, 126) * T), int(H(i, 2, 126) * T)
        t.set(x, y, (66, 48, 96))
        t.set(x + 1, y, (52, 38, 78))
    return t


def lava_still():
    fires = [(146, 38, 8), (204, 86, 18), (236, 140, 30), (252, 204, 68)]
    return speckle(fires, [2, 3, 3, 2], 127, octaves=((4, 1.0), (8, 0.5)), grain=0.04)


def cactus_side():
    t = Tile()
    body = (78, 122, 40)
    for y in range(T):
        for x in range(1, 15):
            k = 1.0 + (H(x, y, 128) - 0.5) * 0.10
            c = mul(body, k)
            if x % 4 == 1:
                c = mul(c, 1.22)                        # the ridge
            elif x % 4 == 3:
                c = mul(c, 0.78)                        # its shadow
            t.set(x, y, c)
    for x in (1, 5, 9, 13):                             # spines on the ridges
        for y in range((x // 4) % 2, T, 4):
            t.set(x, y, (208, 214, 176))
    return t


def cactus_top():
    t = Tile()
    body = (82, 128, 42)
    for y in range(1, 15):
        for x in range(1, 15):
            k = 1.0 + (H(x, y, 129) - 0.5) * 0.10
            d = max(abs(x - 7.5), abs(y - 7.5))
            c = mul(body, k * (1.25 if d > 5.6 else 0.86 if d < 2 else 1.0))
            t.set(x, y, c)
    for (x, y) in ((4, 4), (11, 4), (4, 11), (11, 11), (7, 8)):
        t.set(x, y, (208, 214, 176))
    return t


def torch():
    t = Tile()
    key = {'w': (118, 90, 52), 'd': (92, 68, 38), 'c': (56, 42, 28),
           'y': (255, 222, 82), 'o': (255, 150, 42), 'W': (255, 250, 200)}
    rows = [
        '.......W........',
        '.......yy.......',
        '.......yy.......',
        '.......oo.......',
        '.......cc.......',
        '.......wd.......',
        '.......wd.......',
        '.......wd.......',
        '.......wd.......',
        '.......wd.......',
        '.......wd.......',
        '.......wd.......',
        '.......wd.......',
    ]
    return t.sprite(rows, key, 0, 3)


def crafting_table_top():
    t = planks(WOOD, SEAM, 130, joints=(2, 13, 6, 10))
    line = (58, 42, 26)
    t.rect(0, 0, 15, 0, line)
    t.rect(0, 15, 15, 15, line)
    t.rect(0, 0, 0, 15, line)
    t.rect(15, 0, 15, 15, line)
    for k in (3, 7, 11):                                # the 3x3 grid
        t.rect(3, k, 12, k, line)
        t.rect(k, 3, k, 12, line)
    t.rect(3, 12, 12, 12, line)
    t.rect(12, 3, 12, 12, line)
    return t


def crafting_table_front():
    t = planks(WOOD, SEAM, 131, joints=(13, 5, 9, 1))
    t.rect(0, 0, 15, 0, (104, 82, 46))
    t.rect(0, 15, 15, 15, (70, 52, 30))
    key = {'s': (168, 172, 176), 'S': (206, 210, 214), 'h': (88, 62, 34), 'k': (110, 112, 116), 'K': (72, 74, 78)}
    saw = ['.SSSSSS.', 'ss.s.s.s', 'h.......', 'hh......']
    hammer = ['KKKK', 'kkKK', '.hh.', '.h..', '.h..', '.h..']
    t.sprite(saw, key, 1, 3)
    t.sprite(hammer, key, 10, 3)
    return t


def crafting_table_side():
    t = planks(WOOD, SEAM, 132, joints=(6, 12, 3, 9))
    t.rect(0, 0, 15, 0, (104, 82, 46))
    t.rect(0, 15, 15, 15, (70, 52, 30))
    key = {'s': (168, 172, 176), 'S': (206, 210, 214), 'h': (88, 62, 34), 'k': (110, 112, 116), 'K': (72, 74, 78)}
    chisel = ['S.', 's.', 's.', 'k.', 'h.', 'h.', 'h.']
    axe = ['.KK', 'KKK', 'kKK', '.h.', '.h.', '.h.', '.h.']
    t.sprite(chisel, key, 3, 4)
    t.sprite(axe, key, 9, 4)
    return t


FURNACE_STONE = [(120, 120, 120), (132, 132, 132), (146, 146, 146)]


def furnace_side():
    return cobble(FURNACE_STONE, (76, 76, 76), 133, n=4, mortar_width=0.8, bevel=0.10, grain=0.05)


def furnace_top():
    return cobble(FURNACE_STONE, (76, 76, 76), 134, n=4, mortar_width=0.8, bevel=0.10, grain=0.05)


def furnace_front(lit):
    t = cobble(FURNACE_STONE, (76, 76, 76), 135, n=4, mortar_width=0.8, bevel=0.10, grain=0.05)
    t.rect(3, 8, 12, 8, (92, 92, 92))                   # the lip
    t.rect(4, 9, 11, 14, (28, 28, 28))                  # the opening
    t.rect(4, 9, 11, 9, (18, 18, 18))
    t.rect(3, 15, 12, 15, (66, 66, 66))
    if lit:
        key = {'r': (200, 60, 16), 'o': (250, 140, 30), 'y': (255, 214, 70), 'W': (255, 246, 170)}
        rows = ['..o..y..', '.oyy.yo.', 'oyWyoyyo', 'oyyyyWyo', 'rooyyoor']
        t.sprite(rows, key, 4, 10)
    return t


def soul_sand():
    browns = [(66, 50, 40), (80, 62, 48), (92, 72, 56), (104, 82, 64)]
    t = speckle(browns, [2, 4, 4, 2], 136, grain=0.08)
    dark = (40, 28, 22)
    for (ox, oy) in ((2, 3), (9, 9), (10, 1)):           # the trapped faces
        t.set(ox, oy, dark)
        t.set(ox + 3, oy, dark)
        t.rect(ox, oy + 2, ox + 3, oy + 2, dark)
        t.set(ox + 1, oy + 3, dark)
        t.set(ox + 2, oy + 3, dark)
    return t


def nether_bricks():
    face = [(46, 22, 26), (54, 26, 30), (62, 32, 36)]
    return bricks(face, (28, 12, 16), 137, rows=4, brick_w=8, brick_h=4, offset=4)


def glowstone():
    t = Tile()
    w = worley(4, 138, jitter=0.7)

    def px(x, y):
        d1, d2, sid, dx, dy = w(x, y)
        edge = d2 - d1
        k = H(x, y, 139)
        if edge < 0.9:
            return (150, 104, 44) if k < 0.7 else (176, 128, 56)
        bright = H(sid[0], sid[1], 140)
        if bright < 0.4:
            return (250, 224, 128) if k < 0.6 else (238, 200, 96)
        return (222, 174, 76) if k < 0.7 else (204, 152, 60)
    return t.fill(px)


def nether_wart():
    t = Tile()
    key = {'c': (150, 26, 26), 'C': (196, 56, 50), 'h': (232, 108, 96), 's': (96, 16, 16), 'd': (118, 20, 20)}
    cap = ['.CC.', 'ChCC', 'cCcc', '.ss.']
    for i, (ox, oy) in enumerate(((0, 2), (5, 0), (10, 3), (3, 7), (11, 8))):
        t.sprite(cap, key, ox, oy)
        for y in range(oy + 4, T):                       # the stalk down to soil
            t.set(ox + 1, y, (110, 18, 18))
            t.set(ox + 2, y, (90, 12, 12))
    small = ['.d.', 'dsd']
    for (ox, oy) in ((7, 12), (0, 12), (13, 13)):
        t.sprite(small, key, ox, oy)
    return t


def end_stone():
    return cobble(END, (196, 198, 132), 141, n=5, mortar_width=0.5, bevel=0.06, grain=0.04)


def end_portal_frame_top():
    t = end_stone()
    for y in range(2, 14):
        for x in range(2, 14):
            d = max(abs(x - 7.5), abs(y - 7.5))
            if d > 5:
                t.set(x, y, (52, 132, 100) if H(x, y, 142) < 0.7 else (40, 112, 84))
            else:
                k = H(x, y, 143)
                t.set(x, y, (16, 52, 42) if k < 0.6 else (22, 66, 52) if k < 0.9 else (30, 86, 66))
    return t


def end_portal_frame_side():
    t = end_stone()
    for y in range(3):
        for x in range(T):
            t.set(x, y, (0, 0, 0), 0)                   # the frame is 13/16 tall
    for x in range(T):
        t.set(x, 3, (208, 210, 146))
        t.set(x, 4, (52, 132, 100) if H(x, 4, 144) < 0.75 else (36, 104, 78))
        t.set(x, 5, (36, 104, 78) if H(x, 5, 145) < 0.8 else (52, 132, 100))
    return t


def stone_bricks(salt=146):
    face = [(122, 122, 122), (132, 132, 132), (142, 142, 142)]
    return bricks(face, (78, 78, 78), salt)


def mossy_stone_bricks():
    t = stone_bricks(147)
    moss = [(74, 104, 48), (88, 122, 56), (104, 140, 66)]
    m = ranked(field(lambda x, y: fbm(x, y, 148, ((4, 1.0), (8, 0.6))) + (H(x, y, 149) - 0.5) * 0.25))
    for y in range(T):
        for x in range(T):
            v = m[y * T + x]
            if v < 0.30:
                t.set(x, y, moss[int(H(x, y, 150) * 3)])
    return t


def cracked_stone_bricks():
    t = stone_bricks(151)
    crack = (70, 70, 70)
    x, y = 2, 1                                          # a crack wandering down
    while y < 7:
        t.set(x, y, crack)
        y += 1
        x += 1 if H(x, y, 152) < 0.45 else 0 if H(x, y, 153) < 0.7 else -1
    x, y = 12, 8
    while y < 15:
        t.set(x, y, crack)
        y += 1
        x += -1 if H(x, y, 154) < 0.45 else 0 if H(x, y, 155) < 0.7 else 1
    for (cx, cy) in ((6, 12), (7, 12), (10, 3)):        # chipped corners
        t.set(cx, cy, (96, 96, 96))
    return t


def bookshelf():
    t = planks(WOOD, SEAM, 156, joints=(5, 12, 5, 12))
    books = [(168, 40, 40), (56, 118, 62), (44, 62, 152), (204, 172, 62), (124, 82, 42), (222, 218, 198), (112, 56, 140)]
    for shelf, y0 in enumerate((1, 8)):
        t.rect(1, y0, 14, y0 + 6, (30, 20, 12))          # the shadowed shelf back
        x = 1
        k = 0
        while x <= 14:
            w = 1 + int(H(k, shelf, 157) * 2.5)
            w = min(w, 15 - x)
            c = books[int(H(k, shelf, 158) * len(books))]
            h = 5 + int(H(k, shelf, 159) * 2)
            for bx in range(x, x + w):
                for by in range(y0 + 6 - h + 1, y0 + 6):
                    t.set(bx, by, c if bx != x + w - 1 or w == 1 else mul(c, 0.8))
                t.set(bx, y0 + 6 - h + 1, mul(c, 1.25))
            x += w + (1 if H(k, shelf, 160) < 0.35 else 0)
            k += 1
    return t


def iron_bars():
    t = Tile()
    for i in range(T):
        for k in (0, 7, 8, 15):
            shade = (176, 176, 176) if i % 4 == 1 else (144, 144, 144) if i % 4 != 3 else (118, 118, 118)
            t.set(k, i, shade)
            t.set(i, k, shade if k in (0, 15) else (132, 132, 132))
    return t


def spawner():
    t = Tile()
    bars = ((0, 1), (5, 6), (10, 11), (15,))
    on = set(v for b in bars for v in b)
    shades = [(30, 40, 48), (44, 56, 66), (58, 72, 84)]
    for y in range(T):
        for x in range(T):
            if x in on or y in on:
                t.set(x, y, shades[int(H(x, y, 161) * 3)])
    return t


def brewing_stand():
    t = Tile()
    key = {'r': (150, 152, 160), 'R': (196, 198, 206), 'g': (176, 210, 220), 'p': (214, 60, 120),
           'P': (240, 120, 170), 'b': (236, 200, 70), 'c': (96, 96, 96), 'C': (124, 124, 124), 'd': (60, 60, 60)}
    rows = [
        '.......R........',
        '.......rR.......',
        '.......rR.......',
        '.......rR.......',
        '.......rR.bb....',
        '..gg...rR.b.....',
        '.g..g..rR.......',
        '.gPPg..rR.......',
        '.gppg..rR.......',
        '.gppg..rR.......',
        '..gg...rR.......',
        '.......rR.......',
        '...CCCCCCCCCC...',
        '...cccccdcccc...',
        '...dcccccccdc...',
    ]
    return t.sprite(rows, key, 0, 1)


def white_wool():
    wool = [(212, 212, 208), (226, 226, 222), (236, 236, 234), (244, 244, 242)]
    return speckle(wool, [2, 4, 4, 2], 162, octaves=((8, 1.0), (16, 0.6)), grain=0.10)


def fire():
    t = Tile()
    cols = [(206, 52, 18), (250, 130, 32), (255, 190, 54), (255, 236, 132)]
    heights = [8 + int(vnoise(x, 0, 8, 163) * 8) for x in range(T)]
    for x in range(T):
        h = heights[x]
        for y in range(T - h, T):
            up = (T - y) / h                             # 0 at the base, 1 at the tip
            k = H(x, y, 164)
            if up > 0.8 and k < 0.45:
                continue                                 # ragged tongues
            if up > 0.55 and k < 0.15:
                continue
            c = cols[0] if up > 0.82 else cols[1] if up > 0.55 else cols[2] if up > 0.22 else cols[3]
            if k > 0.9 and up < 0.7:
                c = cols[min(3, cols.index(c) + 1)]
            t.set(x, y, c)
    return t


def granite():
    pinks = [(126, 84, 72), (150, 106, 92), (170, 124, 110), (190, 146, 130)]
    t = speckle(pinks, [2, 4, 4, 2], 165, octaves=((8, 1.0), (16, 0.8)), grain=0.22)
    for y in range(T):
        for x in range(T):
            if H(x, y, 166) < 0.05:
                t.set(x, y, (98, 64, 54))
    return t


def diorite():
    whites = [(146, 146, 150), (182, 182, 186), (206, 206, 208), (224, 224, 226)]
    return speckle(whites, [1, 3, 4, 3], 167, octaves=((16, 1.0),), grain=0.55)


def andesite():
    greys = [(108, 110, 104), (128, 130, 124), (146, 148, 142), (162, 164, 156)]
    return speckle(greys, [2, 4, 4, 2], 168, octaves=((8, 1.0), (16, 0.8)), grain=0.24)


def coal_block():
    dark = [(16, 16, 16), (24, 24, 24), (32, 32, 32), (44, 44, 44)]
    return speckle(dark, [2, 4, 3, 1], 169, grain=0.10)


def cobbled_deepslate():
    return cobble([(74, 74, 78), (86, 86, 90), (100, 100, 104)], (46, 46, 50), 170, n=4, mortar_width=0.7, bevel=0.10)


def short_grass():
    t = Tile()
    greens = [(48, 106, 28), (64, 132, 38), (84, 156, 48)]
    for x in range(T):
        if H(x, 0, 171) < 0.2:
            continue
        h = 5 + int(H(x, 1, 172) * 10)
        lean = 1 if H(x, 2, 173) < 0.35 else -1 if H(x, 2, 173) < 0.7 else 0
        c = greens[int(H(x, 3, 174) * 3)]
        for i in range(h):
            y = T - 1 - i
            bx = x + (lean if i > h * 0.6 else 0)
            t.set(bx, y, c if i < h - 2 else mul(c, 1.15))
    return t


def flower(head_rows, head_key, ox=6, oy=3):
    t = Tile()
    stem = (54, 112, 30)
    leaf = (72, 138, 40)
    for y in range(oy + len(head_rows), T):
        t.set(7, y, stem)
    t.set(5, 11, leaf)
    t.set(6, 11, leaf)
    t.set(6, 10, leaf)
    t.set(8, 12, leaf)
    t.set(9, 12, leaf)
    t.set(9, 13, leaf)
    return t.sprite(head_rows, head_key, ox, oy)


def dandelion():
    key = {'y': (246, 214, 40), 'Y': (255, 240, 130), 'd': (206, 160, 24)}
    return flower(['.yy.', 'yYyy', 'yyYy', 'dyyd', '.dd.'], key, 6, 2)


def poppy():
    key = {'r': (206, 32, 30), 'R': (238, 78, 60), 'k': (24, 22, 22), 'd': (150, 16, 18)}
    return flower(['.rr.', 'rRrr', 'rkkr', 'drrd', '.dd.'], key, 6, 2)


def dead_bush():
    t = Tile()
    key = {'b': (118, 84, 44), 'd': (92, 62, 32), 'l': (140, 104, 58)}
    rows = [
        'l...........l...',
        '.d....l....d....',
        '..d...b...d.....',
        '...d..b..d...l..',
        '.l..d.b.d...d...',
        '..d..db.d..d....',
        '...d..bd..d.....',
        '....d.b..d..l...',
        '.....db.d..d....',
        '..l...bd..d.....',
        '...d..b..d......',
        '....d.bd........',
        '.....db.........',
        '......b.........',
        '.....db.........',
        '......b.........',
    ]
    return t.sprite(rows, key, 1, 0)


def build():
    stone = stone_tile()
    deep = deepslate_tile()
    nether = netherrack_tile()
    tiles = {
        0: grass_top(), 1: grass_side(), 2: dirt(), 3: stone,
        4: cobble(COBBLE, (74, 74, 74), 4, n=4, mortar_width=0.7, bevel=0.16),
        5: sand(), 6: gravel(), 7: oak_log(), 8: oak_log_top(), 9: oak_planks(), 10: oak_leaves(),
        11: water_still(), 12: bedrock(), 13: sandstone_side(), 14: sandstone_top(), 15: glass(),
        16: ore(stone, COAL, 216, 9), 17: ore(stone, IRON, 217), 18: ore(stone, GOLD, 218),
        19: ore(stone, REDSTONE, 219), 20: ore(stone, DIAMOND, 220, 7), 21: obsidian(), 22: lava_still(),
        23: cactus_side(), 24: cactus_top(), 25: torch(), 26: crafting_table_top(),
        27: crafting_table_front(), 28: crafting_table_side(), 29: furnace_front(False),
        30: furnace_front(True), 31: furnace_side(), 32: furnace_top(), 33: nether, 34: soul_sand(),
        35: nether_bricks(), 36: glowstone(), 37: ore(nether, QUARTZ, 237), 38: nether_wart(),
        39: end_stone(), 40: end_portal_frame_top(), 41: end_portal_frame_side(), 42: stone_bricks(),
        43: mossy_stone_bricks(), 44: cracked_stone_bricks(), 45: bookshelf(), 46: iron_bars(),
        47: spawner(), 48: brewing_stand(), 49: white_wool(), 50: fire(), 51: granite(), 52: diorite(),
        53: andesite(), 54: bevel_block((214, 214, 214), (240, 240, 240), (168, 168, 168), 254),
        55: bevel_block((250, 216, 66), (255, 246, 160), (196, 150, 30), 255),
        56: bevel_block((98, 226, 226), (190, 255, 255), (48, 168, 180), 256),
        57: coal_block(), 58: deep, 59: cobbled_deepslate(), 60: ore(deep, COAL, 260, 9),
        61: ore(deep, IRON, 261), 62: ore(deep, GOLD, 262), 63: ore(deep, REDSTONE, 263),
        64: ore(deep, DIAMOND, 264, 7), 65: short_grass(), 66: dandelion(), 67: poppy(), 68: dead_bush(),
    }
    return tiles


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def write_png(path, w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw += bytes(rgba[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def compose(tiles):
    img = bytearray(SIZE * SIZE * 4)
    for idx, tile in tiles.items():
        ox, oy = (idx % COLS) * T, (idx // COLS) * T
        for y in range(T):
            for x in range(T):
                r, g, b, a = tile.px[y * T + x]
                i = ((oy + y) * SIZE + ox + x) * 4
                img[i:i + 4] = bytes((r, g, b, a))
    return img


def sheet(tiles, path, scale=6, pad=4):
    """A zoomed contact sheet over a checker, for eyeballing the set."""
    cols = 16
    rows = max(tiles) // cols + 1
    cw, ch = T * scale + pad, T * scale + pad
    W, Hh = cols * cw + pad, rows * ch + pad
    img = bytearray(W * Hh * 4)
    for y in range(Hh):
        for x in range(W):
            i = (y * W + x) * 4
            img[i:i + 4] = bytes((38, 38, 42, 255))
    for idx, tile in tiles.items():
        ox, oy = pad + (idx % cols) * cw, pad + (idx // cols) * ch
        for y in range(T * scale):
            for x in range(T * scale):
                r, g, b, a = tile.px[(y // scale) * T + x // scale]
                chk = 96 if ((x // 12 + y // 12) & 1) else 72
                t = a / 255
                i = ((oy + y) * W + ox + x) * 4
                img[i:i + 4] = bytes((int(r * t + chk * (1 - t)), int(g * t + chk * (1 - t)), int(b * t + chk * (1 - t)), 255))
    write_png(path, W, Hh, img)


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    tiles = build()
    if len(sys.argv) > 2 and sys.argv[1] == '--sheet':
        sheet(tiles, sys.argv[2])
        print('wrote', sys.argv[2])
    else:
        out = os.path.join(root, 'assets', 'block_atlas.png')
        write_png(out, SIZE, SIZE, compose(tiles))
        print('wrote', out, f'({len(tiles)} tiles)')
