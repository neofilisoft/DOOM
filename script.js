(function () {
"use strict";

/* ============ Assets ============ */
const IMAGES = JSON.parse(document.getElementById("assets-images").textContent);
const AUDIO = JSON.parse(document.getElementById("assets-audio").textContent);

/* ============ Maze generation — ported from src/hellverdict/maze.ts ============ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeOdd(v) { return v % 2 === 0 ? v + 1 : v; }

function generateMaze(requested, seed) {
  const width = makeOdd(Math.max(7, requested));
  const depth = width;
  const walls = new Uint8Array(width * depth);
  walls.fill(1);
  const rand = mulberry32(seed);
  const idx = (x, z) => z * width + x;
  const inb = (x, z) => x > 0 && z > 0 && x < width - 1 && z < depth - 1;

  const dirs = [[0, 2], [2, 0], [0, -2], [-2, 0]];
  const stack = [{ x: 1, z: 1 }];
  walls[idx(1, 1)] = 0;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const avail = [];
    for (const d of dirs) {
      const nx = cur.x + d[0];
      const nz = cur.z + d[1];
      if (!inb(nx, nz)) continue;
      if (walls[idx(nx, nz)]) avail.push(d);
    }
    if (!avail.length) { stack.pop(); continue; }
    const d = avail[(rand() * avail.length) | 0];
    const nx = cur.x + d[0];
    const nz = cur.z + d[1];
    walls[idx(cur.x + d[0] / 2, cur.z + d[1] / 2)] = 0;
    walls[idx(nx, nz)] = 0;
    stack.push({ x: nx, z: nz });
  }

  const removals = (width * depth) / 5;
  for (let i = 0; i < removals; i++) {
    const x = 2 + ((rand() * (width - 4)) | 0);
    const z = 2 + ((rand() * (depth - 4)) | 0);
    if (!walls[idx(x, z)]) continue;
    let n = 0;
    if (!walls[idx(x - 1, z)]) n++;
    if (!walls[idx(x + 1, z)]) n++;
    if (!walls[idx(x, z - 1)]) n++;
    if (!walls[idx(x, z + 1)]) n++;
    if (n >= 2) walls[idx(x, z)] = 0;
  }

  const roomCount = Math.max(2, ((width * depth) / 400) | 0);
  for (let r = 0; r < roomCount; r++) {
    const rw = 3 + ((rand() * 3) | 0);
    const rh = 3 + ((rand() * 3) | 0);
    const sx = 2 + ((rand() * (width - rw - 4)) | 0);
    const sz = 2 + ((rand() * (depth - rh - 4)) | 0);
    for (let x = sx; x < sx + rw; x++) for (let z = sz; z < sz + rh; z++) walls[idx(x, z)] = 0;
  }

  const open = [];
  const deadEnds = [];
  for (let z = 0; z < depth; z++) {
    for (let x = 0; x < width; x++) {
      if (walls[idx(x, z)]) continue;
      open.push({ x, z });
      let n = 0;
      if (x > 0 && !walls[idx(x - 1, z)]) n++;
      if (x < width - 1 && !walls[idx(x + 1, z)]) n++;
      if (z > 0 && !walls[idx(x, z - 1)]) n++;
      if (z < depth - 1 && !walls[idx(x, z + 1)]) n++;
      if (n === 1) deadEnds.push({ x, z });
    }
  }

  return { width, depth, walls, open, deadEnds, start: open[0] || { x: 1, z: 1 } };
}

/* ============ Grid physics — ported from src/engine/physics/physics.ts ============ */
class GridPhysics {
  constructor() {
    this.cellSize = 2.5;
    this.width = 0;
    this.depth = 0;
    this.walls = new Uint8Array(0);
  }
  setGrid(width, depth, walls, cellSize) {
    this.width = width; this.depth = depth; this.walls = walls; this.cellSize = cellSize;
  }
  idx(x, z) { return z * this.width + x; }
  isWall(cx, cz) {
    if (cx < 0 || cz < 0 || cx >= this.width || cz >= this.depth) return true;
    return this.walls[this.idx(cx, cz)] === 1;
  }
  worldToCell(x, z) { return { x: Math.round(x / this.cellSize), z: Math.round(z / this.cellSize) }; }
  cellToWorld(cx, cz, y) { return { x: cx * this.cellSize, y: y || 0, z: cz * this.cellSize }; }
  isWalkable(cx, cz) { return !this.isWall(cx, cz); }
  collideCircle(x, z, radius) {
    // Resolve against solid cells (walls[i]===1). Wall boxes are centered on cell
    // grid and sized CELL×CELL, matching the visual InstancedMesh walls.
    // Multiple passes prevent tunneling / pushing into a neighboring wall.
    let px = x, pz = z;
    for (let pass = 0; pass < 4; pass++) {
      const minX = Math.floor((px - radius) / this.cellSize - 0.5);
      const maxX = Math.floor((px + radius) / this.cellSize + 0.5);
      const minZ = Math.floor((pz - radius) / this.cellSize - 0.5);
      const maxZ = Math.floor((pz + radius) / this.cellSize + 0.5);
      let moved = false;
      for (let cz = minZ; cz <= maxZ; cz++) {
        for (let cx = minX; cx <= maxX; cx++) {
          if (!this.isWall(cx, cz)) continue;
          const left = cx * this.cellSize - this.cellSize * 0.5;
          const right = cx * this.cellSize + this.cellSize * 0.5;
          const back = cz * this.cellSize - this.cellSize * 0.5;
          const front = cz * this.cellSize + this.cellSize * 0.5;
          const nearestX = Math.max(left, Math.min(px, right));
          const nearestZ = Math.max(back, Math.min(pz, front));
          let dx = px - nearestX, dz = pz - nearestZ;
          const d2 = dx * dx + dz * dz;
          if (d2 >= radius * radius) continue;
          if (d2 < 1e-8) {
            const dl = px - left, dr = right - px, db = pz - back, df = front - pz;
            const m = Math.min(dl, dr, db, df);
            if (m === dl) px = left - radius;
            else if (m === dr) px = right + radius;
            else if (m === db) pz = back - radius;
            else pz = front + radius;
            moved = true;
            continue;
          }
          const d = Math.sqrt(d2);
          const push = (radius - d) / d;
          px += dx * push; pz += dz * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x: px, z: pz };
  }
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const step = this.cellSize * 0.12;
    let dist = 0;
    while (dist <= maxDist) {
      const x = ox + dx * dist, y = oy + dy * dist, z = oz + dz * dist;
      if (y < 0 || y > 5.6) return { dist, x, y, z, cellX: -1, cellZ: -1 };
      const c = this.worldToCell(x, z);
      if (this.isWall(c.x, c.z)) return { dist, x, y, z, cellX: c.x, cellZ: c.z };
      dist += step;
    }
    return null;
  }
  findPath(fromX, fromZ, toX, toZ) {
    const start = this.worldToCell(fromX, fromZ);
    const goal = this.worldToCell(toX, toZ);
    if (!this.isWalkable(start.x, start.z) || !this.isWalkable(goal.x, goal.z)) return [];
    const key = (x, z) => z * this.width + x;
    const came = new Map();
    const q = [key(start.x, start.z)];
    came.set(key(start.x, start.z), key(start.x, start.z));
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let found = false;
    const goalK = key(goal.x, goal.z);
    while (q.length) {
      const cur = q.shift();
      if (cur === goalK) { found = true; break; }
      const cx = cur % this.width, cz = (cur / this.width) | 0;
      for (const [dx, dz] of dirs) {
        const nx = cx + dx, nz = cz + dz, nk = key(nx, nz);
        if (came.has(nk) || !this.isWalkable(nx, nz)) continue;
        came.set(nk, cur); q.push(nk);
      }
    }
    if (!found) return [];
    const cells = [];
    let cur = goalK;
    const startK = key(start.x, start.z);
    while (cur !== startK) {
      cells.push({ x: cur % this.width, z: (cur / this.width) | 0 });
      cur = came.get(cur);
    }
    cells.reverse();
    return cells.map((c) => this.cellToWorld(c.x, c.z));
  }
}

/* ============ Game constants — ported from src/hellverdict/game.ts ============ */
const CELL = 2.5;
const WALL_H = 5.5;
const MAX_STAGE = 10;
const SAVE_KEY = "hellverdict.level";
const SENS_KEY = "hellverdict.sensitivity";

const ENEMY_FRAMES = { soldier: IMAGES.soldier };
const WEAPON_FRAMES = IMAGES.weapon;

function seededPick(open, offset, start, minDist) {
  const n = open.length;
  for (let i = 0; i < n; i++) {
    const c = open[(offset * 11 + i * 7) % n];
    const d = Math.abs(c.x - start.x) + Math.abs(c.z - start.z);
    if (d >= minDist) return c;
  }
  return open[Math.abs(offset) % n];
}

/* ============ Texture / sprite loading (cached) ============ */
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function loadTexture(dataUrl, nearest) {
  if (texCache.has(dataUrl)) return texCache.get(dataUrl);
  const tex = texLoader.load(dataUrl);
  tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  texCache.set(dataUrl, tex);
  return tex;
}
function textureAspect(tex) {
  const img = tex.image;
  if (img && img.width && img.height) return img.width / img.height;
  return 0.72;
}

/* ============ Audio ============ */
class Sfx {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.master = 0.7;
    this.unlocked = false;
    this.bgmSrc = null;
    this.bgmGain = null;
    this.bgmName = null;
  }
  async unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") await this.ctx.resume();
    await Promise.all(Object.entries(AUDIO).map(async ([name, dataUrl]) => {
      try {
        const res = await fetch(dataUrl);
        const buf = await res.arrayBuffer();
        const audioBuf = await this.ctx.decodeAudioData(buf);
        this.buffers.set(name, audioBuf);
      } catch (e) { /* asset may fail to decode in some browsers; ignore */ }
    }));
  }
  play(name, rate) {
    if (!this.ctx || !this.buffers.has(name)) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(name);
    src.playbackRate.value = rate || 1;
    const gain = this.ctx.createGain();
    gain.gain.value = this.master;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }
  playBgm(name) {
    if (!this.ctx || !this.buffers.has(name)) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.stopBgm();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.get(name);
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = this.master * 0.55;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
    this.bgmSrc = src;
    this.bgmGain = gain;
    this.bgmName = name;
  }
  stopBgm() {
    if (this.bgmSrc) {
      try { this.bgmSrc.stop(); } catch (e) {}
      this.bgmSrc = null;
      this.bgmGain = null;
      this.bgmName = null;
    }
  }
  setMaster(v) {
    this.master = v;
    if (this.bgmGain) this.bgmGain.gain.value = v * 0.55;
  }
}

/* ============ Input ============ */
class InputMap {
  constructor() {
    this.keys = new Set();
    this.actions = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, sprint: false,
      healPressed: false, pausePressed: false, jumpPressed: false, minimapPressed: false };
    this.pointerLocked = false;
    this.lookX = 0; this.lookY = 0;
    this.sensitivity = 0.0022;
    this.suppressFire = false;
    this.touch = { moveX: 0, moveY: 0, fire: false, heal: false };
    this._prevHeal = false;
    this._prevPause = false;
    this._prevMinimap = false;
    this._prevJump = false;
    this._prevKeySet = new Set();
    this.escapeQueued = false;
    this.onLockLost = null; // callback when pointer lock exits unexpectedly
  }
  attach(canvas) {
    this.canvas = canvas;
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","KeyW","KeyA","KeyS","KeyD"].includes(e.code)) e.preventDefault();
      // Queue Escape immediately so one press pauses even while pointer-locked
      if (e.code === "Escape") this.escapeQueued = true;
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    canvas.addEventListener("mousedown", (e) => { if (e.button === 0) this.keys.add("Mouse0"); });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) this.keys.delete("Mouse0"); });
    document.addEventListener("pointerlockchange", () => {
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === canvas;
      // Browser ESC exits pointer lock first; treat lock-loss while playing as pause
      if (wasLocked && !this.pointerLocked && typeof this.onLockLost === "function") {
        this.onLockLost();
      }
    });
  }
  requestLock() { if (this.canvas) this.canvas.requestPointerLock(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  suppressFireUntilReleased() { this.suppressFire = true; }
  setKeys(codes) { this.keys = new Set(codes); }
  update() {
    const k = this.keys;
    let mx = 0, my = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) my += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) my -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) mx += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) mx -= 1;
    mx += this.touch.moveX; my += this.touch.moveY;
    mx = Math.max(-1, Math.min(1, mx)); my = Math.max(-1, Math.min(1, my));
    this.actions.moveX = mx; this.actions.moveY = my;
    // Positive movementX (mouse right) should turn camera right.
    // Original Unity: transform.Rotate(0, lookInput.x, 0); rotationX -= lookInput.y
    // Web uses yaw -= lookX, pitch -= lookY, so feed raw deltas (no extra negate).
    this.actions.lookX = this.lookX * this.sensitivity;
    this.actions.lookY = this.lookY * this.sensitivity;
    this.lookX = 0; this.lookY = 0;
    let fireHeld = k.has("Mouse0") || this.touch.fire;
    if (this.suppressFire) { if (!fireHeld) this.suppressFire = false; fireHeld = false; }
    this.actions.fire = fireHeld;
    this.actions.sprint = k.has("ShiftLeft") || k.has("ShiftRight");
    const healHeld = k.has("KeyF") || this.touch.heal;
    this.actions.healPressed = healHeld && !this._prevHeal;
    this._prevHeal = healHeld;
    const pauseHeld = k.has("Escape") || this.escapeQueued;
    this.actions.pausePressed = (pauseHeld && !this._prevPause) || this.escapeQueued;
    this.escapeQueued = false;
    this._prevPause = pauseHeld;
    const mapHeld = k.has("KeyM");
    this.actions.minimapPressed = mapHeld && !this._prevMinimap;
    this._prevMinimap = mapHeld;
    const jumpHeld = k.has("Space");
    this.actions.jumpPressed = jumpHeld && !this._prevJump;
    this._prevJump = jumpHeld;
    // Edge-triggered key codes for easter/debug sequences
    this.actions.justPressed = [];
    for (const code of k) {
      if (!this._prevKeySet.has(code)) this.actions.justPressed.push(code);
    }
    this._prevKeySet = new Set(k);
  }
}

/* ============ Main game — ported from src/hellverdict/game.ts (buildLevel/tick/fire/enemies) ============ */
class HellVerdictGame {
  constructor(renderer, scene, camera, canvas) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.physics = new GridPhysics();
    this.input = new InputMap();
    this.input.attach(canvas);
    this.input.onLockLost = () => {
      // One ESC: browser unlocks pointer → open pause menu immediately
      if (this.hud.screen === "playing") this.pause();
    };
    this.sfx = new Sfx();

    this.hud = {
      screen: "loading", health: 100, healCharges: 3, level: 1, liveEnemies: 0,
      blood: 0, shake: 0, weaponFrame: WEAPON_FRAMES[0], sensitivity: 100, minimap: true,
    };
    this.player = null;
    this.enemies = [];
    this.maze = null;
    this.level = 1;
    this.groups = [];
    this.wallMesh = null;
    this.lights = [];
    this.stageTimer = 0;
    this.bob = 0;
    this.hudListeners = new Set();
    // Easter egg: W A S D Space Space Fire (level 1) -> jump to stage 10
    this.easterIndex = 0;
    this.easterTimer = 0;
    this.easterAvailable = false;
    // Debug: ↑↓↑↓←→←→ A B
    this.debugIndex = 0;
    this.debugTimer = 0;
    this.debugMode = false;
    this.godMode = false;
    this._prevKeys = new Set();
  }

  onHud(fn) { this.hudListeners.add(fn); return () => this.hudListeners.delete(fn); }
  bumpHud() { for (const fn of this.hudListeners) fn(); }

  async startNewGame() {
    this.level = 1;
    localStorage.setItem(SAVE_KEY, "1");
    await this.beginLevel(1);
  }
  async continueGame() {
    this.level = Math.max(1, Math.min(MAX_STAGE, Number(localStorage.getItem(SAVE_KEY) || "1")));
    await this.beginLevel(this.level);
  }
  async retryLevel() { await this.beginLevel(this.level); }

  pause() {
    if (this.hud.screen === "playing") { this.hud.screen = "paused"; this.input.unlock(); this.bumpHud(); }
  }
  resume() {
    if (this.hud.screen === "paused" || this.hud.screen === "options") {
      this.hud.screen = "playing"; this.input.suppressFireUntilReleased(); this.bumpHud();
    }
  }
  stop() { this.hud.screen = "menu"; this.sfx.stopBgm(); this.input.unlock(); this.bumpHud(); }
  setScreen(s) { this.hud.screen = s; if (s !== "playing") this.input.unlock(); this.bumpHud(); }
  setSensitivity(p) {
    this.hud.sensitivity = Math.max(25, Math.min(200, p));
    localStorage.setItem(SENS_KEY, String(this.hud.sensitivity));
    this.bumpHud();
  }
  toggleMinimap() { this.hud.minimap = !this.hud.minimap; this.bumpHud(); }

  async beginLevel(level) {
    this.hud.screen = "loading";
    this.hud.level = level;
    this.bumpHud();
    await new Promise((r) => requestAnimationFrame(r)); // let loading screen paint
    this.buildLevel(level);
    this.hud.screen = "playing";
    await this.sfx.unlock();
    this.sfx.playBgm("theme");
    this.input.suppressFireUntilReleased();
    this.easterAvailable = (level === 1);
    this.easterIndex = 0;
    this.easterTimer = 0;
    this.bumpHud();
  }

  buildLevel(level) {
    this.clearLevel();
    const size = Math.min(41, 21 + Math.min(level, MAX_STAGE) * 2);
    const maze = generateMaze(size, 7300 + level * 97);
    this.maze = maze;
    this.physics.setGrid(maze.width, maze.depth, maze.walls, CELL);

    const wallTex = loadTexture(IMAGES.wall, true);
    wallTex.repeat.set(1, 1);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.05 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 0.95 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 1 });

    const wallGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    let wallCount = 0;
    for (let i = 0; i < maze.walls.length; i++) wallCount += maze.walls[i];
    const mesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCount);
    const dummy = new THREE.Object3D();
    let wi = 0;
    for (let z = 0; z < maze.depth; z++) {
      for (let x = 0; x < maze.width; x++) {
        if (!maze.walls[z * maze.width + x]) continue;
        dummy.position.set(x * CELL, WALL_H * 0.5, z * CELL);
        dummy.updateMatrix();
        mesh.setMatrixAt(wi++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.wallMesh = mesh;
    this.groups.push(mesh);

    const fw = maze.width * CELL, fd = maze.depth * CELL;
    const cx = ((maze.width - 1) * CELL) / 2, cz = ((maze.depth - 1) * CELL) / 2;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.12, fd), floorMat);
    floor.position.set(cx, -0.06, cz);
    this.scene.add(floor); this.groups.push(floor);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.12, fd), ceilMat);
    ceil.position.set(cx, WALL_H + 0.06, cz);
    this.scene.add(ceil); this.groups.push(ceil);

    this.scene.fog = new THREE.FogExp2(0x100c0e, 0.045);
    this.scene.background = new THREE.Color(0x100c0e);

    const start = this.physics.cellToWorld(maze.start.x, maze.start.z, 0.05);
    this.player = {
      x: start.x, y: 0.05, z: start.z, yaw: 0, pitch: 0, vx: 0, vz: 0, vy: 0,
      health: 100, maxHealth: 100, heal: 3, killsSinceHeal: 0, dead: false,
      lastFire: 0, firing: false, fireAnimT: 0,
    };
    this.syncCamera();

    // Ambient + directional light so the scene isn't pitch black beyond fog
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(1, 1, 0.5);
    this.scene.add(dir); this.lights.push(dir);
    const amb = new THREE.AmbientLight(0x554440, 0.55);
    this.scene.add(amb); this.lights.push(amb);

    // Decorative point lights (green/red glow) — replaces candelabra sprite decor
    const decoN = 4 + level;
    for (let d = 0; d < decoN && d < 6; d++) {
      const cell = seededPick(maze.open, d + 3, maze.start, 3);
      const w = this.physics.cellToWorld(cell.x, cell.z, 1.4);
      const pl = new THREE.PointLight(level >= 5 ? 0xff5533 : 0x66ff88, 0.7, 8);
      pl.position.set(w.x, 2.0, w.z);
      this.scene.add(pl); this.lights.push(pl);
    }

    const count = Math.min(18, Math.max(5, 4 + level * 2));
    this.hud.liveEnemies = count;
    for (let n = 0; n < count; n++) {
      const type = "soldier";
      const cell = seededPick(maze.open, n + 8, maze.start, 8 + level);
      const w = this.physics.cellToWorld(cell.x, cell.z, 0.9);
      const frames = ENEMY_FRAMES[type];
      const spr = this.makeSprite(frames.idle[0], 1.7);
      spr.position.set(w.x, 1.05, w.z);
      this.scene.add(spr); this.groups.push(spr);
      this.enemies.push({
        type, health: this.enemyHp(type), damage: 4 + level, speed: 0.85 + level * 0.08,
        x: w.x, y: spr.position.y, z: w.z, alive: true, stunned: false, stunT: 0,
        attackRange: 3, lastAttack: 0, path: [], pathI: 0, nextPath: 0,
        anim: "idle", frame: 0, frameT: 0, sprite: spr, deathT: 0,
      });
    }

    this.hud.health = 100; this.hud.healCharges = 3; this.hud.level = level;
    this.hud.weaponFrame = WEAPON_FRAMES[0]; this.hud.blood = 0;
  }


  updateEasterAndDebug(dt) {
    const a = this.input.actions;
    const just = a.justPressed || [];
    // --- Debug sequence: Up Down Up Down Left Right Left Right A B ---
    this.debugTimer += dt;
    if (this.debugTimer > 10) { this.debugIndex = 0; this.debugTimer = 0; }
    const debugSeq = ["ArrowUp","ArrowDown","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","ArrowLeft","ArrowRight","KeyA","KeyB"];
    let debugHit = false;
    for (const code of just) {
      if (code === debugSeq[this.debugIndex]) {
        this.debugIndex++;
        this.debugTimer = 0;
        debugHit = true;
        if (this.debugIndex >= debugSeq.length) {
          this.debugIndex = 0;
          this.debugMode = !this.debugMode;
          if (!this.debugMode) this.godMode = false;
          console.log("[DEBUG MODE]", this.debugMode ? "ENABLED" : "DISABLED");
        }
        break;
      }
    }
    if (!debugHit && just.length && this.debugIndex > 0) {
      const isDbg = debugSeq.includes(just[0]);
      if (!isDbg) { this.debugIndex = 0; this.debugTimer = 0; }
    }
    if (this.debugMode) {
      // 1 = toggle god, 9 = skip to next stage, 0 = full heal
      if (just.includes("Digit1")) {
        this.godMode = !this.godMode;
        console.log("[GOD MODE]", this.godMode ? "ON" : "OFF");
      }
      if (just.includes("Digit9") && this.hud.screen === "playing") {
        this.hud.screen = "stageclear";
        this.stageTimer = 1.2;
      }
      if (just.includes("Digit0") && this.player) {
        this.player.health = this.player.maxHealth;
        this.player.heal = 3;
      }
    }

    // --- Easter egg: W A S D Space Space then Fire (level 1 only) ---
    if (!this.easterAvailable || this.hud.screen !== "playing") return;
    this.easterTimer += dt;
    if (this.easterTimer > 10) { this.easterIndex = 0; this.easterTimer = 0; }
    const eggSeq = ["KeyW","KeyA","KeyS","KeyD","Space","Space"];
    if (this.easterIndex < 6) {
      let hit = false;
      for (const code of just) {
        if (code === eggSeq[this.easterIndex]) {
          this.easterIndex++;
          this.easterTimer = 0;
          hit = true;
          break;
        }
      }
      if (!hit && just.length) {
        // any other key resets (except pure movement noise is hard; reset on wrong key)
        const expected = eggSeq[this.easterIndex];
        if (!just.includes(expected)) {
          this.easterIndex = 0;
          this.easterTimer = 0;
        }
      }
    } else {
      // waiting for fire
      if (a.fire && !this.input.suppressFire) {
        this.easterAvailable = false;
        console.log("[BALMUNG DOOM] Secret mode activated! Jumping to final stage...");
        this.level = MAX_STAGE;
        localStorage.setItem(SAVE_KEY, String(this.level));
        this.beginLevel(this.level);
      }
    }
  }

  enemyHp(type) { return 20; }

  makeSprite(dataUrl, height) {
    const tex = loadTexture(dataUrl, true);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.15, depthWrite: false });
    const spr = new THREE.Sprite(mat);
    const aspect = textureAspect(tex);
    spr.scale.set(height * aspect, height, 1);
    return spr;
  }
  setSprite(spr, dataUrl, height) {
    const tex = loadTexture(dataUrl, true);
    const mat = spr.material;
    mat.map = tex; mat.needsUpdate = true;
    const aspect = textureAspect(tex);
    spr.scale.set(height * aspect, height, 1);
  }

  clearLevel() {
    for (const o of this.groups) {
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); }
    }
    this.groups = [];
    for (const l of this.lights) this.scene.remove(l);
    this.lights = [];
    this.enemies = [];
    this.wallMesh = null;
  }

  tick(dt) {
    this.input.update();
    if (!this.player) return;
    const hud = this.hud;
    if (hud.screen === "stageclear") {
      this.stageTimer -= dt;
      if (this.stageTimer <= 0) {
        if (this.level >= MAX_STAGE) {
          this.hud.screen = "win";
          this.level = 1;
          localStorage.setItem(SAVE_KEY, "1");
          this.input.unlock();
          this.bumpHud();
        } else {
          this.level++;
          localStorage.setItem(SAVE_KEY, String(this.level));
          this.beginLevel(this.level);
          // Stay pointer-locked into the next stage
        }
      }
      return;
    }
    if (hud.screen !== "playing") return;

    this.updateEasterAndDebug(dt);
    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateWeapon(dt);
    this.hud.blood = Math.max(0, this.hud.blood - dt * 1.4);
    this.hud.shake = Math.max(0, this.hud.shake - dt * 8);
    this.hud.health = this.player.health;
    this.hud.healCharges = this.player.heal;
    this.hud.liveEnemies = this.enemies.filter((e) => e.alive).length;
    this.syncCamera();
    this.bumpHud();
  }

  updatePlayer(dt) {
    const p = this.player;
    const a = this.input.actions;
    // a.lookX/lookY are raw mouse delta already multiplied by InputMap.sensitivity;
    // hud.sensitivity is the user-facing 25-200% slider applied on top of that.
    const sensScale = this.hud.sensitivity / 100;
    p.yaw -= a.lookX * sensScale;
    p.pitch -= a.lookY * sensScale;
    const lim = Math.PI / 2 - 0.02;
    if (p.pitch > lim) p.pitch = lim;
    if (p.pitch < -lim) p.pitch = -lim;

    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let speed = 7;
    if (a.sprint && a.moveY > 0.1) speed *= 1.6;
    const tx = (fx * a.moveY + rx * a.moveX) * speed;
    const tz = (fz * a.moveY + rz * a.moveX) * speed;
    p.vx += (tx - p.vx) * Math.min(1, 18 * dt);
    p.vz += (tz - p.vz) * Math.min(1, 18 * dt);
    const grounded = p.y <= 0.06;
    if (grounded && p.vy < 0) p.vy = -1;
    p.vy -= 18 * dt;
    // Axis-separated slide so one axis can still move when the other hits a wall
    const rad = 0.38;
    let nx = p.x + p.vx * dt;
    let hit = this.physics.collideCircle(nx, p.z, rad);
    p.x = hit.x;
    let nz = p.z + p.vz * dt;
    hit = this.physics.collideCircle(p.x, nz, rad);
    p.z = hit.z;
    p.y += p.vy * dt;
    if (p.y < 0.05) { p.y = 0.05; p.vy = 0; }
    const moving = Math.hypot(p.vx, p.vz) > 0.4 && grounded;
    if (moving) this.bob += dt * (a.sprint ? 12 : 8);

    if (a.healPressed && p.heal > 0 && p.health < p.maxHealth) {
      p.heal--; p.health = Math.min(p.maxHealth, p.health + p.maxHealth / 2);
    }
    if (a.pausePressed) this.pause();
    if (a.minimapPressed) this.toggleMinimap();
    if (a.fire && performance.now() / 1000 - p.lastFire >= 0.5) this.fire();
  }

  fire() {
    const p = this.player;
    p.lastFire = performance.now() / 1000;
    p.firing = true; p.fireAnimT = 0;
    this.sfx.play("shotgun", 0.94 + Math.random() * 0.12);
    this.hud.shake = 0.55;
    this.hud.weaponFrame = WEAPON_FRAMES[1];

    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(dir);
    const range = 12;
    let best = null, bestD = range;
    for (const en of this.enemies) {
      if (!en.alive) continue;
      const to = new THREE.Vector3(en.x - origin.x, en.y - origin.y, en.z - origin.z);
      const dist = to.length();
      if (dist > range) continue;
      const nd = to.clone().normalize();
      const dot = nd.dot(dir);
      if (dot < 0.92) continue;
      const wall = this.physics.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, dist - 0.2);
      if (wall && wall.dist < dist - 0.35) continue;
      if (dist < bestD) { bestD = dist; best = en; }
    }
    if (best) this.hurtEnemy(best, 10);
  }

  hurtEnemy(en, dmg) {
    en.health -= dmg;
    this.sfx.play("npc_pain", 0.9 + Math.random() * 0.2);
    if (en.health <= 0) { this.killEnemy(en); return; }
    // Pain lasts fixed duration (matches C# PainRoutine ~0.08s per frame, 1 pain frame)
    en.stunned = true;
    en.stunT = 0.35;
    en.anim = "pain";
    en.frame = 0;
    en.frameT = 0;
    const painFrames = ENEMY_FRAMES[en.type].pain || ENEMY_FRAMES[en.type].idle;
    this.setSprite(en.sprite, painFrames[0], en.sprite.scale.y);
  }

  killEnemy(en) {
    en.alive = false; en.anim = "death"; en.frame = 0; en.frameT = 0; en.deathT = 0;
    this.sfx.play("npc_death");
    const p = this.player;
    p.killsSinceHeal++;
    if (p.killsSinceHeal >= 5) { p.killsSinceHeal = 0; p.heal++; }
    const left = this.enemies.filter((e) => e.alive).length;
    this.hud.liveEnemies = left;
    if (left <= 0) {
      this.hud.screen = "stageclear";
      this.stageTimer = this.level >= MAX_STAGE ? 3 : 2;
      // Keep pointer lock during stage clear so next level stays locked
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    const now = performance.now() / 1000;
    for (const en of this.enemies) {
      if (!en.alive) {
        en.deathT += dt;
        const frames = ENEMY_FRAMES[en.type].death;
        const fi = Math.min(frames.length - 1, Math.floor(en.deathT / 0.45));
        if (fi !== en.frame) { en.frame = fi; this.setSprite(en.sprite, frames[fi], en.sprite.scale.y); }
        if (en.deathT > frames.length * 0.45 + 0.5) {
          en.sprite.material.opacity = Math.max(0, 1 - (en.deathT - frames.length * 0.45) / 0.5);
          if (en.sprite.material.opacity <= 0) en.sprite.visible = false;
        }
        continue;
      }
      en.frameT += dt;
      const fps = en.anim === "walk" ? 0.14 : en.anim === "attack" ? 0.12 : 0.16;
      if (en.frameT >= fps) {
        en.frameT = 0;
        const frames = ENEMY_FRAMES[en.type][en.anim] || ENEMY_FRAMES[en.type].idle;
        en.frame = (en.frame + 1) % frames.length;
        this.setSprite(en.sprite, frames[en.frame], en.sprite.scale.y);
      }
      if (en.stunned) {
        en.stunT -= dt;
        // Keep showing pain sprite; when timer ends return to idle/AI
        if (en.stunT <= 0) {
          en.stunned = false;
          en.stunT = 0;
          en.anim = "idle";
          en.frame = 0;
          en.frameT = 0;
          const idleFrames = ENEMY_FRAMES[en.type].idle;
          this.setSprite(en.sprite, idleFrames[0], en.sprite.scale.y);
        }
        en.sprite.position.set(en.x, en.y, en.z);
        continue;
      }
      const dx = p.x - en.x, dz = p.z - en.z;
      const dist = Math.hypot(dx, dz);
      const los = !this.physics.raycast(en.x, 1, en.z, dx / (dist || 1), 0, dz / (dist || 1), dist);
      if (dist <= en.attackRange && los) {
        en.anim = "attack";
        if (now - en.lastAttack >= 2.2) { en.lastAttack = now; this.sfx.play("npc_attack"); this.hurtPlayer(en.damage); }
      } else {
        let tx = p.x, tz = p.z;
        if (!los) {
          if (now >= en.nextPath) {
            en.nextPath = now + 0.35;
            en.path = this.physics.findPath(en.x, en.z, p.x, p.z);
            en.pathI = 0;
          }
          if (en.path.length) {
            const wp = en.path[Math.min(en.pathI, en.path.length - 1)];
            if (Math.hypot(en.x - wp.x, en.z - wp.z) < 0.3) en.pathI++;
            const w = en.path[Math.min(en.pathI, en.path.length - 1)];
            if (w) { tx = w.x; tz = w.z; }
          }
        }
        const ddx = tx - en.x, ddz = tz - en.z;
        const dl = Math.hypot(ddx, ddz) || 1;
        const step = en.speed * dt;
        const stepX = (ddx / dl) * step, stepZ = (ddz / dl) * step;
        let hit = this.physics.collideCircle(en.x + stepX, en.z, 0.4);
        en.x = hit.x;
        hit = this.physics.collideCircle(en.x, en.z + stepZ, 0.4);
        en.z = hit.z;
        en.anim = "walk";
      }
      en.sprite.position.set(en.x, en.y, en.z);
    }
  }

  hurtPlayer(dmg) {
    const p = this.player;
    if (p.dead) return;
    if (this.godMode) return;
    p.health -= dmg;
    this.sfx.play("player_pain");
    this.hud.blood = 1; this.hud.shake = 0.7;
    if (p.health <= 0) {
      p.health = 0; p.dead = true;
      this.hud.screen = "gameover";
      this.input.unlock();
    }
  }

  updateWeapon(dt) {
    const p = this.player;
    if (!p.firing) { this.hud.weaponFrame = WEAPON_FRAMES[0]; return; }
    p.fireAnimT += dt;
    if (p.fireAnimT < 0.17) this.hud.weaponFrame = WEAPON_FRAMES[1];
    else if (p.fireAnimT < 0.34) this.hud.weaponFrame = WEAPON_FRAMES[2];
    else { p.firing = false; this.hud.weaponFrame = WEAPON_FRAMES[0]; }
  }

  syncCamera() {
    const p = this.player;
    if (!p) return;
    const bobY = Math.sin(this.bob) * 0.035;
    this.camera.position.set(p.x, p.y + 1.55 + bobY, p.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(p.yaw);
    this.camera.rotateX(p.pitch);
  }
}

/* ============ Bootstrap: renderer, scene, camera ============ */
const wrap = document.getElementById("canvas-wrap");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const game = new HellVerdictGame(renderer, scene, camera, renderer.domElement);

/* ============ Screen management ============ */
const screens = {
  loading: document.getElementById("screen-loading"),
  menu: document.getElementById("screen-menu"),
  options: document.getElementById("screen-options"),
  paused: document.getElementById("screen-paused"),
  stageclear: document.getElementById("screen-stageclear"),
  win: document.getElementById("screen-win"),
  gameover: document.getElementById("screen-gameover"),
};
const hudEl = document.getElementById("hud");
const weaponImg = document.getElementById("weapon-view");
const bloodOverlay = document.getElementById("blood-overlay");
let optionsReturnScreen = "menu";

function showScreen(name) {
  for (const k in screens) screens[k].classList.toggle("hidden", k !== name);
  const inGameHud = name === "playing" || name === "stageclear";
  hudEl.style.display = inGameHud || name === "paused" ? "block" : "none";
  weaponImg.style.display = name === "playing" ? "block" : "none";
}

function renderHud() {
  const h = game.hud;
  showScreen(h.screen === "playing" ? "playing" : h.screen);
  if (h.screen === "playing" || h.screen === "paused" || h.screen === "stageclear") {
    document.getElementById("hud-health").textContent = Math.round(h.health);
    document.getElementById("hud-heal").textContent = h.healCharges;
    document.getElementById("hud-level").textContent = h.level;
    document.getElementById("hud-enemies").textContent = "Hostiles: " + h.liveEnemies;
    weaponImg.src = h.weaponFrame;
    bloodOverlay.style.opacity = String(h.blood * 0.85);
    document.getElementById("minimap").style.display = h.minimap ? "block" : "none";
    drawMinimap();
  }
  if (h.screen === "gameover") document.getElementById("go-level").textContent = h.level;
  if (h.screen === "options") {
    document.getElementById("sens-slider").value = h.sensitivity;
    document.getElementById("sens-val").textContent = h.sensitivity;
  }
}
game.onHud(renderHud);

/* ============ Minimap ============ */
const mapCanvas = document.getElementById("minimap");
const mapCtx = mapCanvas.getContext("2d");
function drawMinimap() {
  if (!game.maze || !game.hud.minimap) return;
  const maze = game.maze;
  const S = 140;
  const cell = S / Math.max(maze.width, maze.depth);
  mapCtx.clearRect(0, 0, S, S);
  mapCtx.fillStyle = "rgba(10,6,6,0.5)";
  mapCtx.fillRect(0, 0, S, S);
  mapCtx.fillStyle = "#5a4038";
  for (let z = 0; z < maze.depth; z++) {
    for (let x = 0; x < maze.width; x++) {
      if (maze.walls[z * maze.width + x]) mapCtx.fillRect(x * cell, z * cell, cell + 0.6, cell + 0.6);
    }
  }
  if (game.player) {
    const px = (game.player.x / CELL) * cell, pz = (game.player.z / CELL) * cell;
    mapCtx.fillStyle = "#4fd6ff";
    mapCtx.beginPath(); mapCtx.arc(px, pz, 3, 0, Math.PI * 2); mapCtx.fill();
    mapCtx.strokeStyle = "#4fd6ff"; mapCtx.lineWidth = 1.4;
    mapCtx.beginPath(); mapCtx.moveTo(px, pz);
    mapCtx.lineTo(px - Math.sin(game.player.yaw) * 9, pz - Math.cos(game.player.yaw) * 9);
    mapCtx.stroke();
  }
  for (const en of game.enemies) {
    if (!en.alive) continue;
    const ex = (en.x / CELL) * cell, ez = (en.z / CELL) * cell;
    mapCtx.fillStyle = "#e6322a";
    mapCtx.beginPath(); mapCtx.arc(ex, ez, 2.4, 0, Math.PI * 2); mapCtx.fill();
  }
}

/* ============ Menu wiring ============ */
document.getElementById("btn-new").onclick = async () => { await game.startNewGame(); game.input.requestLock(); };
document.getElementById("btn-continue").onclick = async () => { await game.continueGame(); game.input.requestLock(); };
document.getElementById("btn-options").onclick = () => { optionsReturnScreen = "menu"; game.setScreen("options"); };
document.getElementById("btn-options-back").onclick = () => { game.setScreen(optionsReturnScreen); if (optionsReturnScreen === "playing") game.resume(); };
document.getElementById("btn-resume").onclick = () => { game.resume(); game.input.requestLock(); };
document.getElementById("btn-pause-options").onclick = () => { optionsReturnScreen = "paused"; game.setScreen("options"); };
document.getElementById("btn-quit").onclick = () => { game.stop(); };
document.getElementById("btn-win-menu").onclick = () => { game.stop(); };
document.getElementById("btn-retry").onclick = async () => { await game.retryLevel(); game.input.requestLock(); };
document.getElementById("btn-go-menu").onclick = () => { game.stop(); };

const sensSlider = document.getElementById("sens-slider");
sensSlider.oninput = () => {
  document.getElementById("sens-val").textContent = sensSlider.value;
  game.setSensitivity(Number(sensSlider.value));
};
const volSlider = document.getElementById("vol-slider");
volSlider.oninput = () => {
  document.getElementById("vol-val").textContent = volSlider.value;
  game.sfx.setMaster(Number(volSlider.value) / 100);
};

// Click canvas to (re)acquire pointer lock while playing
renderer.domElement.addEventListener("click", () => {
  if (game.hud.screen === "playing") game.input.requestLock();
});

/* ============ Touch controls (mobile) ============ */
const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
if (isTouch) {
  document.getElementById("touch-controls").style.display = "block";
  const joyZone = document.getElementById("joy-zone");
  const joyStick = document.getElementById("joy-stick");
  let joyId = null, joyCX = 0, joyCY = 0;
  joyZone.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const r = joyZone.getBoundingClientRect();
    joyCX = r.left + r.width / 2; joyCY = r.top + r.height / 2;
  });
  window.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      let dx = t.clientX - joyCX, dy = t.clientY - joyCY;
      const max = 46;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
      joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
      game.input.touch.moveX = dx / max;
      game.input.touch.moveY = -dy / max;
    }
  });
  window.addEventListener("touchend", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== joyId) continue;
      joyId = null; joyStick.style.transform = "translate(0,0)";
      game.input.touch.moveX = 0; game.input.touch.moveY = 0;
    }
  });
  // Look via drag anywhere else on screen
  let lookId = null, lastX = 0, lastY = 0;
  renderer.domElement.addEventListener("touchstart", (e) => {
    if (game.hud.screen !== "playing") return;
    const t = e.changedTouches[0];
    if (t.clientX < 170 && t.clientY > window.innerHeight - 170) return; // joystick zone
    lookId = t.identifier; lastX = t.clientX; lastY = t.clientY;
  });
  window.addEventListener("touchmove", (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      game.input.lookX += (t.clientX - lastX) * 2.2;
      game.input.lookY += (t.clientY - lastY) * 2.2;
      lastX = t.clientX; lastY = t.clientY;
    }
  });
  window.addEventListener("touchend", (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; });

  const fireBtn = document.getElementById("btn-fire");
  fireBtn.addEventListener("touchstart", (e) => { e.preventDefault(); game.input.touch.fire = true; });
  fireBtn.addEventListener("touchend", () => { game.input.touch.fire = false; });
  const healBtn = document.getElementById("btn-heal");
  healBtn.addEventListener("touchstart", (e) => { e.preventDefault(); game.input.touch.heal = true; });
  healBtn.addEventListener("touchend", () => { game.input.touch.heal = false; });
  document.getElementById("btn-pause").addEventListener("click", () => { if (game.hud.screen === "playing") game.pause(); });
}

/* ============ Render loop ============ */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ============ Boot ============ */
document.getElementById("loading-label").textContent = "Ready";
setTimeout(() => { game.setScreen("menu"); }, 250);
requestAnimationFrame(frame);

})();
