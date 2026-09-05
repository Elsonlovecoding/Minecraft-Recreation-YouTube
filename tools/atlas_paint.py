"""The brushes behind tools/gen_block_atlas.py: a deterministic, tile-periodic
noise toolkit, a 16x16 RGBA Tile, and the material generators (speckle,
cobble, bark, planks, bricks, ore clusters, bevelled metal) every block tile
is painted with. Nothing here knows which tile it is drawing; the painters
in gen_block_atlas.py pick palettes and salts. Dependency-free Python 3."""
import math

T = 16               # tile edge
COLS = 16            # tiles per atlas row
SIZE = T * COLS      # atlas edge in pixels

# ---------------------------------------------------------------------------
# Noise toolkit (deterministic, periodic at the tile edge)
# ---------------------------------------------------------------------------

def H(x, y, s):
    """Integer hash -> [0, 1). The same (x, y, salt) is the same value on
    every machine, so the atlas is reproducible byte for byte."""
    h = (x * 374761393 + y * 668265263 + s * 2246822519) & 0xffffffff
    h = ((h ^ (h >> 13)) * 1274126177) & 0xffffffff
    h ^= h >> 16
    return h / 4294967296.0


def _fade(t):
    return t * t * (3 - 2 * t)


def vnoise(x, y, n, s, ax=1.0, ay=1.0):
    """Smooth value noise with an n x n lattice over the tile (n divides the
    period, so it wraps). ax/ay stretch the lattice: ay > 1 makes the grain
    run vertically (bark, deepslate), ax > 1 horizontally (planks)."""
    # The lattice count is rounded FIRST and the spacing derived from it, so
    # the field always wraps at the tile edge whatever the stretch.
    nx = max(1, round(n / ax))
    ny = max(1, round(n / ay))
    fx = (x + 0.5) * nx / T
    fy = (y + 0.5) * ny / T
    ix, iy = math.floor(fx), math.floor(fy)
    tx, ty = _fade(fx - ix), _fade(fy - iy)

    def L(i, j):
        return H(i % nx, j % ny, s)
    a = L(ix, iy) + (L(ix + 1, iy) - L(ix, iy)) * tx
    b = L(ix, iy + 1) + (L(ix + 1, iy + 1) - L(ix, iy + 1)) * tx
    return a + (b - a) * ty


def fbm(x, y, s, octaves=((4, 1.0), (8, 0.5), (16, 0.25)), ax=1.0, ay=1.0):
    total = 0.0
    weight = 0.0
    for k, (n, w) in enumerate(octaves):
        total += vnoise(x, y, n, s + k * 7919, ax, ay) * w
        weight += w
    return total / weight


def field(fn):
    """Evaluate fn(x, y) over the tile -> 256 floats, row-major."""
    return [fn(x, y) for y in range(T) for x in range(T)]


def ranked(vals):
    """Percentile-rank a field so a threshold IS a coverage fraction — the
    hand-picked shade proportions below come out exact instead of depending
    on how the noise happens to distribute."""
    order = sorted(range(len(vals)), key=lambda i: vals[i])
    out = [0.0] * len(vals)
    for r, i in enumerate(order):
        out[i] = (r + 0.5) / len(vals)
    return out


def pick(v, shades, weights=None):
    """Choose a shade by a 0..1 value against cumulative weights."""
    if weights is None:
        weights = [1] * len(shades)
    total = float(sum(weights))
    acc = 0.0
    for shade, w in zip(shades, weights):
        acc += w / total
        if v < acc:
            return shade
    return shades[-1]


def worley(n, s, jitter=0.9):
    """Periodic jittered-grid cell centres: n x n seeds over the tile.
    Returns a function (x, y) -> (d1, d2, seed_id, dx, dy) with the nearest
    and second-nearest centre distances and the offset to the nearest."""
    cell = T / n
    seeds = {}
    for j in range(n):
        for i in range(n):
            seeds[(i, j)] = ((i + 0.5 + (H(i, j, s) - 0.5) * jitter) * cell,
                             (j + 0.5 + (H(i, j, s + 1) - 0.5) * jitter) * cell)

    def at(x, y):
        px, py = x + 0.5, y + 0.5
        best = (1e9, 1e9, None, 0, 0)
        d1, d2, sid, bdx, bdy = best
        for j in range(-1, n + 1):
            for i in range(-1, n + 1):
                sx, sy = seeds[(i % n, j % n)]
                sx += (i // n) * T                      # the wrapped neighbour
                sy += (j // n) * T
                d = math.hypot(px - sx, py - sy)
                if d < d1:
                    d2, d1, sid, bdx, bdy = d1, d, (i % n, j % n), px - sx, py - sy
                elif d < d2:
                    d2 = d
        return d1, d2, sid, bdx, bdy
    return at


# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------

def mul(c, k):
    return tuple(max(0, min(255, int(round(v * k)))) for v in c)


def mix(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def ramp(base, ks):
    """A palette as brightness multiples of one base colour."""
    return [mul(base, k) for k in ks]


class Tile:
    def __init__(self):
        self.px = [(0, 0, 0, 0)] * (T * T)

    def set(self, x, y, c, a=255):
        if 0 <= x < T and 0 <= y < T:
            self.px[(y % T) * T + (x % T)] = (c[0], c[1], c[2], a)

    def get(self, x, y):
        return self.px[(y % T) * T + (x % T)]

    def fill(self, fn):
        """fn(x, y) -> rgb or (rgb, alpha) or None (leave transparent)."""
        for y in range(T):
            for x in range(T):
                v = fn(x, y)
                if v is None:
                    continue
                if len(v) == 2 and isinstance(v[0], tuple):
                    self.set(x, y, v[0], v[1])
                else:
                    self.set(x, y, v)
        return self

    def rect(self, x0, y0, x1, y1, c, a=255):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c, a)

    def sprite(self, rows, key, ox=0, oy=0):
        """Blit a string-art sprite: rows of characters, key char -> rgb
        (or (rgb, alpha)); '.' is transparent."""
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch == '.':
                    continue
                v = key[ch]
                if len(v) == 2 and isinstance(v[0], tuple):
                    self.set(ox + i, oy + j, v[0], v[1])
                else:
                    self.set(ox + i, oy + j, v)
        return self


# ---------------------------------------------------------------------------
# Material generators
# ---------------------------------------------------------------------------

def speckle(shades, weights, salt, octaves=((4, 1.0), (8, 0.6), (16, 0.45)), grain=0.0, ax=1.0, ay=1.0):
    """The workhorse: rank-quantised fbm plus optional per-texel grain,
    quantised to a short palette. Stone, dirt, sand, wool… are all this
    with different palettes and grain."""
    t = Tile()
    f = field(lambda x, y: fbm(x, y, salt, octaves, ax, ay) + (H(x, y, salt + 99) - 0.5) * grain)
    r = ranked(f)
    t.fill(lambda x, y: pick(r[y * T + x], shades, weights))
    return t


def cobble(stones, mortar, salt, n=4, mortar_width=0.85, bevel=0.10, grain=0.04):
    """Rounded stones on a jittered grid; mortar where two cells meet; each
    stone lit from the top-left and shaded to the bottom-right."""
    w = worley(n, salt)
    t = Tile()

    def px(x, y):
        d1, d2, sid, dx, dy = w(x, y)
        if d2 - d1 < mortar_width:
            return mul(mortar, 0.92 + H(x, y, salt + 3) * 0.16)
        base = stones[int(H(sid[0], sid[1], salt + 5) * len(stones))]
        light = 1.0 + bevel * (-(dx + dy) / max(1.0, d1 + 0.5)) * 0.9
        light += (H(x, y, salt + 7) - 0.5) * grain * 2
        # A slightly darker rim just inside the mortar.
        if d2 - d1 < mortar_width + 0.7:
            light -= 0.06
        return mul(base, light)
    return t.fill(px)


def bark(shades, weights, salt):
    return speckle(shades, weights, salt, octaves=((8, 1.0), (16, 0.55)), grain=0.10, ax=0.5, ay=4.0)


def ore_blobs(base_tile, mineral, salt, count=8, min_dist=3.6):
    """Angular mineral clusters, 3-7 texels each, one highlight texel at the
    upper-left of each cluster and a shadow texel at the lower-right."""
    main, hi, lo = mineral
    t = Tile()
    t.px = list(base_tile.px)
    seeds = []
    k = 0
    while len(seeds) < count and k < 400:
        sx = int(H(k, 11, salt) * T)
        sy = int(H(k, 13, salt) * T)
        k += 1
        ok = True
        for (ax_, ay_) in seeds:
            ddx = min(abs(sx - ax_), T - abs(sx - ax_))
            ddy = min(abs(sy - ay_), T - abs(sy - ay_))
            if math.hypot(ddx, ddy) < min_dist:
                ok = False
                break
        if ok:
            seeds.append((sx, sy))
    shapes = [
        [(0, 0), (1, 0), (0, 1), (1, 1)],
        [(0, 0), (1, 0), (2, 0), (1, 1)],
        [(0, 0), (0, 1), (1, 1), (1, 2)],
        [(0, 0), (1, 0), (0, 1), (1, 1), (2, 1)],
        [(0, 0), (1, 0), (1, 1), (1, 2), (2, 2)],
        [(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)],
        [(0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (1, 2)],
        [(0, 0), (1, 1)],
    ]
    for i, (sx, sy) in enumerate(seeds):
        shape = shapes[int(H(i, 17, salt) * len(shapes))]
        cells = [((sx + dx) % T, (sy + dy) % T) for dx, dy in shape]
        for (x, y) in cells:
            t.set(x, y, mul(main, 0.94 + H(x, y, salt + 21) * 0.12))
        # Highlight the texel nearest the top-left, shadow the bottom-right.
        first = min(cells, key=lambda c: (c[0] + c[1], c[0]))
        last = max(cells, key=lambda c: (c[0] + c[1], c[0]))
        t.set(first[0], first[1], hi)
        if len(cells) > 2:
            t.set(last[0], last[1], lo)
    return t


def bricks(face, mortar, salt, rows=2, brick_w=8, brick_h=8, offset=4, bevel=True):
    """Staggered courses of bricks with 1px mortar; each brick's top/left
    edge a touch lighter and bottom/right a touch darker."""
    t = Tile()

    def px(x, y):
        row = y // brick_h
        ly = y % brick_h
        shift = (row * offset) % brick_w
        lx = (x + shift) % brick_w
        bx = (x + shift) // brick_w
        if ly == brick_h - 1 or lx == brick_w - 1:
            return mul(mortar, 0.92 + H(x, y, salt + 1) * 0.16)
        base = face[int(H(bx, row, salt) * len(face))]
        k = 1.0 + (H(x, y, salt + 2) - 0.5) * 0.10
        if bevel:
            if ly == 0 or lx == 0:
                k += 0.08
            if ly == brick_h - 2 or lx == brick_w - 2:
                k -= 0.08
        return mul(base, k)
    return t.fill(px)


def planks(shades, seam, salt, joints=(11, 3, 8, 14)):
    """Four boards, grain running along them, end joints staggered."""
    t = Tile()
    f = field(lambda x, y: fbm(x, y, salt, ((4, 1.0), (8, 0.7), (16, 0.35)), ax=3.0, ay=0.5))
    r = ranked(f)

    def px(x, y):
        board = y // 4
        ly = y % 4
        if ly == 3 or x == joints[board]:
            return mul(seam, 0.92 + H(x, y, salt + 4) * 0.16)
        c = pick(r[y * T + x], shades, [2, 3, 3, 1])
        if ly == 0:
            c = mul(c, 1.06)
        return c
    return t.fill(px)


def bevel_block(inner, light, dark, salt, grain=0.03):
    """A cast-metal block: flat face, 1px lit top/left edge, 1px dark
    bottom/right edge, faint noise so the face is not one flat value."""
    t = Tile()

    def px(x, y):
        if x == 0 or y == 0:
            return light
        if x == T - 1 or y == T - 1:
            return dark
        k = 1.0 + (fbm(x, y, salt, ((4, 1.0), (8, 0.5))) - 0.5) * grain * 4
        if x == 1 or y == 1:
            k += 0.03
        if x == T - 2 or y == T - 2:
            k -= 0.04
        return mul(inner, k)
    return t.fill(px)
