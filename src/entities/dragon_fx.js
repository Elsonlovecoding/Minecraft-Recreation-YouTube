// entities/dragon_fx.js — Phase 20 (split out of dragon.js per the
// ARCHITECTURE size cap, the injection pattern): the dragon fight's visual
// effects, behaviour-free. The fight (entities/dragon.js) decides WHEN;
// this module owns the meshes — the crystal healing beam, the breath
// particle cloud, the death light show (radiating beams + terminal flash),
// and the dragon-egg trophy. Everything lives under the fight's one scene
// group, so dimension visibility comes for free.

import * as THREE from 'three';
import { DRAGON, END_CRYSTAL } from '../config.js';

const PX = 1 / 16;
const yUp = new THREE.Vector3(0, 1, 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createDragonFx({ root }) {
  // --- the crystal healing beam (one shared cylinder) -----------------------

  let beam = null;
  const beamFrom = new THREE.Vector3();
  const beamTo = new THREE.Vector3();
  const beamDir = new THREE.Vector3();

  function ensureBeam() {
    if (beam) return;
    beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: END_CRYSTAL.BEAM_COLOR, transparent: true,
        opacity: END_CRYSTAL.BEAM_OPACITY,
        blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false,
      }),
    );
    beam.visible = false;
    root.add(beam);
  }

  // Show the beam between two points, or hide it (`from` null).
  function updateHealBeam(from, to) {
    ensureBeam();
    if (!from) {
      beam.visible = false;
      return;
    }
    beamFrom.set(from.x, from.y, from.z);
    beamTo.set(to.x, to.y, to.z);
    beamDir.subVectors(beamTo, beamFrom);
    const length = beamDir.length();
    beam.visible = length > 0.01;
    if (!beam.visible) return;
    beam.position.lerpVectors(beamFrom, beamTo, 0.5);
    beam.quaternion.setFromUnitVectors(yUp, beamDir.normalize());
    beam.scale.set(END_CRYSTAL.BEAM_WIDTH, length, END_CRYSTAL.BEAM_WIDTH);
  }

  // --- breath particles (pooled additive purple points) ---------------------

  let breathPoints = null;
  let breathParticles = null;

  function ensureBreathPool() {
    if (breathPoints) return;
    const B = DRAGON.BREATH;
    breathParticles = Array.from({ length: B.PARTICLE_COUNT }, () => ({
      life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    }));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(new Float32Array(B.PARTICLE_COUNT * 3), 3),
    );
    const material = new THREE.PointsMaterial({
      color: 0xb05aff, size: B.PARTICLE_SIZE, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    breathPoints = new THREE.Points(geometry, material);
    breathPoints.frustumCulled = false;
    root.add(breathPoints);
  }

  // Feed the cloud while a breath burst runs: `dir` is the (unit) aim.
  function emitBreath(mouth, dir, dt) {
    ensureBreathPool();
    const B = DRAGON.BREATH;
    let toSpawn = Math.max(1, Math.round(dt * B.PARTICLE_COUNT / B.PARTICLE_LIFE));
    for (const p of breathParticles) {
      if (toSpawn === 0) break;
      if (p.life > 0) continue;
      toSpawn--;
      p.life = B.PARTICLE_LIFE * (0.6 + Math.random() * 0.4);
      p.x = mouth.x;
      p.y = mouth.y;
      p.z = mouth.z;
      const spread = 0.22;
      p.vx = (dir.x + (Math.random() - 0.5) * spread) * B.PARTICLE_SPEED;
      p.vy = (dir.y + (Math.random() - 0.5) * spread) * B.PARTICLE_SPEED;
      p.vz = (dir.z + (Math.random() - 0.5) * spread) * B.PARTICLE_SPEED;
    }
  }

  function updateBreath(dt) {
    if (!breathPoints) return;
    const attr = breathPoints.geometry.getAttribute('position');
    let visible = 0;
    for (let i = 0; i < breathParticles.length; i++) {
      const p = breathParticles[i];
      if (p.life > 0) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vy -= 1.5 * dt; // the cloud settles
        visible++;
      }
      // Dead particles park far below the void, never on screen.
      attr.setXYZ(i, p.x, p.life > 0 ? p.y : -1000, p.z);
    }
    attr.needsUpdate = true;
    breathPoints.visible = visible > 0;
  }

  function hideBreath() {
    if (breathPoints) breathPoints.visible = false;
  }

  // --- the death light show --------------------------------------------------

  let deathBeams = null;
  let flashMesh = null;

  function startDeathShow() {
    const D = DRAGON.DEATH;
    deathBeams = [];
    for (let i = 0; i < D.BEAM_COUNT; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: 0xfff6ff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      const dir = new THREE.Vector3(
        Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5,
      ).normalize();
      mesh.quaternion.setFromUnitVectors(yUp, dir);
      deathBeams.push({ mesh, dir, spin: (Math.random() - 0.5) * 0.6 });
      root.add(mesh);
    }
  }

  // `pos` is the dragon's body centre, `t` the 0..1 sequence fraction.
  function updateDeathShow(pos, t, dt) {
    const D = DRAGON.DEATH;
    const grow = clamp((t - 0.15) / 0.6, 0, 1);
    for (const b of deathBeams ?? []) {
      b.dir.applyAxisAngle(yUp, b.spin * dt);
      b.mesh.quaternion.setFromUnitVectors(yUp, b.dir);
      b.mesh.position.set(
        pos.x + b.dir.x * grow * D.BEAM_LENGTH * 0.5,
        pos.y + b.dir.y * grow * D.BEAM_LENGTH * 0.5,
        pos.z + b.dir.z * grow * D.BEAM_LENGTH * 0.5,
      );
      b.mesh.scale.set(
        D.BEAM_WIDTH, Math.max(0.01, grow * D.BEAM_LENGTH), D.BEAM_WIDTH,
      );
      b.mesh.material.opacity = 0.75 * grow;
    }
    // Terminal white-out over the last FLASH_SECONDS.
    const flashT = (t * D.SECONDS - (D.SECONDS - D.FLASH_SECONDS)) / D.FLASH_SECONDS;
    if (flashT > 0) {
      if (!flashMesh) {
        flashMesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
          }),
        );
        root.add(flashMesh);
      }
      flashMesh.position.set(pos.x, pos.y, pos.z);
      flashMesh.scale.setScalar(2 + flashT * 26);
      flashMesh.material.opacity = 0.9 * (1 - flashT);
    }
  }

  function endDeathShow() {
    for (const b of deathBeams ?? []) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
    deathBeams = null;
    if (flashMesh) {
      flashMesh.removeFromParent();
      flashMesh.geometry.dispose();
      flashMesh.material.dispose();
      flashMesh = null;
    }
  }

  // --- the dragon egg trophy ---------------------------------------------------

  let egg = null;

  // A decorative layered-box egg on the fountain column (this game has no
  // XP or egg item — documented deviation), with a generated speckled
  // shell texture in the generated-art tradition. `pos` is the base centre.
  function spawnEgg(pos) {
    if (egg) return;
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b0a12';
    ctx.fillRect(0, 0, 16, 16);
    for (let i = 0; i < 42; i++) {
      ctx.fillStyle = ['#241736', '#31204a', '#3d2b5e'][i % 3];
      ctx.fillRect(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16), 1, 1);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    // Painted in sRGB like every shipped sheet — without the tag the
    // renderer double-brightens it into washed-out grey.
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    egg = new THREE.Group();
    // Bottom-up silhouette layers: [width px, height px].
    const layers = [
      [2, 1], [6, 1], [10, 2], [12, 3], [14, 3], [12, 2],
      [8, 1], [6, 1], [4, 1], [2, 1],
    ];
    let y = 0;
    for (const [w, h] of layers) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w * PX, h * PX, w * PX), material,
      );
      mesh.position.y = (y + h / 2) * PX;
      egg.add(mesh);
      y += h;
    }
    egg.position.set(pos.x, pos.y, pos.z);
    root.add(egg);
  }

  return {
    updateHealBeam,
    emitBreath,
    updateBreath,
    hideBreath,
    startDeathShow,
    updateDeathShow,
    endDeathShow,
    spawnEgg,
  };
}
