// player/controller.js — Phase 5: the player's input and camera. The
// pointer-lock look, the key bindings, the first-person eye (bob, sneak/swim
// heights, auto-step easing, the sprint FOV kick) and the Phase 1 debug fly
// camera behind DEBUG.FLY_TOGGLE_CODE.
//
// The physics itself — PlayerBody and findSpawnPosition — moved to
// player/body.js in Phase 21 per the ARCHITECTURE size cap; both are
// re-exported here, so every caller since Phase 5 keeps working.

import * as THREE from 'three';
import { PLAYER, DEBUG, CREATIVE } from '../config.js';
import { PlayerBody, findSpawnPosition } from './body.js';
import { gamemode } from './gamemode.js';

// Re-exported: main.js and the node harness have imported both from here
// since Phase 5 (Phase 21 moved the bodies into player/body.js).
export { PlayerBody, findSpawnPosition };

// Keys the game consumes while pointer-locked. Their keydown default is
// prevented so browser shortcuts riding them (Ctrl+S save, Ctrl+D bookmark,
// Space scroll) can't fire mid-game. Reserved chords like Ctrl+W can't be
// prevented — the hint steers players toward double-tap sprint instead.
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
]);
// ---------------------------------------------------------------------------
// Controller — pointer-lock input and the first-person camera around a body
// ---------------------------------------------------------------------------

export function createPlayerController({ world, camera, canvas }) {
  const body = new PlayerBody(world, findSpawnPosition(world));
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const maxPitch = Math.PI / 2 - PLAYER.PITCH_MARGIN;
  let yaw = 0;
  let pitch = 0;
  let mode = 'walk'; // 'walk' | 'fly' (the old debug camera, behind a toggle)
  let sprintLatch = false;
  let lastForwardTap = -Infinity;
  let lastJumpTap = -Infinity; // creative: double-tap space toggles flight
  let eyeHeight = PLAYER.EYE_HEIGHT;
  let stepSmooth = 0; // camera offset easing out after an auto-step
  let bobPhase = 0;
  let bobIntensity = 0;
  const baseFov = camera.fov;
  let fov = camera.fov;
  let inputOverride = false; // dev/test scaffolding: accept input without lock
  const hint = document.getElementById('lock-hint');

  const locked = () => document.pointerLockElement === canvas || inputOverride;

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement === canvas) return;
    // Browsers enforce a ~1.3s cooldown after Esc exits the lock; the
    // request may reject (an unhandled promise rejection in Chromium).
    // Swallow it — the hint stays up and the next click retries.
    const req = canvas.requestPointerLock();
    if (req && typeof req.catch === 'function') req.catch(() => {});
  });

  document.addEventListener('pointerlockchange', () => {
    const isLocked = document.pointerLockElement === canvas;
    if (hint) hint.classList.toggle('hidden', isLocked);
    if (!isLocked) {
      keys.clear();
      sprintLatch = false;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (!locked()) return;
    yaw -= e.movementX * PLAYER.MOUSE_SENSITIVITY;
    pitch -= e.movementY * PLAYER.MOUSE_SENSITIVITY;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
  });

  document.addEventListener('keydown', (e) => {
    if (!locked()) return;
    if (GAME_KEYS.has(e.code) || e.code === DEBUG.FLY_TOGGLE_CODE) e.preventDefault();
    if (e.code === DEBUG.FLY_TOGGLE_CODE) {
      if (!e.repeat) toggleFly();
      return;
    }
    if (e.code === 'KeyW' && !e.repeat && !keys.has('KeyW')) {
      const now = performance.now() / 1000;
      if (now - lastForwardTap <= PLAYER.SPRINT_DOUBLE_TAP_SECONDS) sprintLatch = true;
      lastForwardTap = now;
    }
    // Creative flight (Phase 25): a second space tap inside the window
    // toggles it, like vanilla. Only a real press counts — the key must
    // have been released — so holding space to rise never re-toggles.
    if (
      e.code === 'Space' && !e.repeat && !keys.has('Space') &&
      mode === 'walk' && gamemode.creative
    ) {
      const now = performance.now() / 1000;
      if (now - lastJumpTap <= CREATIVE.DOUBLE_TAP_SECONDS) {
        setFlying(!body.flying);
        lastJumpTap = -Infinity; // a third tap starts a fresh pair
      } else {
        lastJumpTap = now;
      }
    }
    keys.add(e.code);
  });

  document.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'KeyW') sprintLatch = false;
  });

  // Creative flight on/off. Leaving flight lifts the body clear if the
  // noclip variant (CREATIVE.FLY_COLLIDES false) parked it inside terrain —
  // the debug camera's rule, for the same reason.
  function setFlying(on) {
    if (body.flying === !!on) return;
    body.flying = !!on;
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    body.fallDistance = 0;
    body._fallStartY = body.position.y;
    if (!body.flying) {
      let guard = 512;
      while (body.intersectsSolid() && guard-- > 0) body.position.y += 1;
      body.onGround = false;
    }
  }

  // Leaving creative grounds the player at once: survival has no flight, and
  // a stranded flier would hang in mid-air until they moved.
  gamemode.subscribe(() => {
    if (!gamemode.creative) setFlying(false);
  });

  function toggleFly() {
    mode = mode === 'walk' ? 'fly' : 'walk';
    body.velocity.x = 0;
    body.velocity.y = 0;
    body.velocity.z = 0;
    body.swimSprinting = false; // never carry the prone mode across a toggle
    body.sneaking = false; // fly never steps the body, so the flag would
                           // freeze — and interaction's use/place gate reads it
    if (mode === 'walk') {
      // Never re-enter walking inside terrain: lift to the nearest free spot
      let guard = 512;
      while (body.intersectsSolid() && guard-- > 0) body.position.y += 1;
    }
    body.onGround = false;
    body.fallDistance = 0;
    body._fallStartY = body.position.y;
  }

  // The old free-fly debug camera: no gravity, no collision
  function flyMove(dt) {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (keys.has('KeyW')) { mx += fx; mz += fz; }
    if (keys.has('KeyS')) { mx -= fx; mz -= fz; }
    if (keys.has('KeyD')) { mx += -fz; mz += fx; }
    if (keys.has('KeyA')) { mx -= -fz; mz -= fx; }
    if (keys.has('Space')) my += 1;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) my -= 1;
    const len = Math.hypot(mx, my, mz);
    if (len === 0) return;
    const fast = keys.has('ControlLeft') || keys.has('ControlRight');
    const speed = (fast ? DEBUG.FLY_SPEED_FAST : DEBUG.FLY_SPEED) / len;
    body.position.x += mx * speed * dt;
    body.position.y += my * speed * dt;
    body.position.z += mz * speed * dt;
  }

  function update(delta) {
    if (delta > 0) {
      if (mode === 'fly') {
        flyMove(delta);
        // Breath is meaningless while flying; recover it so the HUD meter
        // doesn't freeze mid-drained (body.step is not running). The lava
        // overlay flag clears too — the fly camera is a debug view.
        body.eyeInWater = false;
        body.eyeInLava = false;
        body.breath = Math.min(
          body.maxBreath,
          body.breath + delta * PLAYER.BREATH_REFILL_RATE,
        );
      } else {
        body.step(
          {
            forward: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
            strafe: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
            yaw,
            pitch,
            jump: keys.has('Space'),
            sneak: keys.has('ShiftLeft') || keys.has('ShiftRight'),
            sprint:
              keys.has('ControlLeft') || keys.has('ControlRight') || sprintLatch,
          },
          delta,
        );
        if (body.lastStepUp > 0) stepSmooth += body.lastStepUp;
      }
    }
    syncCamera(delta);
  }

  function syncCamera(delta) {
    const p = body.position;
    const B = PLAYER.VIEW_BOB;
    let bobX = 0;
    let bobY = 0;
    if (delta > 0) {
      // Eye eases between stand/sneak/swim heights; auto-steps ease out
      const eyeTarget = mode !== 'walk' ? PLAYER.EYE_HEIGHT
        : body.swimSprinting ? PLAYER.SWIM_EYE_HEIGHT
        : body.sneaking ? PLAYER.SNEAK_EYE_HEIGHT
        : PLAYER.EYE_HEIGHT;
      eyeHeight += (eyeTarget - eyeHeight) * (1 - Math.exp(-PLAYER.EYE_LERP_RATE * delta));
      stepSmooth *= Math.exp(-PLAYER.STEP_SMOOTH_RATE * delta);
      if (stepSmooth < 0.001) stepSmooth = 0;
      // View bob rides the actual ground speed — never airborne, in water
      // or in fly mode
      const active = mode === 'walk' && body.onGround && !body.swimming;
      const target = active ? Math.min(1, body.horizontalSpeed / PLAYER.WALK_SPEED) : 0;
      bobIntensity += (target - bobIntensity) * (1 - Math.exp(-B.FADE_RATE * delta));
      if (active) bobPhase += body.horizontalSpeed * B.CYCLES_PER_BLOCK * delta;
    }
    const t = bobPhase * Math.PI * 2;
    bobX = Math.sin(t) * B.AMP_X * bobIntensity;
    bobY = -Math.abs(Math.cos(t)) * B.AMP_Y * bobIntensity;
    const rx = Math.cos(yaw); // camera-right on the horizontal plane
    const rz = -Math.sin(yaw);
    camera.position.set(
      p.x + rx * bobX,
      p.y + eyeHeight - stepSmooth + bobY,
      p.z + rz * bobX,
    );
    camera.quaternion.setFromEuler(euler.set(pitch, yaw, 0, 'YXZ'));
    // Sprinting (on land or as a swim) widens the FOV a touch
    const fovTarget = baseFov +
      (mode === 'walk' && (body.sprinting || body.swimSprinting)
        ? PLAYER.SPRINT_FOV_BOOST : 0);
    if (delta > 0) fov += (fovTarget - fov) * (1 - Math.exp(-PLAYER.FOV_LERP_RATE * delta));
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  syncCamera(0); // put the camera at the spawn eye before the first frame

  return {
    update,
    body,
    get position() {
      return body.position;
    },
    get mode() {
      return mode;
    },
    get breath() {
      return body.breath;
    },
    get maxBreath() {
      return body.maxBreath;
    },
    toggleFly,
    // Creative flight (Phase 25): the state and its switch. `flying` also
    // drives the eye height (a flier stands upright) and the HUD badge.
    get flying() {
      return body.flying;
    },
    setFlying,
    // The look angles (Phase 18 — the enderman's stare check derives the
    // exact camera-forward vector from them; radians, YXZ like the camera).
    get yaw() {
      return yaw;
    },
    get pitch() {
      return pitch;
    },
    // Dev scaffolding (console/tests): aim the view; accept input without
    // pointer lock so a headless harness can drive the keys.
    setView(newYaw, newPitch) {
      yaw = newYaw;
      pitch = Math.max(-maxPitch, Math.min(maxPitch, newPitch));
    },
    debugForceInput(on) {
      inputOverride = !!on;
    },
    // main.js's pause check must not freeze a harness that drives input
    // without pointer lock (headless Chromium freezes rAF under real lock).
    get inputOverridden() {
      return inputOverride;
    },
  };
}
