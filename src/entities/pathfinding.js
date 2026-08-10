// entities/pathfinding.js — Phase 12: A* over walkable block columns.
// SPEC rules: mobs step up 1 block, never path over drops deeper than
// MOBS.PATH.MAX_DROP (3), avoid lava (and contact-damage floors like
// cactus), and route around obstacles. The search is BUDGETED — at most
// MOBS.PATH.NODE_BUDGET expansions per call, so one findPath can never
// stall a frame; when the budget runs out (or the goal is walled off) the
// path to the closest-approach node comes back instead, which keeps a mob
// moving in the right direction while the next repath refines it.
//
// Pure logic over a getBlock function — node tests drive it directly.
// Cells are FEET cells: a mob stands at (x, y, z) when the block below its
// feet is solid ground and `clearance` cells from the feet up are passable.

import { MOBS } from '../config.js';
import { blockDef, isSolid, isLava, MAX_BOX_TOP } from '../world/blocks.js';

// A cell a mob's body can occupy (feet or head): no collision box, no lava.
function passable(getBlock, x, y, z) {
  const id = getBlock(x, y, z);
  return !isSolid(id) && !isLava(id);
}

// A cell a mob can stand in: solid, harmless floor below + body clearance.
export function standableAt(getBlock, x, y, z, clearance = 2) {
  const floorId = getBlock(x, y - 1, z);
  const floor = blockDef(floorId);
  if (!floor.solid || floor.damagesOnContact) return false;
  // Phase 21: blocks whose collision reaches above their own cell (fences,
  // walls, gates) are never a floor — a mob "standing" there would be
  // embedded in the post, which is exactly what makes fences mob-proof.
  if (MAX_BOX_TOP[floorId] > 1) return false;
  for (let i = 0; i < clearance; i++) {
    if (!passable(getBlock, x, y + i, z)) return false;
  }
  return true;
}

// Binary min-heap of node indices ordered by an f-score array.
class Heap {
  constructor(score) {
    this.score = score;
    this.items = [];
  }

  push(item) {
    const { items, score } = this;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (score.get(items[parent]) <= score.get(items[i])) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop() {
    const { items, score } = this;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && score.get(items[l]) < score.get(items[m])) m = l;
        if (r < items.length && score.get(items[r]) < score.get(items[m])) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.items.length;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// A* from `start` to `goal` (both { x, y, z } feet cells, floats accepted —
// they floor). Options: { clearance, nodeBudget, maxDrop, maxRange }.
// Returns an array of { x, y, z } cell steps EXCLUDING the start cell —
// empty when the start already is (or best-effort reaches) the goal cell —
// or null when no move at all was found. The last step is the goal when it
// was reached, otherwise the reachable cell nearest the goal.
export function findPath(getBlock, start, goal, options = {}) {
  const clearance = options.clearance ?? 2;
  const nodeBudget = options.nodeBudget ?? MOBS.PATH.NODE_BUDGET;
  const maxDrop = options.maxDrop ?? MOBS.PATH.MAX_DROP;
  const maxRange = options.maxRange ?? MOBS.PATH.MAX_RANGE;
  const sx = Math.floor(start.x);
  const sy = Math.floor(start.y);
  const sz = Math.floor(start.z);
  const gx = Math.floor(goal.x);
  const gy = Math.floor(goal.y);
  const gz = Math.floor(goal.z);

  const key = (x, y, z) => `${x},${y},${z}`;
  const heuristic = (x, y, z) =>
    Math.hypot(x - gx, z - gz) + Math.abs(y - gy) * MOBS.PATH.HEURISTIC_Y_WEIGHT;

  const startKey = key(sx, sy, sz);
  const gScore = new Map([[startKey, 0]]);
  const fScore = new Map([[startKey, heuristic(sx, sy, sz)]]);
  const cameFrom = new Map();
  const cells = new Map([[startKey, { x: sx, y: sy, z: sz }]]);
  const open = new Heap(fScore);
  open.push(startKey);
  const inOpen = new Set([startKey]);
  let bestKey = startKey;
  let bestH = heuristic(sx, sy, sz);
  let expansions = 0;

  const tryNeighbor = (fromKey, fromCell, x, y, z, cost) => {
    const nKey = key(x, y, z);
    const tentative = gScore.get(fromKey) + cost;
    if (tentative >= (gScore.get(nKey) ?? Infinity)) return;
    cameFrom.set(nKey, fromKey);
    gScore.set(nKey, tentative);
    const h = heuristic(x, y, z);
    fScore.set(nKey, tentative + h);
    cells.set(nKey, { x, y, z });
    if (h < bestH) {
      bestH = h;
      bestKey = nKey;
    }
    if (!inOpen.has(nKey)) {
      inOpen.add(nKey);
      open.push(nKey);
    }
  };

  let goalKey = null;
  while (open.size > 0 && expansions < nodeBudget) {
    const currentKey = open.pop();
    inOpen.delete(currentKey);
    const c = cells.get(currentKey);
    if (c.x === gx && c.y === gy && c.z === gz) {
      goalKey = currentKey;
      break;
    }
    expansions++;
    if (Math.hypot(c.x - sx, c.y - sy, c.z - sz) > maxRange) continue;

    for (const [dx, dz] of DIRS) {
      const nx = c.x + dx;
      const nz = c.z + dz;
      // Step up 1: needs extra headroom over the CURRENT cell to lift the
      // body, then a standable cell one higher.
      if (
        passable(getBlock, c.x, c.y + clearance, c.z) &&
        standableAt(getBlock, nx, c.y + 1, nz, clearance)
      ) {
        tryNeighbor(currentKey, c, nx, c.y + 1, nz, MOBS.PATH.STEP_UP_COST);
      }
      // Level walk.
      if (standableAt(getBlock, nx, c.y, nz, clearance)) {
        tryNeighbor(currentKey, c, nx, c.y, nz, 1);
        continue;
      }
      // Walk off a ledge: the target column must be open at travel height,
      // and land on the first floor within maxDrop. Any lava or solid block
      // interrupting the drop column rejects it.
      if (!passable(getBlock, nx, c.y, nz) || !passable(getBlock, nx, c.y + 1, nz)) {
        continue;
      }
      for (let drop = 1; drop <= maxDrop; drop++) {
        const ny = c.y - drop;
        if (standableAt(getBlock, nx, ny, nz, clearance)) {
          tryNeighbor(currentKey, c, nx, ny, nz, 1 + drop * MOBS.PATH.DROP_COST_PER_BLOCK);
          break;
        }
        if (!passable(getBlock, nx, ny, nz)) break; // lava/solid: not a landing
      }
    }
  }

  const endKey = goalKey ?? (bestKey !== startKey ? bestKey : null);
  if (endKey === null) return null;
  const path = [];
  let k = endKey;
  while (k !== startKey) {
    path.push(cells.get(k));
    k = cameFrom.get(k);
  }
  path.reverse();
  return path;
}
