// render/item_art.js — Phase 21: generated 16x16 item sprites for the items
// this project ships no texture for (the hoes, the shield, and the wooden
// utility items: door, trapdoor, sign, bed, item frame, flower pot).
//
// Generated art is the established pattern here — the crack random-walk, the
// arm skin, the portal swirl, the dragon-egg shell and the tinted potion
// bottles are all drawn in code rather than substituted with a wrong texture.
// These follow the same rule: 16x16, nearest-neighbour, painted with the
// vanilla palettes so a hotbar row of them reads as one set.
//
// Everything item-facing consumes them through entities/items.js
// (`itemVisualInfo` -> { generated: true }): dropped entities, the
// first-person hand and the HUD/screen icons all draw from the same canvas.

const CACHE = new Map(); // item name -> HTMLCanvasElement

// Vanilla-ish material palettes: [dark, mid, light].
const MATERIAL = {
  wooden: ['#4b3620', '#6b4f2a', '#9c7f4e'],
  stone: ['#4a4a4a', '#7f7f7f', '#a8a8a8'],
  iron: ['#8a8a8a', '#c8c8c8', '#eeeeee'],
  golden: ['#a07c11', '#e8c11c', '#fcee4b'],
  diamond: ['#1f9e91', '#3fd6c2', '#7ff3e6'],
};
const STICK = ['#4b3620', '#6b4f2a', '#8a6a3a'];
const PLANK = ['#5b421f', '#9c7f4e', '#b79a68'];

function newCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

const px = (ctx, color, x, y, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

// The shared diagonal handle every tool sprite uses (vanilla item art runs
// bottom-left to top-right).
function drawHandle(ctx) {
  for (let i = 0; i < 9; i++) {
    px(ctx, STICK[1], 3 + i, 12 - i);
    px(ctx, STICK[0], 3 + i, 13 - i);
  }
  px(ctx, STICK[2], 4, 11);
}

function drawHoe(tier) {
  const { canvas, ctx } = newCanvas();
  const [dark, mid, light] = MATERIAL[tier];
  drawHandle(ctx);
  // The head: a bar across the top with the blade turning down-left.
  px(ctx, mid, 9, 2, 5, 2);
  px(ctx, light, 9, 2, 5, 1);
  px(ctx, dark, 9, 3, 5, 1);
  px(ctx, mid, 8, 4, 2, 2);
  px(ctx, dark, 8, 5, 2, 1);
  return canvas;
}

function drawShield() {
  const { canvas, ctx } = newCanvas();
  // Body: a tapering wooden board with an iron rim and central boss.
  px(ctx, PLANK[0], 3, 1, 10, 11);
  px(ctx, PLANK[1], 4, 2, 8, 9);
  for (let i = 0; i < 3; i++) px(ctx, PLANK[2], 5 + i * 2, 2, 1, 9);
  // Taper the foot into a point.
  ctx.clearRect(3, 11, 1, 1);
  px(ctx, PLANK[0], 5, 12, 6, 1);
  px(ctx, PLANK[0], 6, 13, 4, 1);
  px(ctx, PLANK[0], 7, 14, 2, 1);
  // Iron rim + boss.
  px(ctx, MATERIAL.iron[1], 3, 1, 10, 1);
  px(ctx, MATERIAL.iron[0], 3, 2, 1, 9);
  px(ctx, MATERIAL.iron[0], 12, 2, 1, 9);
  px(ctx, MATERIAL.iron[2], 7, 5, 3, 3);
  px(ctx, MATERIAL.iron[0], 7, 7, 3, 1);
  return canvas;
}

function drawDoor() {
  const { canvas, ctx } = newCanvas();
  px(ctx, PLANK[0], 4, 1, 8, 14);
  px(ctx, PLANK[1], 5, 2, 6, 12);
  px(ctx, PLANK[2], 5, 2, 6, 1);
  px(ctx, PLANK[0], 5, 7, 6, 1);   // the panel split
  px(ctx, MATERIAL.iron[1], 9, 9, 1, 2); // handle
  return canvas;
}

function drawTrapdoor() {
  const { canvas, ctx } = newCanvas();
  px(ctx, PLANK[0], 1, 4, 14, 8);
  px(ctx, PLANK[1], 2, 5, 12, 6);
  for (let i = 0; i < 3; i++) px(ctx, PLANK[2], 2, 5 + i * 2, 12, 1);
  px(ctx, MATERIAL.iron[1], 3, 7, 2, 2);
  px(ctx, MATERIAL.iron[1], 11, 7, 2, 2);
  return canvas;
}

function drawSign() {
  const { canvas, ctx } = newCanvas();
  px(ctx, PLANK[0], 2, 2, 12, 8);
  px(ctx, PLANK[1], 3, 3, 10, 6);
  px(ctx, '#4b3620', 5, 5, 6, 1);
  px(ctx, '#4b3620', 5, 7, 4, 1);
  px(ctx, STICK[1], 7, 10, 2, 5); // the post
  px(ctx, STICK[0], 8, 10, 1, 5);
  return canvas;
}

function drawBed() {
  const { canvas, ctx } = newCanvas();
  px(ctx, '#8a2b2b', 1, 5, 14, 6);   // mattress
  px(ctx, '#b03535', 1, 5, 14, 3);
  px(ctx, '#e8e8e8', 2, 6, 4, 4);    // pillow
  px(ctx, '#c8c8c8', 2, 9, 4, 1);
  px(ctx, STICK[0], 1, 11, 2, 3);    // legs
  px(ctx, STICK[0], 13, 11, 2, 3);
  return canvas;
}

function drawItemFrame() {
  const { canvas, ctx } = newCanvas();
  px(ctx, PLANK[0], 2, 2, 12, 12);
  px(ctx, PLANK[2], 3, 3, 10, 10);
  px(ctx, '#d8cba8', 4, 4, 8, 8);    // the canvas backing
  px(ctx, PLANK[1], 4, 4, 8, 1);
  return canvas;
}

function drawFlowerPot() {
  const { canvas, ctx } = newCanvas();
  px(ctx, '#c8a86b', 4, 6, 8, 2);    // rim
  px(ctx, '#a98a52', 5, 8, 6, 6);    // body
  px(ctx, '#8a6f3f', 5, 12, 6, 2);
  px(ctx, '#3a2c14', 5, 8, 6, 1);    // soil
  return canvas;
}

// name -> painter. Everything else falls through to a shipped texture.
const PAINTERS = {
  shield: drawShield,
  oak_door: drawDoor,
  oak_trapdoor: drawTrapdoor,
  sign: drawSign,
  bed: drawBed,
  item_frame: drawItemFrame,
  flower_pot: drawFlowerPot,
};
for (const tier of Object.keys(MATERIAL)) {
  PAINTERS[`${tier}_hoe`] = () => drawHoe(tier);
}

export function hasGeneratedSprite(name) {
  return PAINTERS[name] !== undefined;
}

// The 16x16 canvas for a generated item sprite (cached). Callers may read it
// as an image source, extrude it into a slab, or turn it into a data URL.
export function generatedSpriteCanvas(name) {
  let canvas = CACHE.get(name);
  if (!canvas) {
    canvas = PAINTERS[name]();
    CACHE.set(name, canvas);
  }
  return canvas;
}
