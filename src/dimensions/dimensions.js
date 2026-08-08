// dimensions/dimensions.js — Phase 15: multiple worlds in memory, switched
// between. There is exactly ONE World instance (every system in the game
// closed over it at boot); a dimension switch swaps its backing store —
// chunk map, generator, scene group, streaming state (world.swapState) —
// and swaps each entity manager's live collections for the destination
// dimension's stored ones. The swapped-out dimension keeps everything in
// memory exactly as it was: chunks, meshes (in a hidden scene group),
// dropped items, mobs, arrows, furnace and chest state, pending fluid
// ticks — all frozen (never updated, never rendered) until it swaps back.
//
// Manager protocol: every manager passed in exposes
// swapDimensionState(stored) -> previousState, where `stored` is undefined
// on a dimension's first activation (the manager starts a fresh empty
// state) and previousState is opaque to this module.
//
// The sky: each dimension def may carry a fixed-sky profile (config
// NETHER_SKY) applied through dayNight.setDimensionSky — the overworld
// passes null and keeps the normal day/night cycle. Natural mob spawning
// is enabled per def (the placeholder Nether spawns nothing; its mobs
// arrive with the real Nether next session).

export function createDimensions({ world, dayNight, mobs, managers, defs }) {
  // key -> { def, worldState, managerStates } — state fields hold the
  // dimension's stores only while it is INACTIVE; the active dimension's
  // state lives in the world/managers themselves.
  const records = {};
  for (const [key, def] of Object.entries(defs)) {
    records[key] = { def, worldState: null, managerStates: null };
  }
  let active = 'overworld';
  records.overworld.def.group.visible = true;

  function switchTo(key) {
    if (key === active || !records[key]) return;
    const from = records[active];
    const to = records[key];

    // World guts: a first visit starts from an empty chunk map and the
    // dimension's own generator.
    const target = to.worldState ?? {
      chunks: new Map(),
      generator: to.def.makeGenerator(),
      scene: to.def.group,
      meshedCount: 0,
      pcx: null,
      pcz: null,
    };
    to.worldState = null;
    from.worldState = world.swapState(target);
    from.def.group.visible = false;
    to.def.group.visible = true;

    // Entity managers: store the outgoing dimension's collections, restore
    // (or freshly create) the incoming one's.
    const stored = to.managerStates ?? new Map();
    to.managerStates = null;
    const keep = new Map();
    for (const m of managers) keep.set(m, m.swapDimensionState(stored.get(m)));
    from.managerStates = keep;

    dayNight.setDimensionSky(to.def.sky ?? null);
    mobs.setNaturalSpawning(to.def.spawning !== false);
    active = key;
  }

  return {
    switchTo,
    get activeKey() {
      return active;
    },
  };
}
