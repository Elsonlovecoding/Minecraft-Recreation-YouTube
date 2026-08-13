// systems/commands.js — Phase 27: chat commands. ui/chat.js owns the input
// bar and hands finished lines here; this file owns what they DO. Split out
// of main.js at birth per the ARCHITECTURE size cap (the wiring took main
// past ~800). `notify` is injected (ui/hud.js showToast in the real game)
// so the dependency direction stays downward — systems never import UI.
//
// The one command that ships is /tp:
//   /tp <x> <z>      land somewhere SAFE at that column — the surface in
//                    open-sky worlds (floated to the sea surface over deep
//                    water, so a lake teleport swims instead of drowning in
//                    the dark), a scanned interior spot under the Nether's
//                    bedrock ceiling (the top-of-column rule would land ON
//                    the roof), a refusal over the End's void
//   /tp <x> <y> <z>  exactly there, no search
//
// Chunk data for the destination column generates synchronously (one
// chunk); the streaming ring re-centres and fills on the following frames.
// Tunables in config CHAT.

import { CHAT, OVERWORLD, NETHER, CHUNK } from '../config.js';
import { isSolid, isWater, isLava } from '../world/blocks.js';

export function createCommands({ world, player, dimensions, notify }) {
  function teleportTo(x, z, yArg = null) {
    let y = yArg;
    if (y === null) {
      if (dimensions.activeKey === 'nether') {
        for (let sy = NETHER.CEILING_Y - 8; sy > 8; sy--) {
          if (!isSolid(world.getBlock(x, sy, z))) continue;
          const above1 = world.getBlock(x, sy + 1, z);
          const above2 = world.getBlock(x, sy + 2, z);
          if (isSolid(above1) || isSolid(above2)) continue;
          if (isLava(above1) || isLava(above2)) continue;
          y = sy + 1;
          break;
        }
        if (y === null) {
          notify('No safe spot there');
          return;
        }
      } else {
        const top = world.getHighestSolidY(x, z);
        if (top < OVERWORLD.MIN_Y) {
          notify('Nothing to stand on there'); // the End's void
          return;
        }
        y = top + 1;
        if (isWater(world.getBlock(x, y, z))) y = OVERWORLD.SEA_LEVEL + 1;
      }
    }
    y = Math.max(OVERWORLD.MIN_Y + 1,
      Math.min(OVERWORLD.MIN_Y + CHUNK.HEIGHT - 2, y));
    const body = player.body;
    body.position.x = x + 0.5;
    body.position.y = y;
    body.position.z = z + 0.5;
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    notify(`Teleported to ${x}, ${Math.floor(y)}, ${z}`);
  }

  function handle(line) {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    if (cmd === '/tp') {
      if (parts.length !== 3 && parts.length !== 4) {
        notify('Usage: /tp <x> <z>  or  /tp <x> <y> <z>');
        return;
      }
      const nums = parts.slice(1).map(Number);
      if (nums.some((n) => !Number.isFinite(n))) {
        notify('Usage: /tp <x> <z> — coordinates must be numbers');
        return;
      }
      const L = CHAT.TELEPORT_LIMIT;
      const clampXZ = (v) => Math.max(-L, Math.min(L, Math.floor(v)));
      if (parts.length === 3) {
        teleportTo(clampXZ(nums[0]), clampXZ(nums[1]));
      } else {
        teleportTo(clampXZ(nums[0]), clampXZ(nums[2]), nums[1]);
      }
      return;
    }
    if (cmd.startsWith('/')) {
      notify(`Unknown command: ${cmd}`);
      return;
    }
    // No chat network exists in a single-player world — plain text just
    // gets a gentle pointer at the one thing chat is for.
    notify('Commands start with / — try /tp <x> <z>');
  }

  return { handle, teleportTo };
}
