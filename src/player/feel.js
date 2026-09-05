// player/feel.js — the camera's physical reactions: the "juice" layer.
//
// The controller places the camera exactly at the eye; this module owns
// the small, brief departures from that — the roll of a hit, the dip of a
// landing, the forward punch of a swing that connects, the shiver of a
// block giving way — so that things which happen to the body are felt in
// the view and not only read off the HUD. Everything is a spring-damped
// impulse (nothing is set and held), so a stack of hits can only ever add
// energy that drains on its own, and MAX_ROLL/MAX_DIP clamp the sum.
//
// Channels (all zero at rest, all in the camera's own frame):
//   roll     radians about the view axis — hurt() rolls toward the attacker
//   dip      blocks, vertical — land() and breakBlock() push it down
//   punch    blocks, along the view — hit() nudges forward
//   fovKick  degrees of extra FOV — hit() widens, eases back exponentially
//   shake    trauma 0..1 — hurt() adds it; yaw/pitch jitter scales with trauma²
//
// The controller calls update(dt) once per frame and reads the getters when
// it composes the camera. Hooks: stats.damage (hurt), controller.update
// (land, from body.lastLanding), combat.attack (hit), interaction.finishBreak
// (breakBlock). Tunables live in PLAYER.FEEL.
import { PLAYER } from '../config.js';

export function createFeel() {
  const F = PLAYER.FEEL;
  const TAU = Math.PI * 2;
  let roll = 0;
  let rollV = 0;
  let dip = 0;
  let dipV = 0;
  let punch = 0;
  let punchV = 0;
  let fovKick = 0;
  let trauma = 0;
  let shakeClock = 0;
  let shakeYaw = 0;
  let shakePitch = 0;
  let blindSide = 1; // alternates so undirected hits do not always roll one way

  // One step of a damped spring toward zero, integrated EXACTLY (the
  // closed-form underdamped solution), so the motion is the same at 30 fps
  // as at 144 and a big frame never overshoots. The natural frequency and
  // damping ratio are the tunables, so config reads as "how fast" and "how
  // bouncy" rather than as k and c.
  function spring(x, v, dt, freqHz, zeta) {
    const w = TAU * freqHz;
    const z = Math.min(zeta, 0.999);
    const wd = w * Math.sqrt(1 - z * z);
    const e = Math.exp(-z * w * dt);
    const c = Math.cos(wd * dt);
    const s = Math.sin(wd * dt);
    const nx = e * (x * c + ((v + z * w * x) / wd) * s);
    const nv = e * (v * c - ((w * w * x + z * w * v) / wd) * s);
    return [nx, nv];
  }

  function update(dt) {
    if (!(dt > 0)) return;
    [roll, rollV] = spring(roll, rollV, dt, F.ROLL_FREQ, F.ROLL_DAMPING);
    [dip, dipV] = spring(dip, dipV, dt, F.DIP_FREQ, F.DIP_DAMPING);
    [punch, punchV] = spring(punch, punchV, dt, F.DIP_FREQ, F.DIP_DAMPING);
    fovKick *= Math.exp(-F.KICK_DECAY * dt);
    if (fovKick < 0.01) fovKick = 0;
    if (Math.abs(roll) > F.MAX_ROLL) roll = Math.sign(roll) * F.MAX_ROLL;
    if (Math.abs(dip) > F.MAX_DIP) dip = Math.sign(dip) * F.MAX_DIP;
    // Trauma drains linearly; the jitter it drives is two incommensurate
    // sines per axis, so it reads as a tremble rather than a wobble.
    trauma = Math.max(0, trauma - dt / F.SHAKE_SECONDS);
    const s = trauma * trauma;
    if (s > 0) {
      shakeClock += dt;
      const t = shakeClock;
      shakeYaw = F.SHAKE_YAW * s * (Math.sin(t * 61.3) * 0.6 + Math.sin(t * 37.7 + 1.3) * 0.4);
      shakePitch = F.SHAKE_PITCH * s * (Math.sin(t * 53.1 + 0.7) * 0.6 + Math.sin(t * 29.3) * 0.4);
    } else {
      shakeYaw = 0;
      shakePitch = 0;
    }
    // Settle the tail so a still camera is exactly still.
    if (Math.abs(roll) < 1e-4 && Math.abs(rollV) < 1e-3) { roll = 0; rollV = 0; }
    if (Math.abs(dip) < 1e-4 && Math.abs(dipV) < 1e-3) { dip = 0; dipV = 0; }
    if (Math.abs(punch) < 1e-4 && Math.abs(punchV) < 1e-3) { punch = 0; punchV = 0; }
  }

  return {
    update,
    // A hit on the player. (dirX, dirZ) is the knockback direction — the
    // way the player is thrown, i.e. AWAY from the attacker — and yaw is
    // the view; the roll leans toward the side the blow came from, the
    // vanilla damage tilt. Fall, fire and drowning damage have no
    // direction and get a smaller roll that alternates sides.
    hurt(dirX = 0, dirZ = 0, yaw = 0) {
      const len = Math.hypot(dirX, dirZ);
      if (len > 1e-6) {
        // Camera-right on the ground plane is (cos yaw, -sin yaw); the
        // attacker stands at -dir.
        const side = (-dirX / len) * Math.cos(yaw) + (-dirZ / len) * -Math.sin(yaw);
        rollV += F.HURT_ROLL * (side >= 0 ? 1 : -1) * Math.min(1, 0.4 + Math.abs(side));
      } else {
        blindSide = -blindSide;
        rollV += F.HURT_ROLL_BLIND * blindSide;
      }
      trauma = Math.min(1, trauma + F.HURT_TRAUMA);
    },
    // Feet meeting the ground after `fall` blocks: a hop barely registers,
    // a real drop plants the view.
    land(fall) {
      const k = Math.max(F.LAND_MIN_FRACTION, Math.min(1, fall / F.LAND_FULL_FALL));
      dipV -= F.LAND_DIP * k;
    },
    // A melee swing that connected: a forward nudge and an FOV kick, both
    // bigger for a critical.
    hit(crit = false) {
      const k = crit ? F.CRIT_SCALE : 1;
      punchV += F.HIT_PUNCH * k;
      fovKick = Math.max(fovKick, F.HIT_FOV_KICK * k);
    },
    // The block under the crosshair coming loose.
    breakBlock() {
      dipV -= F.BREAK_DIP;
    },
    get roll() { return roll; },
    get dip() { return dip; },
    get punch() { return punch; },
    get fovKick() { return fovKick; },
    get shakeYaw() { return shakeYaw; },
    get shakePitch() { return shakePitch; },
    get trauma() { return trauma; },
  };
}
