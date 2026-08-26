// systems/persistence.js — world saving (the save pass). The design rests
// on two facts this project already had:
//
//   the world is SEED-DETERMINISTIC   so a save never stores terrain — only
//                                     the diff: chunks the player has
//                                     edited, RLE-compressed (a chunk is
//                                     mostly air and long stone runs, so
//                                     96KB of blocks shrinks to a few KB)
//   modified chunks are IMMORTAL      world.js has kept `chunk.modified`
//                                     data in memory forever since Phase 3,
//                                     so the in-memory set IS the complete
//                                     diff at any moment — saving is a walk,
//                                     never a search
//
// Storage is IndexedDB (localStorage is far too small for chunk data):
//   worlds   one record per world — id, name, seed, mode, timestamps and
//            the game state blob (clock, player, containers)
//   chunks   one row per modified chunk, keyed "wid/dim/cx,cz", carrying
//            the RLE bytes; an index on wid makes load-all and delete-all
//            one cursor walk
//
// CRASH SAFETY: every save is ONE readwrite transaction over both stores.
// IndexedDB transactions are atomic — a tab killed mid-save rolls the whole
// transaction back and the previous save stands untouched. There is no
// moment where a world is half-written.
//
// What deliberately does NOT save (regenerates or respawns instead): mobs,
// dropped items, in-flight arrows/pearls/eyes, dragon-fight progress and
// transient stat timers (burn/poison/effects). Vanilla-ish behaviour
// forgives all of these; block edits, inventories, chests, furnaces,
// brewing stands, the clock and the player survive.

import { SAVE } from '../config.js';
import { gamemode } from '../player/gamemode.js';

// ---------------------------------------------------------------------------
// RLE codec — [len lo, len hi, value] runs over the 98 304-byte block array.
// ---------------------------------------------------------------------------

export function rleEncode(blocks) {
  const out = [];
  let i = 0;
  while (i < blocks.length) {
    const v = blocks[i];
    let n = 1;
    while (n < 65535 && i + n < blocks.length && blocks[i + n] === v) n++;
    out.push(n & 255, n >> 8, v);
    i += n;
  }
  return Uint8Array.from(out);
}

export function rleDecodeInto(data, target) {
  let o = 0;
  for (let i = 0; i + 2 < data.length; i += 3) {
    const n = data[i] | (data[i + 1] << 8);
    target.fill(data[i + 2], o, o + n);
    o += n;
  }
  return o === target.length; // false = corrupt row; caller keeps generated
}

// ---------------------------------------------------------------------------
// IndexedDB plumbing (thin promise wrappers; no library).
// ---------------------------------------------------------------------------

const req = (r) => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

function openDb() {
  const r = indexedDB.open(SAVE.DB_NAME, 1);
  r.onupgradeneeded = () => {
    const db = r.result;
    db.createObjectStore('worlds', { keyPath: 'id' });
    const chunks = db.createObjectStore('chunks', { keyPath: 'k' });
    chunks.createIndex('wid', 'wid', { unique: false });
  };
  return req(r);
}

// A seed from the create-world form: a numeric string is used as-is (so a
// seed can be shared like the real game); any other text hashes to one;
// blank rolls randomly.
export function parseSeed(text) {
  const t = (text ?? '').trim();
  if (t === '') return (Math.random() * 0x7fffffff) | 0;
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

// ---------------------------------------------------------------------------
// The store: world registry + save/load/delete.
// ---------------------------------------------------------------------------

export function createPersistence() {
  let dbPromise = null;
  const db = () => (dbPromise ??= openDb());

  async function listWorlds() {
    const d = await db();
    const all = await req(d.transaction('worlds').objectStore('worlds').getAll());
    all.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    return all;
  }

  async function createWorld({ name, mode, seed }) {
    const d = await db();
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name: (name ?? '').trim() || 'New World',
      mode,
      seed,
      version: SAVE.VERSION,
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      state: null, // written by the first save
    };
    await req(d.transaction('worlds', 'readwrite').objectStore('worlds').put(record));
    return record;
  }

  // Everything a boot needs: the record plus every saved chunk, decoded no
  // further than its RLE bytes (they decode lazily, straight into each
  // chunk's block array, the moment that chunk generates).
  async function loadWorld(id) {
    const d = await db();
    const record = await req(d.transaction('worlds').objectStore('worlds').get(id));
    if (!record) return null;
    const chunksByDim = new Map();
    if (record.version === SAVE.VERSION) {
      const rows = await req(
        d.transaction('chunks').objectStore('chunks').index('wid').getAll(id),
      );
      for (const row of rows) {
        let dim = chunksByDim.get(row.dim);
        if (!dim) chunksByDim.set(row.dim, (dim = new Map()));
        dim.set(row.key, row.data);
      }
    }
    return { record, chunksByDim };
  }

  async function deleteWorld(id) {
    const d = await db();
    const tx = d.transaction(['worlds', 'chunks'], 'readwrite');
    tx.objectStore('worlds').delete(id);
    const index = tx.objectStore('chunks').index('wid');
    await new Promise((res, rej) => {
      const cur = index.openCursor(IDBKeyRange.only(id));
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return res();
        c.delete();
        c.continue();
      };
      cur.onerror = () => rej(cur.error);
    });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  // One atomic save: all modified-chunk rows plus the world record — with
  // two guards read from the SAME transaction before anything writes:
  //   deleted   the record is gone (deleted from another tab's world list):
  //             the save aborts rather than resurrecting a half-empty world
  //             (the deleted chunk rows are unrecoverable)
  //   stolen    the stored stamp is not the one THIS session last saw
  //             (another tab opened the same world and saved): that tab
  //             owns the world now — like the real game's "world is
  //             already open" lock — and this session's saves abort
  //             instead of interleaving two divergent histories.
  //             `expectedStamp` is what this session believes is stored:
  //             the stamp it loaded at boot, then its own after each
  //             successful save — a compare-and-swap on the record.
  async function writeSave(record, chunkRows, expectedStamp) {
    const d = await db();
    const tx = d.transaction(['worlds', 'chunks'], 'readwrite');
    const worlds = tx.objectStore('worlds');
    await new Promise((res, rej) => {
      const get = worlds.get(record.id);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing) return rej(new Error('world was deleted'));
        if ((existing.sessionId ?? null) !== expectedStamp) {
          return rej(new Error('world is open in another tab'));
        }
        const chunks = tx.objectStore('chunks');
        for (const row of chunkRows) chunks.put(row);
        worlds.put(record);
        res();
      };
      get.onerror = () => rej(get.error);
    });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error ?? new Error('save aborted'));
    });
  }

  // -------------------------------------------------------------------------
  // The runtime — bound to a live game once, drives restore and autosave.
  // -------------------------------------------------------------------------

  function createRuntime({
    record, saved, world, dimensions, player, stats, inventory, dayNight,
    chests, smelting, brewing, signs, frames, camera,
  }) {
    // This session's ownership stamp (see writeSave's guards). At boot
    // the record still carries the LAST session's stamp — that is exactly
    // what the first save expects to find; success swaps in this
    // session's own. If another tab saves in between, the stamps stop
    // matching and this session's saves abort instead of clobbering.
    let expectedStamp = record.sessionId ?? null;
    record.sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    // Container contents per dimension. The dimension-swap architecture
    // keeps inactive dimensions' container maps opaque inside
    // dimensions.js, so this runtime tracks its own per-dim snapshots:
    // refreshed for the OUTGOING dimension on every switch (before the
    // swap) and at save time for the ACTIVE one — between them, always
    // current. Saved-file contents apply on a dimension's FIRST activation
    // of the session (the swap keeps them live after that).
    const containersByDim = { ...(saved?.record?.state?.containers ?? {}) };
    const restoredDims = new Set();

    const collectContainers = () => ({
      chests: chests.serialize(),
      furnaces: smelting.serialize(),
      stands: brewing.serialize(),
      signs: signs.serialize(),
      frames: frames.serialize(),
    });
    const applyContainers = (dim) => {
      const c = containersByDim[dim];
      if (c) {
        chests.restore(c.chests);
        smelting.restore(c.furnaces);
        brewing.restore(c.stands);
        signs.restore(c.signs);
        frames.restore(c.frames);
      }
      restoredDims.add(dim);
    };

    dimensions.onBeforeSwitch((from) => {
      containersByDim[from] = collectContainers();
    });
    dimensions.onAfterSwitch((from, to) => {
      if (!restoredDims.has(to)) applyContainers(to);
    });

    // --- restore (called once at boot, before the prebuild) ---------------
    function restore() {
      applyContainers('overworld');
      const s = saved?.record?.state;
      if (!s) return;
      dayNight.setTimeOfDay(s.timeOfDay ?? 0.3);
      dayNight.setDay(s.day ?? 0);
      stats.restore(s.stats);
      inventory.restore(s.inventory);
      const p = s.player;
      if (!p) return;
      if (p.dim && p.dim !== 'overworld') dimensions.switchTo(p.dim);
      const body = player.body;
      body.position.x = p.x;
      body.position.y = p.y;
      body.position.z = p.z;
      body.velocity.x = 0;
      body.velocity.y = 0;
      body.velocity.z = 0;
      body._fallStartY = p.y; // no phantom fall damage from the restore
      player.setView(p.yaw ?? 0, p.pitch ?? 0);
      // The prebuild that follows reads the camera, which the controller
      // only syncs on the first frame — seed it so the synchronous boot
      // ring builds around the RESTORED spot, not the seed spawn.
      camera.position.set(p.x, p.y + 1.6, p.z);
    }

    // --- save ---------------------------------------------------------------
    let saving = false;
    let lastError = null;
    let saveCount = 0;

    function snapshotState() {
      containersByDim[dimensions.activeKey] = collectContainers();
      const body = player.body;
      const view = player.getView();
      return {
        version: SAVE.VERSION,
        timeOfDay: dayNight.timeOfDay,
        day: dayNight.dayIndex,
        player: {
          dim: dimensions.activeKey,
          x: body.position.x,
          y: body.position.y,
          z: body.position.z,
          yaw: view.yaw,
          pitch: view.pitch,
        },
        stats: stats.serialize(),
        inventory: inventory.serialize(),
        containers: containersByDim,
      };
    }

    function snapshotChunks() {
      const rows = [];
      const maps = dimensions.chunkMaps();
      for (const [dim, chunks] of Object.entries(maps)) {
        if (!chunks) continue;
        for (const chunk of chunks.values()) {
          if (!chunk.modified) continue;
          rows.push({
            k: `${record.id}/${dim}/${chunk.cx},${chunk.cz}`,
            wid: record.id,
            dim,
            key: `${chunk.cx},${chunk.cz}`,
            data: rleEncode(chunk.blocks),
          });
        }
      }
      return rows;
    }

    async function doSave() {
      saving = true;
      try {
        record.state = snapshotState();
        record.mode = gamemode.current; // pause-menu switches persist
        record.version = SAVE.VERSION;  // an old-format world upgrades on
        record.lastPlayed = Date.now(); // its first save in the new format
        await writeSave(record, snapshotChunks(), expectedStamp);
        expectedStamp = record.sessionId; // the swap took — we own the world
        saveCount++;
        lastError = null;
        return true;
      } catch (e) {
        lastError = e;
        return false;
      } finally {
        saving = false;
      }
    }

    // Saves SERIALIZE, never drop: a save requested while another is in
    // flight runs after it, with a FRESH snapshot — the earlier version
    // returned false when busy, and a caller's edits made between the
    // running save's snapshot and its commit silently missed the disk
    // (the loading screen made this real: the 20s autosave could still be
    // committing when a pause-save or tab-hide save arrived). The chain
    // never rejects — doSave reports failure through its return value.
    let chain = Promise.resolve(true);
    function save() {
      const p = chain.then(doSave);
      chain = p.catch(() => false);
      return p;
    }

    // Autosave: the interval, the pause edge, and the two leave-the-tab
    // signals (interval alone would lose up to AUTOSAVE_SECONDS of play on
    // a close; visibilitychange fires reliably on tab close and mobile
    // backgrounding, pagehide on navigation).
    const interval = setInterval(save, SAVE.AUTOSAVE_SECONDS * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') save();
    });
    window.addEventListener('pagehide', () => save());

    let wasPaused = false;
    function notifyPaused(paused) {
      if (paused && !wasPaused) save();
      wasPaused = paused;
    }

    return {
      restore,
      save,
      notifyPaused,
      dispose: () => clearInterval(interval),
      get stats() {
        return { saveCount, saving, lastError: lastError && String(lastError) };
      },
    };
  }

  // The chunk-restore hook world.js calls on every freshly generated chunk:
  // if the save carries edits for it, they overwrite the generated blocks
  // in place (no allocation — the RLE decodes straight into the array).
  function makeChunkRestorer(saved, activeDim) {
    const byDim = saved.chunksByDim;
    return (chunk) => {
      const dim = byDim.get(activeDim());
      const data = dim?.get(`${chunk.cx},${chunk.cz}`);
      if (!data) return;
      if (rleDecodeInto(data, chunk.blocks)) {
        chunk.modified = true;
        chunk._lightMeta = null;
      }
    };
  }

  return {
    listWorlds, createWorld, loadWorld, deleteWorld,
    createRuntime, makeChunkRestorer,
  };
}
