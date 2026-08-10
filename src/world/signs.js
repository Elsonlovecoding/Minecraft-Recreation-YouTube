// world/signs.js — Phase 21: sign block entities. A placed sign carries up to
// SHAPES.SIGN.TEXT_LINES lines of text, entered right after placement (the
// vanilla flow) through a small modal panel this module owns, and rendered
// onto the sign's board face as a generated canvas texture.
//
// The block itself (post + board) meshes through the generic shape emitter
// like every other Phase 21 building block; only the TEXT lives here, as a
// per-position entity in the world/chests.js mould: a Map keyed by cell,
// swapped per dimension, torn down by the block-change listener.

import * as THREE from 'three';
import { SHAPES, UI } from '../config.js';
import { isSign, WALL_MOUNT_FACING, SIGN_IDS } from './blocks.js';

const SG = SHAPES.SIGN;
const key = (x, y, z) => `${x},${y},${z}`;
// Facing -> outward unit normal (the side the text reads from).
const NORMAL = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

// The board's centre in cell-local coordinates, and its half-extents, per
// sign kind. Mirrors the shapes registered in world/blocks.js.
function boardPlacement(id) {
  const facing = WALL_MOUNT_FACING[id];
  const [nx, nz] = NORMAL[facing];
  if (SIGN_IDS.wall.includes(id)) {
    const off = SG.WALL_OFFSET + SG.BOARD_THICK;
    return {
      facing,
      nx,
      nz,
      cx: 0.5 + nx * (0.5 - off),
      cy: (SG.WALL_BOTTOM + SG.WALL_TOP) / 2,
      cz: 0.5 + nz * (0.5 - off),
      height: SG.WALL_TOP - SG.WALL_BOTTOM,
    };
  }
  return {
    facing,
    nx,
    nz,
    cx: 0.5,
    cy: (SG.BOARD_BOTTOM + SG.BOARD_TOP) / 2,
    cz: 0.5,
    height: SG.BOARD_TOP - SG.BOARD_BOTTOM,
  };
}

// The text canvas for a sign's four lines — dark ink on transparency, so the
// plane reads as burnt-in lettering over the plank board.
function buildTextTexture(lines) {
  const S = SG.TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = '#20160c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rowHeight = S / (SG.TEXT_LINES + 0.5);
  ctx.font = `${Math.floor(rowHeight * 0.68)}px monospace`;
  lines.forEach((line, i) => {
    if (!line) return;
    ctx.fillText(line.slice(0, SG.TEXT_MAX_CHARS), S / 2, rowHeight * (i + 0.75), S * 0.94);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createSigns({ world, scene, canvas }) {
  let signs = new Map(); // "x,y,z" -> { x, y, z, lines, mesh }
  let editing = null;    // { cell, panel } while the text panel is open
  const geometry = new THREE.PlaneGeometry(1, 1);

  function disposeMesh(sign) {
    if (!sign.mesh) return;
    sign.mesh.removeFromParent();
    sign.mesh.material.map?.dispose();
    sign.mesh.material.dispose();
    sign.mesh = null;
  }

  // Build (or rebuild) the text plane sitting a hair off the board face.
  function refresh(sign) {
    disposeMesh(sign);
    const id = world.getBlock(sign.x, sign.y, sign.z);
    if (!isSign(id) || sign.lines.every((l) => !l)) return;
    const p = boardPlacement(id);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: buildTextTexture(sign.lines),
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    const lift = 0.012;
    mesh.position.set(
      sign.x + p.cx + p.nx * (SG.BOARD_THICK + lift),
      sign.y + p.cy,
      sign.z + p.cz + p.nz * (SG.BOARD_THICK + lift),
    );
    mesh.rotation.y = Math.atan2(p.nx, p.nz);
    mesh.scale.set(SG.BOARD_HALF * 2, p.height, 1);
    scene.add(mesh);
    sign.mesh = mesh;
  }

  function signAt(x, y, z) {
    const k = key(x, y, z);
    let sign = signs.get(k);
    if (!sign) {
      sign = { x, y, z, lines: new Array(SG.TEXT_LINES).fill(''), mesh: null };
      signs.set(k, sign);
    }
    return sign;
  }

  // The block listener: a sign that stops being a sign loses its text.
  function onBlockChanged(x, y, z, id) {
    const k = key(x, y, z);
    const sign = signs.get(k);
    if (!sign || isSign(id)) return;
    disposeMesh(sign);
    signs.delete(k);
    if (editing && editing.cell.x === x && editing.cell.y === y && editing.cell.z === z) {
      closeEditor(false);
    }
  }

  // --- the text panel --------------------------------------------------------

  let styleInjected = false;
  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      #mc-sign-editor {
        position: fixed; z-index: 40; left: 50%; top: 50%;
        transform: translate(-50%, -50%);
        background: rgba(20, 18, 14, 0.94); border: 3px solid #6b5a3a;
        padding: 14px 18px; border-radius: 4px;
        font: 15px/1.6 monospace; color: #e8e0cf; text-align: center;
      }
      #mc-sign-editor input {
        display: block; width: 260px; margin: 4px auto;
        background: #2c2519; border: 2px solid #4c4130; color: #f2ead8;
        font: 15px/1.4 monospace; padding: 3px 6px; text-align: center;
      }
      #mc-sign-editor button {
        margin-top: 10px; font: bold 14px monospace; padding: 5px 18px;
        background: #6b5a3a; color: #fff; border: 2px solid #8a7550; cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  const hint = () => document.getElementById('lock-hint');

  function closeEditor(relock = true) {
    if (!editing) return;
    editing.panel.remove();
    editing = null;
    hint()?.classList.remove('mc-suppressed');
    if (relock && canvas) {
      const req = canvas.requestPointerLock();
      if (req && typeof req.catch === 'function') req.catch(() => {});
    }
  }

  // Opens the four-line entry panel for a freshly placed sign. Pointer lock
  // releases while typing (the game pauses, exactly like opening a screen)
  // and is requested back on Done.
  function beginEdit(cell) {
    if (editing) closeEditor(false);
    injectStyle();
    if (document.pointerLockElement) document.exitPointerLock();
    hint()?.classList.add('mc-suppressed');
    const sign = signAt(cell.x, cell.y, cell.z);
    const panel = document.createElement('div');
    panel.id = 'mc-sign-editor';
    const title = document.createElement('div');
    title.textContent = 'Edit sign';
    panel.appendChild(title);
    const inputs = [];
    for (let i = 0; i < SG.TEXT_LINES; i++) {
      const input = document.createElement('input');
      input.maxLength = SG.TEXT_MAX_CHARS;
      input.value = sign.lines[i] ?? '';
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
      });
      panel.appendChild(input);
      inputs.push(input);
    }
    const done = document.createElement('button');
    done.textContent = 'Done';
    done.addEventListener('click', commit);
    panel.appendChild(done);
    document.body.appendChild(panel);
    editing = { cell, panel };
    inputs[0].focus();

    function commit() {
      sign.lines = inputs.map((el) => el.value.slice(0, SG.TEXT_MAX_CHARS));
      refresh(sign);
      closeEditor(true);
    }
  }

  // --- dimension swap --------------------------------------------------------

  function swapDimensionState(stored = null) {
    const prev = signs;
    for (const sign of prev.values()) if (sign.mesh) sign.mesh.visible = false;
    signs = stored ?? new Map();
    for (const sign of signs.values()) if (sign.mesh) sign.mesh.visible = true;
    return prev;
  }

  return {
    onBlockChanged,
    beginEdit,
    signAt,
    swapDimensionState,
    update() {}, // signs are static; the manager list expects the method
    get isEditing() {
      return editing !== null;
    },
    get count() {
      return signs.size;
    },
    // Test scaffolding: set a sign's text without the panel.
    setText(x, y, z, lines) {
      const sign = signAt(x, y, z);
      sign.lines = lines.slice(0, SG.TEXT_LINES);
      refresh(sign);
      return sign;
    },
  };
}

// Kept beside the panel styling so ui/hud.js and the lock hint agree.
export const SIGN_PANEL_ID = 'mc-sign-editor';
export const SIGN_UI = UI;
