import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Trophy, ShoppingBag, ArrowLeft, Lock, Check, Coins, Home, Heart, Volume2, VolumeX, Vibrate, VibrateOff, HelpCircle, FileText } from 'lucide-react';
import { SKINS, TROPHIES, getSkin, loadSave, persistSave, checkTrophies } from '../game/meta';
import { sfx, isMuted, toggleMuted } from '../game/audio';
import { startMusic, stopMusic, setMusicIntensity } from '../game/music';
import { haptics, isHapticsEnabled, toggleHaptics } from '../game/haptics';
import {
  createFlow, updateFlow, noteHit, noteKill, challenge,
  enemySizeRange, powerupDelay, speedOrbChance, orbSpawnBias,
} from '../game/flow';
import type { FlowState } from '../game/flow';
import {
  themeForLevel, stageName, stageNumber, blendFrom, easeToward, css,
} from '../game/stages';
import type { Skin, SaveData, TrophyDef } from '../game/meta';

// --- Constants & Types ---
const COLORS = {
  bg: '#020617', // slate-950
  player: '#0ea5e9', // cyan-500
  playerGlow: 'rgba(14, 165, 233, 0.8)',
  orb: '#10b981', // emerald-500
  orbGlow: 'rgba(16, 185, 129, 0.8)',
  speedOrb: '#f59e0b', // amber-500
  speedOrbGlow: 'rgba(245, 158, 11, 0.8)',
  enemy: '#ef4444', // red-500 — a threat: bigger than you, will kill you
  enemyGlow: 'rgba(239, 68, 68, 0.8)',
  // Prey: small enough to absorb. Muted amber, so a glance tells you whether
  // something is food or death without comparing radii by eye.
  enemyPrey: '#b45309', // amber-700
  enemyPreyGlow: 'rgba(180, 83, 9, 0.7)',
  boss: '#dc2626', // red-600 — deep angry red
  bossGlow: 'rgba(220, 38, 38, 0.9)',
  shield: '#22d3ee', // cyan-400
  shieldGlow: 'rgba(34, 211, 238, 0.9)',
  magnet: '#a855f7', // purple-500
  magnetGlow: 'rgba(168, 85, 247, 0.9)',
  freeze: '#60a5fa', // blue-400
  freezeGlow: 'rgba(96, 165, 250, 0.9)',
  radar: '#f472b6', // pink-400
  radarGlow: 'rgba(244, 114, 182, 0.9)',
  projectile: '#f43f5e', // rose-500
  grid: 'rgba(255, 255, 255, 0.05)',
};

type Entity = {
  id: number;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  color: string;
  glow: string;
};

type Player = Entity & {
  invincibleTimer: number;
  magnetTimer: number;
  speedBoostTimer: number;
  shootTimer: number;
};

type Orb = Entity & {
  type: 'normal' | 'speed' | 'shield' | 'magnet' | 'freeze' | 'radar';
};

type Enemy = Entity & {
  type: 'normal' | 'boss' | 'projectile';
  shootTimer: number;
  /** Ticks between shots. Stored so the renderer can telegraph the wind-up. */
  shootCadence?: number;
  targetX?: number;
  targetY?: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

type GameState = {
  status: 'menu' | 'playing' | 'paused' | 'reviving' | 'gameover';
  score: number;
  level: number;
  arena: { w: number; h: number };
  player: Player;
  orbs: Orb[];
  enemies: Enemy[];
  playerProjectiles: Entity[];
  particles: Particle[];
  camera: { x: number; y: number };
  joystick: { active: boolean; originX: number; originY: number; currX: number; currY: number };
  runEnemiesDestroyed: number;
  runBossesKilled: number;
  reviveUsed: boolean;
  freezeTimer: number;
  powerupTimer: number;
  maintTick: number;
  flow: FlowState;
  radarTimer: number;
  /** Camera shake magnitude in CSS px, decays each tick. */
  shake: number;
  /** Red edge flash on damage, 0..1, decays each tick. */
  hurtFlash: number;
};

// --- Helper Functions ---
const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1);
const randomRange = (min: number, max: number) => Math.random() * (max - min) + min;

let entityIdCounter = 0;

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [uiState, setUiState] = useState({
    status: 'menu',
    score: 0,
    level: 1,
    size: 20,
    shield: 0,
    magnet: 0,
    freeze: 0,
    radar: 0,
  });

  // --- Meta-game state (persisted) ---
  const [save, setSave] = useState<SaveData>(() => loadSave());
  const [screen, setScreen] = useState<'home' | 'shop' | 'trophies' | 'howto' | 'privacy'>('home');
  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  const [newTrophies, setNewTrophies] = useState<TrophyDef[]>([]);
  const [reviveCountdown, setReviveCountdown] = useState(5);
  const [adPlaying, setAdPlaying] = useState(false);
  const [muted, setMutedState] = useState(() => isMuted());
  const [vibeOn, setVibeOn] = useState(() => isHapticsEnabled());
  // Attract screen. Doubles as the first user gesture, which is what unlocks
  // the Web Audio context in the WebView.
  const [introDone, setIntroDone] = useState(false);
  // Transient "Stage N" banner, shown for a moment when the stage changes.
  const [stageBanner, setStageBanner] = useState<string | null>(null);
  // Mirror of the last values pushed to React, so the game loop can skip
  // setState when nothing visible changed.
  const uiSyncRef = useRef({
    status: 'menu' as GameState['status'],
    score: 0, level: 1, size: 20,
    shield: 0, magnet: 0, freeze: 0, radar: 0,
  });
  // 60 logical updates per second, independent of the display's refresh rate.
  const STEP_MS = 1000 / 60;
  const MAX_CATCHUP = 5;

  const stepRef = useRef({ last: 0, acc: 0 });
  // Live palette. Eased toward the current stage each frame so the arena
  // fades between stages instead of cutting.
  const paletteRef = useRef(blendFrom(themeForLevel(1)));
  // Camera shake is the one effect that can actually make someone motion-sick.
  // index.css already honours prefers-reduced-motion for the UI; the canvas has
  // to check it itself.
  const reduceMotionRef = useRef(
    typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const dprCapRef = useRef(2);
  const fpsRef = useRef({ last: 0, acc: 0, frames: 0 });
  const saveRef = useRef<SaveData>(save);
  const skinRef = useRef<Skin>(getSkin(save.equippedSkin));

  useEffect(() => {
    saveRef.current = save;
    skinRef.current = getSkin(save.equippedSkin);
    persistSave(save);
  }, [save]);

  // Mutable game state to avoid closure issues in the animation loop
  const state = useRef<GameState>({
    status: 'menu',
    score: 0,
    level: 1,
    arena: { w: 2000, h: 2000 },
    player: { id: 0, x: 1000, y: 1000, r: 20, vx: 0, vy: 0, color: COLORS.player, glow: COLORS.playerGlow, speedBoostTimer: 0, shootTimer: 0, invincibleTimer: 0, magnetTimer: 0 },
    orbs: [],
    enemies: [],
    playerProjectiles: [],
    particles: [],
    camera: { x: 0, y: 0 },
    joystick: { active: false, originX: 0, originY: 0, currX: 0, currY: 0 },
    runEnemiesDestroyed: 0,
    runBossesKilled: 0,
    reviveUsed: false,
    freezeTimer: 0,
    powerupTimer: 900,
    maintTick: 0,
    flow: createFlow(),
    shake: 0,
    hurtFlash: 0,
    radarTimer: 0,
  });

  // --- Game Logic ---
  const initGame = () => {
    entityIdCounter = 0;
    state.current = {
      ...state.current,
      status: 'playing',
      score: 0,
      level: 1,
      arena: { w: 2000, h: 2000 },
      player: { id: entityIdCounter++, x: 1000, y: 1000, r: 20, vx: 0, vy: 0, color: skinRef.current.color, glow: skinRef.current.glow, speedBoostTimer: 0, shootTimer: 0, invincibleTimer: 0, magnetTimer: 0 },
      orbs: [],
      enemies: [],
      playerProjectiles: [],
      particles: [],
      joystick: { active: false, originX: 0, originY: 0, currX: 0, currY: 0 },
      runEnemiesDestroyed: 0,
      runBossesKilled: 0,
      reviveUsed: false,
      freezeTimer: 0,
      powerupTimer: 900,
      radarTimer: 0,
      maintTick: 0,
      flow: createFlow(),
      shake: 0,
      hurtFlash: 0,
    };
    paletteRef.current = blendFrom(themeForLevel(1));
    setNewTrophies([]);
    spawnInitialEntities();
    setUiState({ status: 'playing', score: 0, level: 1, size: 20 });
  };

  const spawnInitialEntities = () => {
    for (let i = 0; i < 100; i++) spawnOrb();
    for (let i = 0; i < 3; i++) spawnEnemy();
  };

  const spawnOrb = () => {
    const s = state.current;
    const isSpeed = Math.random() < speedOrbChance(s.flow);

    // Struggling players get food nearer to hand. Food spawning on the far
    // side of a 3000px arena while starving is a death they can't react to.
    //
    // Note this samples the *intersection* of the preferred span and the
    // arena. Clamping a wider random offset into range instead would pin
    // every out-of-bounds sample to the same coordinate, stacking orbs into a
    // line along the wall.
    const bias = orbSpawnBias(s.flow);
    const spanX = s.arena.w * bias;
    const spanY = s.arena.h * bias;
    const ox = randomRange(
      Math.max(20, s.player.x - spanX),
      Math.min(s.arena.w - 20, s.player.x + spanX),
    );
    const oy = randomRange(
      Math.max(20, s.player.y - spanY),
      Math.min(s.arena.h - 20, s.player.y + spanY),
    );

    s.orbs.push({
      id: entityIdCounter++,
      x: ox,
      y: oy,
      r: isSpeed ? 6 : 4,
      vx: 0,
      vy: 0,
      color: isSpeed ? COLORS.speedOrb : COLORS.orb,
      glow: isSpeed ? COLORS.speedOrbGlow : COLORS.orbGlow,
      type: isSpeed ? 'speed' : 'normal',
    });
  };

  /**
   * Keeps the world populated around the player.
   *
   * The arena grows 200px per level and 500px per boss, but orb and enemy
   * counts never grew with it - so by the mid game most of the map was empty
   * and you could swim for a long time finding nothing. Two things fix that:
   *
   *   1. Target counts scale with arena area rather than being fixed.
   *   2. Anything that drifts far from the player is recycled into a ring
   *      around them. Recycling rather than spawning keeps the totals stable,
   *      and because it only touches entities well outside the viewport, the
   *      player never sees something appear out of nothing.
   */
  const maintainWorld = () => {
    const s = state.current;

    const ORB_RECYCLE_DIST = 1900;
    const ENEMY_RECYCLE_DIST = 2400;

    const area = s.arena.w * s.arena.h;
    const targetOrbs = Math.max(110, Math.min(240, Math.round(area / 22000)));
    const targetEnemies = Math.min(14, 4 + s.level);

    // Place a point in a ring around the player: never on top of them, never
    // beyond comfortable reach, always inside the arena.
    //
    // Rejection sampling, not clamping. Clamping an out-of-bounds ring point
    // collapses it onto the boundary, and near a wall that turns a ring into a
    // dense line of orbs along the edge.
    const ringPoint = (min: number, max: number) => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const d = randomRange(min, max);
        const x = s.player.x + Math.cos(a) * d;
        const y = s.player.y + Math.sin(a) * d;
        if (x > 20 && x < s.arena.w - 20 && y > 20 && y < s.arena.h - 20) {
          return { x, y };
        }
      }
      // Cornered with no valid ring point: fall back to anywhere in the arena.
      return {
        x: randomRange(20, s.arena.w - 20),
        y: randomRange(20, s.arena.h - 20),
      };
    };

    // --- Orbs ---
    for (const orb of s.orbs) {
      if (dist(orb.x, orb.y, s.player.x, s.player.y) > ORB_RECYCLE_DIST) {
        const pt = ringPoint(550, 1500);
        orb.x = pt.x;
        orb.y = pt.y;
      }
    }
    while (s.orbs.length < targetOrbs) spawnOrb();

    // Loot drops can push the count well past target; trim the ones furthest
    // away so the arena never accumulates junk.
    if (s.orbs.length > targetOrbs * 1.35) {
      s.orbs.sort(
        (a, b) =>
          dist(a.x, a.y, s.player.x, s.player.y) - dist(b.x, b.y, s.player.x, s.player.y),
      );
      s.orbs.length = targetOrbs;
    }

    // --- Enemies ---
    let live = 0;
    for (const e of s.enemies) {
      if (e.type === 'projectile') continue;
      live++;
      if (e.type !== 'boss' && dist(e.x, e.y, s.player.x, s.player.y) > ENEMY_RECYCLE_DIST) {
        const pt = ringPoint(900, 1800);
        e.x = pt.x;
        e.y = pt.y;
      }
    }
    for (let i = live; i < targetEnemies; i++) spawnEnemy();
  };

  const spawnEnemy = (isBoss = false) => {
    const s = state.current;
    // Spawn away from the player.
    //
    // Bounded retry rather than an open `do/while`. In practice the arena is
    // always far larger than the 400px exclusion so the first sample almost
    // always passes - but an unbounded loop here would hang the entire game
    // rather than degrade, and that's not a risk worth carrying for free.
    let ex = 0, ey = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      ex = randomRange(0, s.arena.w);
      ey = randomRange(0, s.arena.h);
      if (dist(ex, ey, s.player.x, s.player.y) >= 400) break;
    }

    if (isBoss) {
      s.enemies.push({
        id: entityIdCounter++,
        x: ex, y: ey,
        r: s.player.r * 2.5, // Boss is always bigger
        vx: 0, vy: 0,
        color: COLORS.boss, glow: COLORS.bossGlow,
        type: 'boss',
        shootTimer: 0,
      });
    } else {
      // Size and speed both follow the flow controller: mostly edible cells
      // when the player is on the back foot, genuine threats when they aren't.
      const [minMult, maxMult] = enemySizeRange(s.flow);
      const sizeMult = randomRange(minMult, maxMult);
      const spd = 1.5 * challenge(s.flow);
      s.enemies.push({
        id: entityIdCounter++,
        x: ex, y: ey,
        r: Math.max(10, s.player.r * sizeMult),
        vx: randomRange(-spd, spd), vy: randomRange(-spd, spd),
        color: COLORS.enemy, glow: COLORS.enemyGlow,
        type: 'normal',
        shootTimer: 0,
      });
    }
  };

  /**
   * You can absorb a cell only if you are this much bigger than it, and it can
   * absorb you on the same terms.
   *
   * Shooting keys off the SAME constant. When it didn't, there was a dead band
   * of cells you could neither eat nor shoot at - the player would close on
   * something, nothing would happen, and it read as the gun being broken.
   */
  const EAT_RATIO = 1.1;

  /** Player radius at which the run ends. */
  const DEATH_R = 10;

  const MAX_PARTICLES = 220;

  const spawnParticles = (x: number, y: number, color: string, count: number) => {
    const s = state.current;
    // Boss deaths spawn in bursts; without a ceiling a busy moment can leave
    // hundreds of particles alive at once and tank the frame rate.
    const room = Math.max(0, MAX_PARTICLES - s.particles.length);
    const n = Math.min(count, room);
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = randomRange(1, 5);
      s.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        maxLife: randomRange(20, 40),
        color,
        size: randomRange(2, 6),
      });
    }
  };

  const REVIVE_COST = 200;

  // Rewarded ads are not integrated yet. showRewardedAd() below is a stub that
  // grants the reward after a 2s delay, so shipping the button would advertise
  // functionality the app does not have. Flip this to true in the same release
  // that wires up a real ad SDK.
  const ADS_ENABLED = false;

  const gameOver = (died = true) => {
    const s = state.current;
    if (s.status !== 'playing' && s.status !== 'paused') return; // Guard against double calls

    // Death vibration (supported on Android; iOS Safari silently ignores it)
    if (died && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([120, 60, 240]);
      } catch {
        // Vibration blocked — not critical
      }
    }

    // Offer one revive per run on a real death (not when quitting from pause)
    if (died && !s.reviveUsed) {
      s.status = 'reviving';
      s.joystick.active = false;
      setReviveCountdown(5); // Reset BEFORE showing the screen, so a stale 0 can't auto-dismiss it
      setUiState(p => ({ ...p, status: 'reviving' }));
      return;
    }

    finalizeGameOver();
  };

  const finalizeGameOver = () => {
    const s = state.current;
    if (s.status === 'gameover' || s.status === 'menu') return;
    sfx.gameOver();
    haptics.gameOver();
    s.status = 'gameover';

    // Bank this run's score as spendable points + update lifetime stats
    const prev = saveRef.current;
    const updated: SaveData = {
      ...prev,
      coins: prev.coins + s.score,
      bestScore: Math.max(prev.bestScore, s.score),
      bestLevel: Math.max(prev.bestLevel, s.level),
      gamesPlayed: prev.gamesPlayed + 1,
      enemiesDestroyed: prev.enemiesDestroyed + s.runEnemiesDestroyed,
      bossesKilled: prev.bossesKilled + s.runBossesKilled,
    };
    const { save: withTrophies, newly } = checkTrophies(updated);
    setSave(withTrophies);
    setNewTrophies(newly);
    if (newly.length > 0) { sfx.trophy(); haptics.trophy(); }

    setUiState(p => ({ ...p, status: 'gameover' }));
  };

  // === AD HOOK ===
  // Replace the body of this function with a real rewarded-ad SDK call
  // (e.g. CrazyGames SDK, Poki SDK, or Google Ad Placement API) and call
  // onReward() in the ad network's "ad completed" callback.
  // Currently simulated with a short delay so the flow can be tested.
  const showRewardedAd = (onReward: () => void) => {
    setAdPlaying(true);
    window.setTimeout(() => {
      setAdPlaying(false);
      onReward();
    }, 2000);
  };

  const reviveNow = () => {
    const s = state.current;
    if (s.status !== 'reviving') return;
    s.reviveUsed = true;
    s.player.r = 25; // Respawn small but viable
    s.player.invincibleTimer = 180; // ~3 seconds of safety at 60fps
    // Clear any threats sitting on top of the player
    s.enemies = s.enemies.filter(e => dist(e.x, e.y, s.player.x, s.player.y) > 300);
    s.status = 'playing';
    setUiState(p => ({ ...p, status: 'playing' }));
  };

  const reviveWithPoints = () => {
    if (state.current.status !== 'reviving') return;
    if (saveRef.current.coins < REVIVE_COST) return;
    setSave(prev => ({ ...prev, coins: prev.coins - REVIVE_COST }));
    reviveNow();
  };

  const reviveWithAd = () => {
    if (state.current.status !== 'reviving') return;
    showRewardedAd(reviveNow);
  };

  const goToMenu = () => {
    state.current.status = 'menu';
    setScreen('home');
    setUiState(p => ({ ...p, status: 'menu' }));
  };

  const pauseGame = () => {
    if (state.current.status !== 'playing') return;
    state.current.status = 'paused';
    state.current.joystick.active = false;
    setUiState(p => ({ ...p, status: 'paused' }));
  };

  const resumeGame = () => {
    if (state.current.status !== 'paused') return;
    state.current.status = 'playing';
    setUiState(p => ({ ...p, status: 'playing' }));
  };

  // Quit from pause: run ends, points still get banked, but no death vibration
  const quitRun = () => gameOver(false);

  const buySkin = (skin: Skin) => {
    setSave(prev => {
      if (prev.ownedSkins.includes(skin.id) || prev.coins < skin.price) return prev;
      const bought: SaveData = {
        ...prev,
        coins: prev.coins - skin.price,
        ownedSkins: [...prev.ownedSkins, skin.id],
        equippedSkin: skin.id,
      };
      return checkTrophies(bought).save;
    });
  };

  const equipSkin = (skin: Skin) => {
    setSave(prev => (prev.ownedSkins.includes(skin.id) ? { ...prev, equippedSkin: skin.id } : prev));
  };

  const update = () => {
    const s = state.current;
    if (s.status !== 'playing') return;

    // --- Player Movement ---
    let targetVx = 0;
    let targetVy = 0;
    const baseSpeed = 2.5; // Slower, relaxed pace
    const speedMult = s.player.speedBoostTimer > 0 ? 1.8 : 1;
    const currentSpeed = baseSpeed * speedMult * (20 / Math.max(20, s.player.r * 0.5)); // Slower when bigger

    if (s.joystick.active) {
      const dx = s.joystick.currX - s.joystick.originX;
      const dy = s.joystick.currY - s.joystick.originY;
      const distance = Math.hypot(dx, dy);
      const maxDist = 50;
      const normalizedDist = Math.min(distance, maxDist) / maxDist;
      
      if (distance > 0) {
        targetVx = (dx / distance) * currentSpeed * normalizedDist;
        targetVy = (dy / distance) * currentSpeed * normalizedDist;
      }
    }

    // Smooth velocity
    s.player.vx += (targetVx - s.player.vx) * 0.1;
    s.player.vy += (targetVy - s.player.vy) * 0.1;

    s.player.x += s.player.vx;
    s.player.y += s.player.vy;

    // Constrain player to arena
    s.player.x = Math.max(s.player.r, Math.min(s.arena.w - s.player.r, s.player.x));
    s.player.y = Math.max(s.player.r, Math.min(s.arena.h - s.player.r, s.player.y));

    // Shake and flash decay exponentially: sharp onset, quick settle. A linear
    // decay reads as the camera drifting back rather than snapping.
    s.shake *= 0.86;
    if (s.shake < 0.15) s.shake = 0;
    s.hurtFlash *= 0.92;
    if (s.hurtFlash < 0.01) s.hurtFlash = 0;

    updateFlow(s.flow, s.player.r);

    // Four times a second is plenty: distances change slowly relative to the
    // recycle thresholds, and a full pass over ~200 orbs is trivial.
    s.maintTick++;
    if (s.maintTick % 15 === 0) maintainWorld();

    // Hunger mechanic (shrink over time)
    // Lose about 1% of size every 5 seconds (at ~60 FPS, 5 sec = 300 frames)
    s.player.r -= s.player.r * (0.01 / 300);
    if (s.player.r < 10) {
      gameOver();
      return;
    }

    if (s.player.speedBoostTimer > 0) s.player.speedBoostTimer--;
    if (s.player.invincibleTimer > 0) s.player.invincibleTimer--;
    if (s.player.magnetTimer > 0) s.player.magnetTimer--;
    if (s.freezeTimer > 0) s.freezeTimer--;
    if (s.radarTimer > 0) s.radarTimer--;

    // Spawn a power-up every ~10-16 seconds (max 2 on the map at once)
    s.powerupTimer--;
    if (s.powerupTimer <= 0) {
      s.powerupTimer = powerupDelay(s.flow);
      const onMap = s.orbs.filter(o => o.type === 'shield' || o.type === 'magnet' || o.type === 'freeze' || o.type === 'radar').length;
      if (onMap < 2) {
        const kinds = ['shield', 'magnet', 'freeze', 'radar'] as const;
        const kind = kinds[Math.floor(Math.random() * kinds.length)];
        const styles = {
          shield: { color: COLORS.shield, glow: COLORS.shieldGlow },
          magnet: { color: COLORS.magnet, glow: COLORS.magnetGlow },
          freeze: { color: COLORS.freeze, glow: COLORS.freezeGlow },
          radar: { color: COLORS.radar, glow: COLORS.radarGlow },
        } as const;
        s.orbs.push({
          id: entityIdCounter++,
          x: randomRange(60, s.arena.w - 60),
          y: randomRange(60, s.arena.h - 60),
          r: 11, vx: 0, vy: 0,
          color: styles[kind].color, glow: styles[kind].glow,
          type: kind,
        });
      }
    }

    // --- Camera ---
    if (canvasRef.current) {
      // CSS pixels, not canvas.width. The backing store is scaled by the
      // device pixel ratio, but draw() renders in CSS pixels - mixing the
      // two puts the player off-centre by half the DPR difference.
      const cw = canvasRef.current.clientWidth;
      const ch = canvasRef.current.clientHeight;
      // Smooth camera follow
      s.camera.x += (s.player.x - cw / 2 - s.camera.x) * 0.1;
      s.camera.y += (s.player.y - ch / 2 - s.camera.y) * 0.1;
      
      // Clamp camera to arena bounds (optional, but feels good if arena is bounded)
      s.camera.x = Math.max(0, Math.min(s.arena.w - cw, s.camera.x));
      s.camera.y = Math.max(0, Math.min(s.arena.h - ch, s.camera.y));
    }

    // --- Player Auto-Shooting ---
    if (s.player.shootTimer > 0) {
      s.player.shootTimer--;
    } else {
      // Find the closest *threat* in range.
      //
      // Previously this targeted anything, including cells small enough to
      // simply eat - so the game spent your size shooting at your own food.
      // Only cells you cannot safely absorb are worth paying for.
      let closestEnemy: Enemy | null = null;
      let closestDist = 400; // Shooting range
      for (const enemy of s.enemies) {
        if (enemy.type === 'projectile') continue;
        // Every enemy in range is a target.
        //
        // This briefly skipped anything small enough to eat, on the reasoning
        // that shooting your own food wastes size. That was wrong once the shot
        // cost came down: a small cell dies to one or two hits and drops four
        // loot orbs, so killing it is now size-POSITIVE. And to the player it
        // simply looked like the gun was broken - an enemy sat there, red and
        // obvious, and nothing happened.
        const d = dist(s.player.x, s.player.y, enemy.x, enemy.y);
        if (d < closestDist) {
          closestDist = d;
          closestEnemy = enemy;
        }
      }

      // Shot cost scales with size.
      //
      // A flat 0.2 is 0.4% of a size-50 cell but nearly 2% of a size-11 one -
      // so the same mechanic was trivial when you were winning and crippling
      // when you were losing.
      const shotCost = Math.min(0.2, Math.max(0.06, s.player.r * 0.008));

      // Fire whenever the shot cannot itself put you in danger, rather than
      // above an arbitrary size.
      //
      // The old gate was `r > 12` with death at 10. Projectile kills give no
      // size back (the loot orbs are the reward, and you can't collect those
      // mid-fight), so two fights landed you around 11.4 and the gun switched
      // off silently - in exactly the band where you most need it. Being
      // disarmed right before dying is the worst possible moment for it.
      if (closestEnemy && s.player.r - shotCost > DEATH_R + 0.5) {
        const angle = Math.atan2(closestEnemy.y - s.player.y, closestEnemy.x - s.player.x);

        // Muzzle offset: spawn on the rim of the cell, not at its centre.
        //
        // From the centre a shot had to cross the whole radius before it became
        // visible - 100ms at r=48, drawn underneath the player the entire time.
        // Against an enemy already touching you it could hit and vanish without
        // ever being seen, which is why the gun looked like it wasn't firing.
        //
        // PROJECTILE_R is subtracted so the shot's leading edge sits exactly on
        // the surface rather than poking outside it.
        const PROJECTILE_R = 4;
        const muzzle = Math.max(0, s.player.r - PROJECTILE_R);

        // The offset follows the AIM direction, not the movement direction.
        // Following movement would put the muzzle on the far side whenever you
        // fired while retreating, and the shot would travel back through your
        // own body - reintroducing exactly the bug this fixes.
        s.playerProjectiles.push({
          id: entityIdCounter++,
          x: s.player.x + Math.cos(angle) * muzzle,
          y: s.player.y + Math.sin(angle) * muzzle,
          r: PROJECTILE_R,
          vx: Math.cos(angle) * 8,
          vy: Math.sin(angle) * 8,
          color: COLORS.player,
          glow: COLORS.playerGlow,
        });
        // Originally 0.5 every 15 ticks = -2 r/s, fifty times the hunger rate:
        // four orbs a second just to break even, and death from full size in
        // five seconds of fire. Now at most -0.6 r/s, and less when small.
        s.player.r -= shotCost;
        s.player.shootTimer = 20; // 3 shots/second at 60 ticks/s
        sfx.shoot();
      }
    }

    // --- Player Projectiles ---
    for (let i = s.playerProjectiles.length - 1; i >= 0; i--) {
      const proj = s.playerProjectiles[i];
      proj.x += proj.vx;
      proj.y += proj.vy;

      // Remove if off arena
      if (proj.x < 0 || proj.x > s.arena.w || proj.y < 0 || proj.y > s.arena.h) {
        s.playerProjectiles.splice(i, 1);
        continue;
      }

      // Check collision with enemies
      let hit = false;
      for (let j = s.enemies.length - 1; j >= 0; j--) {
        const enemy = s.enemies[j];
        if (enemy.type === 'projectile') continue;
        
        if (dist(proj.x, proj.y, enemy.x, enemy.y) < proj.r + enemy.r) {
          hit = true;
          enemy.r -= 2; // Damage to enemy
          spawnParticles(proj.x, proj.y, COLORS.player, 5);
          
          if (enemy.r < 10) {
            // Enemy killed by projectile
            s.score += enemy.type === 'boss' ? 50 : 10;
            s.runEnemiesDestroyed++;
            if (enemy.type === 'boss') { s.runBossesKilled++; sfx.bossKill(); haptics.bossKill(); s.shake = Math.max(s.shake, 15); } else { sfx.enemyKill(); haptics.kill(); s.shake = Math.max(s.shake, 3); }
            noteKill(s.flow);
            spawnParticles(enemy.x, enemy.y, enemy.color, 15);
            s.enemies.splice(j, 1);
            
            // Drop loot
            const numLoot = enemy.type === 'boss' ? 15 : 4;
            for (let l = 0; l < numLoot; l++) {
              const isSpeed = Math.random() < 0.2;
              s.orbs.push({
                id: entityIdCounter++,
                x: enemy.x + randomRange(-enemy.r, enemy.r),
                y: enemy.y + randomRange(-enemy.r, enemy.r),
                r: isSpeed ? 8 : 4,
                vx: 0, vy: 0,
                color: isSpeed ? COLORS.speedOrb : COLORS.orb,
                glow: isSpeed ? COLORS.speedOrbGlow : COLORS.orbGlow,
                type: isSpeed ? 'speed' : 'normal',
              });
            }
            
            if (enemy.type === 'boss') {
              s.level++;
              s.arena.w += 500;
              s.arena.h += 500;
              for(let k=0; k<20; k++) spawnOrb();
              for(let k=0; k<2; k++) spawnEnemy();
            } else {
              spawnEnemy();
            }
          }
          break; // Projectile destroyed
        }
      }
      
      if (hit) {
        s.playerProjectiles.splice(i, 1);
      }
    }

    // --- Orbs ---
    for (let i = s.orbs.length - 1; i >= 0; i--) {
      const orb = s.orbs[i];
      // Magnet: pull nearby orbs toward the player
      if (s.player.magnetTimer > 0) {
        const dm = dist(s.player.x, s.player.y, orb.x, orb.y);
        if (dm < 300 && dm > 1) {
          orb.x += ((s.player.x - orb.x) / dm) * 5;
          orb.y += ((s.player.y - orb.y) / dm) * 5;
        }
      }
      if (dist(s.player.x, s.player.y, orb.x, orb.y) < s.player.r + orb.r) {
        // Eat orb / collect power-up
        const isPowerup = orb.type === 'shield' || orb.type === 'magnet' || orb.type === 'freeze' || orb.type === 'radar';
        if (orb.type === 'shield') s.player.invincibleTimer = 300; // 5s of invincibility
        if (orb.type === 'magnet') s.player.magnetTimer = 360; // 6s of orb-pulling
        if (orb.type === 'freeze') s.freezeTimer = 240; // 4s: all enemies stop
        if (orb.type === 'radar') s.radarTimer = 480; // 8s minimap
        s.player.r += orb.type === 'speed' ? 2 : isPowerup ? 0 : 0.5;
        s.score += orb.type === 'speed' ? 5 : isPowerup ? 10 : 1;
        if (orb.type === 'speed') s.player.speedBoostTimer = 180; // 3 seconds at 60fps
        
        if (isPowerup) { sfx.powerup(); haptics.powerup(); }
        else if (orb.type === 'speed') sfx.speedOrb();
        else sfx.orb();
        spawnParticles(orb.x, orb.y, orb.color, isPowerup ? 12 : 5);
        s.orbs.splice(i, 1);
        if (!isPowerup) spawnOrb(); // Replace normal orbs only
      }
    }

    // --- Enemies ---
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const enemy = s.enemies[i];
      
      // Enemy AI (fully suspended while frozen)
      const frozen = s.freezeTimer > 0;
      if (frozen) {
        // No thinking, no shooting, no moving
      } else if (enemy.type === 'normal') {
        // Roam or chase/flee
        const d = dist(s.player.x, s.player.y, enemy.x, enemy.y);
        if (d < 300) {
          const angle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
          const speed = enemy.r > s.player.r ? 0.6 : -0.6; // chase if bigger, flee if smaller (slow pace)
          enemy.vx += (Math.cos(angle) * speed - enemy.vx) * 0.05;
          enemy.vy += (Math.sin(angle) * speed - enemy.vy) * 0.05;
        }
        
        // Random wander if slow
        if (Math.hypot(enemy.vx, enemy.vy) < 0.3) {
          enemy.vx += randomRange(-0.3, 0.3);
          enemy.vy += randomRange(-0.3, 0.3);
        }

        // Predator cells shoot as well as chase.
        //
        // Same idea as the boss attack, but the shot travels 2.2 vs the boss's
        // 3.5 and is smaller, so it stays readable and dodgeable when several
        // cells are firing at once. Only cells that already outclass you fire,
        // so what's shooting at you is always what's hunting you.
        if (enemy.r > s.player.r * 1.15 && d < 650) {
          enemy.shootTimer++;
          const cadence = Math.round(240 / challenge(s.flow));
          enemy.shootCadence = cadence;
          if (enemy.shootTimer > cadence) {
            enemy.shootTimer = 0;
            const aim = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
            s.enemies.push({
              id: entityIdCounter++,
              x: enemy.x, y: enemy.y,
              r: 6,
              vx: Math.cos(aim) * 2.2, vy: Math.sin(aim) * 2.2,
              color: COLORS.projectile, glow: COLORS.projectile,
              type: 'projectile',
              shootTimer: 0,
            });
          }
        } else {
          enemy.shootTimer = 0;
          enemy.shootCadence = undefined;
        }
      } else if (enemy.type === 'boss') {
        // Boss moves slowly towards player
        const angle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
        enemy.vx = Math.cos(angle) * 0.3;
        enemy.vy = Math.sin(angle) * 0.3;
        
        // Boss shoots
        enemy.shootTimer++;
        enemy.shootCadence = 120;
        if (enemy.shootTimer > 120) {
          enemy.shootTimer = 0;
          s.enemies.push({
            id: entityIdCounter++,
            x: enemy.x, y: enemy.y,
            r: 8,
            vx: Math.cos(angle) * 3.5, vy: Math.sin(angle) * 3.5,
            color: COLORS.projectile, glow: COLORS.projectile,
            type: 'projectile',
            shootTimer: 0,
          });
        }
      } else if (enemy.type === 'projectile') {
        // Projectiles just move straight
      }

      if (!frozen) {
        enemy.x += enemy.vx;
        enemy.y += enemy.vy;
      }

      // Constrain enemies (except projectiles which die off-screen)
      if (enemy.type !== 'projectile') {
        if (enemy.x < enemy.r || enemy.x > s.arena.w - enemy.r) enemy.vx *= -1;
        if (enemy.y < enemy.r || enemy.y > s.arena.h - enemy.r) enemy.vy *= -1;
        enemy.x = Math.max(enemy.r, Math.min(s.arena.w - enemy.r, enemy.x));
        enemy.y = Math.max(enemy.r, Math.min(s.arena.h - enemy.r, enemy.y));
      } else {
        if (enemy.x < 0 || enemy.x > s.arena.w || enemy.y < 0 || enemy.y > s.arena.h) {
          s.enemies.splice(i, 1);
          continue;
        }
      }

      // Collision with player
      const d = dist(s.player.x, s.player.y, enemy.x, enemy.y);
      if (d < s.player.r + enemy.r) {
        if (enemy.type === 'projectile') {
          if (s.player.invincibleTimer > 0) continue; // Projectiles pass through while invincible
          // Boss shots (r 8) bite harder than predator-cell shots (r 6).
          s.player.r -= enemy.r >= 8 ? 5 : 3;
          sfx.hurt();
          haptics.hurt();
          noteHit(s.flow);
          s.shake = Math.max(s.shake, enemy.r >= 8 ? 11 : 7);
          s.hurtFlash = 1;
          spawnParticles(s.player.x, s.player.y, COLORS.player, 10);
          s.enemies.splice(i, 1);
          if (s.player.r < DEATH_R) gameOver();
        } else if (s.player.r > enemy.r * EAT_RATIO) {
          // Player eats enemy
          s.player.r += enemy.r * 0.2;
          s.score += enemy.type === 'boss' ? 100 : Math.floor(enemy.r);
          s.runEnemiesDestroyed++;
          if (enemy.type === 'boss') { s.runBossesKilled++; sfx.bossKill(); haptics.bossKill(); s.shake = Math.max(s.shake, 15); } else { sfx.enemyKill(); haptics.kill(); s.shake = Math.max(s.shake, 3); }
          spawnParticles(enemy.x, enemy.y, enemy.color, 15);
          s.enemies.splice(i, 1);
          
          // Drop loot
          const numLoot = enemy.type === 'boss' ? 10 : 2;
          for (let l = 0; l < numLoot; l++) {
            const isSpeed = Math.random() < 0.3;
            s.orbs.push({
              id: entityIdCounter++,
              x: enemy.x + randomRange(-30, 30),
              y: enemy.y + randomRange(-30, 30),
              r: isSpeed ? 8 : 4,
              vx: 0, vy: 0,
              color: isSpeed ? COLORS.speedOrb : COLORS.orb,
              glow: isSpeed ? COLORS.speedOrbGlow : COLORS.orbGlow,
              type: isSpeed ? 'speed' : 'normal',
            });
          }
          
          if (enemy.type === 'boss') {
            // Level up!
            s.level++;
            s.arena.w += 500;
            s.arena.h += 500;
            for(let j=0; j<20; j++) spawnOrb();
            for(let j=0; j<2; j++) spawnEnemy();
          } else {
            spawnEnemy(); // Respawn normal enemy
          }
        } else if (enemy.r > s.player.r * EAT_RATIO) {
          // Enemy eats player (unless invincible after a revive)
          if (s.player.invincibleTimer > 0) continue;
          spawnParticles(s.player.x, s.player.y, COLORS.player, 30);
          gameOver();
          return;
        }
      }
    }

    // --- Particles ---
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const p = s.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      if (p.life >= p.maxLife) {
        s.particles.splice(i, 1);
      }
    }

    // --- Level Progression ---
    // Spawn boss every 3 levels (level up every 100 score)
    const newLevel = Math.floor(s.score / 100) + 1;
    if (newLevel > s.level) {
      s.level = newLevel;
      sfx.levelUp();
      haptics.levelUp();
      s.arena.w += 200;
      s.arena.h += 200;
      for(let j=0; j<10; j++) spawnOrb();
      
      if (s.level % 3 === 0 && !s.enemies.some(e => e.type === 'boss')) {
        spawnEnemy(true); // Spawn boss
      } else {
        spawnEnemy(); // Spawn normal enemy
      }
    }

    // Push to React only when a DISPLAYED value actually changes.
    // Calling setUiState with a fresh object every frame re-rendered the whole
    // component 60x/second, which was the single biggest cost in the game.
    const next = {
      status: s.status,
      score: s.score,
      level: s.level,
      size: Math.floor(s.player.r),
      shield: Math.ceil(s.player.invincibleTimer / 60),
      magnet: Math.ceil(s.player.magnetTimer / 60),
      freeze: Math.ceil(s.freezeTimer / 60),
      radar: Math.ceil(s.radarTimer / 60),
    };
    const prev = uiSyncRef.current;
    if (
      prev.status !== next.status ||
      prev.score !== next.score ||
      prev.level !== next.level ||
      prev.size !== next.size ||
      prev.shield !== next.shield ||
      prev.magnet !== next.magnet ||
      prev.freeze !== next.freeze ||
      prev.radar !== next.radar
    ) {
      uiSyncRef.current = next;
      setUiState(next);
    }
  };

  const draw = (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
    const s = state.current;

    // Everything below is themed by stage, so the arena visibly changes every
    // few levels rather than staying one flat blue field forever. The palette
    // is eased rather than switched - see easeToward.
    easeToward(paletteRef.current, themeForLevel(s.level));
    const pal = paletteRef.current;

    // Actual backing-store scale in use. drawCircle needs it to know how many
    // real pixels an entity will occupy, which decides sprite vs path.
    const deviceScale = Math.min(window.devicePixelRatio || 1, dprCapRef.current);

    // Clear background
    ctx.fillStyle = css(pal.bg);
    ctx.fillRect(0, 0, cw, ch);

    if (s.status === 'menu') return;

    ctx.save();
    // Camera shake. Applied to the world transform only, so the HUD and the
    // damage vignette (drawn in screen space) stay rock steady - shaking the
    // UI as well reads as a rendering fault rather than an impact.
    if (s.shake > 0 && !reduceMotionRef.current) {
      ctx.translate(
        (Math.random() - 0.5) * s.shake,
        (Math.random() - 0.5) * s.shake,
      );
    }
    ctx.translate(-s.camera.x, -s.camera.y);

    // --- Grid, two tiers ---
    // A single fine grid gives nothing to judge speed against; coarse lines
    // every 500px make travel readable.
    ctx.strokeStyle = css(pal.grid);
    ctx.lineWidth = 1;
    const gridSize = 100;
    const startX = Math.floor(s.camera.x / gridSize) * gridSize;
    const startY = Math.floor(s.camera.y / gridSize) * gridSize;

    ctx.beginPath();
    for (let x = startX; x < s.camera.x + cw; x += gridSize) {
      ctx.moveTo(x, s.camera.y);
      ctx.lineTo(x, s.camera.y + ch);
    }
    for (let y = startY; y < s.camera.y + ch; y += gridSize) {
      ctx.moveTo(s.camera.x, y);
      ctx.lineTo(s.camera.x + cw, y);
    }
    ctx.stroke();

    const major = 500;
    ctx.strokeStyle = css(pal.gridMajor);
    ctx.beginPath();
    for (let x = Math.floor(s.camera.x / major) * major; x < s.camera.x + cw; x += major) {
      ctx.moveTo(x, s.camera.y);
      ctx.lineTo(x, s.camera.y + ch);
    }
    for (let y = Math.floor(s.camera.y / major) * major; y < s.camera.y + ch; y += major) {
      ctx.moveTo(s.camera.x, y);
      ctx.lineTo(s.camera.x + cw, y);
    }
    ctx.stroke();

    // --- Arena bounds ---
    // A single thin line. The wide glow read as an object in its own right and
    // pulled the eye to the edge of the map instead of the play in front of you.
    ctx.strokeStyle = css(pal.wall);
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s.arena.w, s.arena.h);

    // Helper to draw glowing circles.
    //
    // This used to use ctx.shadowBlur, which is one of the most expensive 2D
    // canvas operations - its cost scales with rendered pixel area, so raising
    // the DPR multiplied it across every orb, enemy, projectile and particle.
    // A translucent halo disc costs two plain fills and looks near-identical
    // at these sizes.
    const drawCircle = (x: number, y: number, r: number, color: string, _glow: string) => {
      // Cull anything outside the viewport before touching the rasteriser.
      if (
        x + r < s.camera.x - 40 || x - r > s.camera.x + cw + 40 ||
        y + r < s.camera.y - 40 || y - r > s.camera.y + ch + 40
      ) return;

      // Flat fill, no halo. A glow ring around every cell competes with the
      // cells themselves for attention and makes sizes harder to judge, which
      // matters in a game about whether something is bigger than you.
      //
      // Sprite or path, decided per entity:
      //
      // Sprites are cached at a fixed SPRITE_R radius. Blitting one is cheaper
      // than filling a path, but only while it's being scaled DOWN. Past 1:1
      // it's magnifying a small bitmap - at size 91 on a 2x screen that's a
      // 2.8x blow-up, and the edge visibly falls apart.
      //
      // The cheap case is also the common one: orbs, projectiles and small
      // enemies number in the hundreds and all sit well under the threshold.
      // Big cells are a handful per frame, and filling a handful of paths
      // costs nothing, so they take the crisp route.
      if (r * deviceScale <= SPRITE_R) {
        ctx.drawImage(spriteFor(color), x - r, y - r, r * 2, r * 2);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };

    // Draw Orbs (power-ups pulse and carry a white glyph)
    s.orbs.forEach(orb => {
      const isPow = orb.type === 'shield' || orb.type === 'magnet' || orb.type === 'freeze' || orb.type === 'radar';
      const rr = isPow ? orb.r + Math.sin(Date.now() / 150) * 2 : orb.r;
      drawCircle(orb.x, orb.y, rr, orb.color, orb.glow);
      if (!isPow) return;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (orb.type === 'shield') {
        ctx.arc(orb.x, orb.y, rr * 0.5, 0, Math.PI * 2);
      } else if (orb.type === 'magnet') {
        const u = rr * 0.45;
        ctx.arc(orb.x, orb.y + u * 0.2, u, Math.PI, 0, true);
        ctx.moveTo(orb.x - u, orb.y + u * 0.2);
        ctx.lineTo(orb.x - u, orb.y - u * 0.6);
        ctx.moveTo(orb.x + u, orb.y + u * 0.2);
        ctx.lineTo(orb.x + u, orb.y - u * 0.6);
      } else if (orb.type === 'freeze') {
        for (let a = 0; a < 3; a++) {
          const ang = (Math.PI / 3) * a;
          ctx.moveTo(orb.x - Math.cos(ang) * rr * 0.55, orb.y - Math.sin(ang) * rr * 0.55);
          ctx.lineTo(orb.x + Math.cos(ang) * rr * 0.55, orb.y + Math.sin(ang) * rr * 0.55);
        }
      } else {
        // Radar: circle with a sweep line
        ctx.arc(orb.x, orb.y, rr * 0.55, 0, Math.PI * 2);
        ctx.moveTo(orb.x, orb.y);
        ctx.lineTo(orb.x + rr * 0.55 * Math.cos(Date.now() / 300), orb.y + rr * 0.55 * Math.sin(Date.now() / 300));
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    });

    // Draw Enemies (dimmed while frozen)
    const enemiesFrozen = s.freezeTimer > 0;
    s.enemies.forEach(enemy => {
      if (enemiesFrozen) ctx.globalAlpha = 0.5;

      // Colour by relationship, not by type. The single most important thing
      // to read in this game is "can that eat me, or can I eat it?", and
      // judging it by comparing two circles by eye is unreliable at speed.
      const isPrey =
        enemy.type === 'normal' && s.player.r > enemy.r * EAT_RATIO;
      drawCircle(
        enemy.x, enemy.y, enemy.r,
        isPrey ? COLORS.enemyPrey : enemy.color,
        isPrey ? COLORS.enemyPreyGlow : enemy.glow,
      );

      // Wind-up telegraph.
      //
      // Without this a shot simply appears and the hit feels arbitrary rather
      // than earned. A ring contracts onto the cell over the last 30 ticks
      // (half a second) before it fires - long enough to react, short enough
      // not to nag. Frozen enemies never fire, so never telegraph.
      const cadence = enemy.shootCadence;
      if (!enemiesFrozen && cadence && enemy.type !== 'projectile') {
        const remaining = cadence - enemy.shootTimer;
        if (remaining > 0 && remaining <= 30) {
          const t = 1 - remaining / 30;          // 0 -> 1 as the shot nears
          const ring = enemy.r + 26 * (1 - t);   // contracts onto the cell
          ctx.save();
          ctx.globalAlpha = (enemiesFrozen ? 0.5 : 1) * (0.25 + 0.55 * t);
          ctx.strokeStyle = COLORS.projectile;
          ctx.lineWidth = 2 + 2 * t;
          ctx.beginPath();
          ctx.arc(enemy.x, enemy.y, ring, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
      // Boss: white ring + angry dash eyes
      if (enemy.type === 'boss') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.r - 5, 0, Math.PI * 2);
        ctx.stroke();

        const er = enemy.r;
        ctx.strokeStyle = '#020617';
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(4, er * 0.16);
        ctx.beginPath();
        // Left angry slit: high-outside, low-inside
        ctx.moveTo(enemy.x - er * 0.5, enemy.y - er * 0.4);
        ctx.lineTo(enemy.x - er * 0.12, enemy.y - er * 0.12);
        // Right angry slit (mirrored)
        ctx.moveTo(enemy.x + er * 0.5, enemy.y - er * 0.4);
        ctx.lineTo(enemy.x + er * 0.12, enemy.y - er * 0.12);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
      ctx.globalAlpha = 1;
    });

    // Draw Particles
    // Additive blending: overlapping particles brighten each other, which
    // reads as glow without any lighting maths or blur. Restored to
    // source-over immediately after so nothing else is affected.
    ctx.globalCompositeOperation = 'lighter';
    s.particles.forEach(p => {
      if (
        p.x < s.camera.x - 20 || p.x > s.camera.x + cw + 20 ||
        p.y < s.camera.y - 20 || p.y > s.camera.y + ch + 20
      ) return;
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });
    ctx.globalCompositeOperation = 'source-over';

    // Draw Player
    if (s.status === 'playing' || s.status === 'paused' || s.status === 'reviving') {
      let pColor = s.player.color;
      let pGlow = s.player.glow;
      if (skinRef.current.prism) {
        // Quantised to 10-degree steps: the prism skin cycles hue every frame,
        // and an unquantised value would add a new cached sprite each time.
        const hue = Math.floor((Date.now() / 15) % 360 / 10) * 10;
        pColor = `hsl(${hue}, 100%, 60%)`;
        pGlow = `hsla(${hue}, 100%, 60%, 0.8)`;
      }
      // Flash while invincible after a revive
      if (s.player.invincibleTimer > 0) {
        ctx.globalAlpha = 0.45 + 0.35 * Math.abs(Math.sin(Date.now() / 90));
      }
      drawCircle(s.player.x, s.player.y, s.player.r, pColor, pGlow);
      ctx.globalAlpha = 1;
      
      // Speed boost indicator
      if (s.player.speedBoostTimer > 0) {
        ctx.strokeStyle = COLORS.speedOrb;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(s.player.x, s.player.y, s.player.r + 5 + Math.sin(Date.now() / 100) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Player projectiles, drawn AFTER the player.
    // Previously they were drawn before it, so the player's own body painted
    // over every shot still inside its radius.
    s.playerProjectiles.forEach(proj =>
      drawCircle(proj.x, proj.y, proj.r, proj.color, proj.glow),
    );

    ctx.restore();

    // --- Damage vignette (screen space) ---
    // Peripheral rather than a full-screen flash: it tells you that you were
    // hit without washing out the thing that hit you.
    if (s.hurtFlash > 0) {
      const g = ctx.createRadialGradient(
        cw / 2, ch / 2, Math.min(cw, ch) * 0.3,
        cw / 2, ch / 2, Math.max(cw, ch) * 0.72,
      );
      g.addColorStop(0, 'rgba(244,63,94,0)');
      g.addColorStop(1, `rgba(244,63,94,${0.5 * s.hurtFlash})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }

    // --- Radar Minimap (screen space, bottom-right) ---
    if (s.radarTimer > 0 && (s.status === 'playing' || s.status === 'paused')) {
      const mw = 120;
      const mh = Math.max(60, Math.round(mw * (s.arena.h / s.arena.w)));
      const mx = cw - mw - 12;
      const my = ch - mh - 12;
      ctx.save();
      // Fade/blink in the final 1.5 seconds
      if (s.radarTimer < 90) ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(Date.now() / 120));
      ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = COLORS.radar;
      ctx.lineWidth = 3;
      ctx.strokeRect(mx, my, mw, mh);

      const sx = mw / s.arena.w;
      const sy = mh / s.arena.h;
      const dot = (wx: number, wy: number, r: number, color: string) => {
        ctx.beginPath();
        ctx.arc(mx + wx * sx, my + wy * sy, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      };
      // Power-ups
      s.orbs.forEach(o => {
        if (o.type === 'shield' || o.type === 'magnet' || o.type === 'freeze' || o.type === 'radar') {
          dot(o.x, o.y, 2.5, o.color);
        }
      });
      // Enemies (bosses bigger)
      s.enemies.forEach(e => {
        if (e.type === 'projectile') return;
        dot(e.x, e.y, e.type === 'boss' ? 4 : 2, COLORS.enemy);
      });
      // Player
      dot(s.player.x, s.player.y, 3, COLORS.player);
      ctx.restore();
    }

    // Draw Joystick
    if (s.joystick.active) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(s.joystick.originX, s.joystick.originY, 50, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(s.joystick.currX, s.joystick.currY, 25, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.fill();
      ctx.restore();
    }
  };

  // --- Main Loop ---
  useEffect(() => {
    let animationFrameId: number;
    stepRef.current.last = performance.now();
    stepRef.current.acc = 0;

    const loop = () => {
      // Adaptive resolution.
      // Rather than guessing what a phone can handle, sample real frame times
      // and drop the backing-store scale if we can't hold ~50fps. Halving the
      // DPR quarters the pixels being filled, which is the cheapest big win
      // available on a fill-rate-bound canvas game.
      const now = performance.now();
      if (fpsRef.current.last > 0) {
        const dt = now - fpsRef.current.last;
        fpsRef.current.acc += dt;
        fpsRef.current.frames++;
        if (fpsRef.current.acc >= 2000) {
          const fps = (fpsRef.current.frames * 1000) / fpsRef.current.acc;
          if (fps < 50 && dprCapRef.current > 1) dprCapRef.current = 1;
          else if (fps > 58 && dprCapRef.current < 2) dprCapRef.current = 2;
          fpsRef.current.acc = 0;
          fpsRef.current.frames = 0;
        }
      }
      fpsRef.current.last = now;

      // Fixed timestep.
      //
      // Every timer in this game is a frame count (invincibleTimer = 180,
      // "3 seconds at 60fps") and movement is per-frame, so tying update() to
      // requestAnimationFrame made the whole game run at the display's refresh
      // rate: half speed at 30fps, DOUBLE speed on a 120Hz phone. Difficulty
      // literally depended on which handset you owned.
      //
      // Now update() runs exactly 60 logical ticks per second on every device,
      // and drawing happens as often as the screen allows. None of the balance
      // constants change meaning.
      let frameTime = now - stepRef.current.last;
      stepRef.current.last = now;
      // A long stall (app backgrounded, GC pause) must not queue up hundreds
      // of catch-up ticks - that "spiral of death" would freeze the game.
      if (frameTime > 250) frameTime = 250;
      stepRef.current.acc += frameTime;

      let ticks = 0;
      while (stepRef.current.acc >= STEP_MS && ticks < MAX_CATCHUP) {
        update();
        stepRef.current.acc -= STEP_MS;
        ticks++;
      }
      if (ticks >= MAX_CATCHUP) stepRef.current.acc = 0;

      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Handle resize.
          // The backing store is sized in DEVICE pixels and the context is
          // scaled, so draw() keeps working in CSS pixels and the touch
          // handlers (which use getBoundingClientRect) stay correct.
          // Capped at 2x: 3x on a 1080p phone triples fill cost for no
          // visible gain on a canvas this simple.
          if (containerRef.current) {
            const { clientWidth, clientHeight } = containerRef.current;
            const dpr = Math.min(window.devicePixelRatio || 1, dprCapRef.current);
            const bw = Math.round(clientWidth * dpr);
            const bh = Math.round(clientHeight * dpr);
            if (canvas.width !== bw || canvas.height !== bh) {
              canvas.width = bw;
              canvas.height = bh;
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw(ctx, clientWidth, clientHeight);
          }
        }
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Android hardware/gesture back.
  // Default Capacitor behaviour exits the app outright, which throws away a
  // run mid-game. Pause instead, and only exit from the title screen.
  useEffect(() => {
    let remove: (() => void) | undefined;
    let cancelled = false;

    void import('@capacitor/app')
      .then(({ App: CapApp }) =>
        CapApp.addListener('backButton', () => {
          const st = state.current.status;
          if (st === 'playing') {
            state.current.status = 'paused';
            state.current.joystick.active = false;
            setUiState(p => ({ ...p, status: 'paused' }));
          } else if (st === 'paused' || st === 'gameover' || st === 'reviving') {
            goToMenu();
          } else if (screenRef.current !== 'home') {
            setScreen('home');
          } else {
            void CapApp.exitApp();
          }
        }),
      )
      .then(handle => {
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => {
        // Running in a plain browser - no native back button to bind.
      });

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  // Announce a new stage when the level crosses a stage boundary.
  useEffect(() => {
    if (uiState.status !== 'playing') return;
    if (stageNumber(uiState.level) === stageNumber(uiState.level - 1)) return;
    setStageBanner(`Stage ${stageNumber(uiState.level)} — ${stageName(uiState.level)}`);
    const t = window.setTimeout(() => setStageBanner(null), 2200);
    return () => window.clearTimeout(t);
  }, [uiState.level, uiState.status]);

  // Music follows the run: it plays only while actually playing, and fades
  // rather than cutting so pausing doesn't feel like a glitch.
  useEffect(() => {
    if (uiState.status === 'playing' && !muted) startMusic();
    else stopMusic();
  }, [uiState.status, muted]);

  // Tempo and filter brightness rise with the level.
  useEffect(() => {
    setMusicIntensity(uiState.level);
  }, [uiState.level]);

  useEffect(() => stopMusic, []);

  // Auto-pause when the tab/app goes to the background
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && state.current.status === 'playing') {
        state.current.status = 'paused';
        state.current.joystick.active = false;
        setUiState(p => ({ ...p, status: 'paused' }));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Revive countdown: 5 seconds to decide, paused while the (simulated) ad plays
  useEffect(() => {
    if (uiState.status !== 'reviving' || adPlaying) return;
    setReviveCountdown(5);
    const iv = window.setInterval(() => setReviveCountdown(c => {
      // Tick the last few seconds so the deadline is felt, not just seen.
      if (c <= 4 && c > 1) haptics.countdown();
      return c - 1;
    }), 1000);
    return () => window.clearInterval(iv);
  }, [uiState.status, adPlaying]);

  useEffect(() => {
    if (uiState.status === 'reviving' && !adPlaying && reviveCountdown <= 0) {
      finalizeGameOver();
    }
  });

  // --- Input Handling ---
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    if (state.current.status !== 'playing') return;
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      state.current.joystick = { active: true, originX: x, originY: y, currX: x, currY: y };
    }
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (!state.current.joystick.active) return;
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      
      // Constrain joystick knob
      const dx = x - state.current.joystick.originX;
      const dy = y - state.current.joystick.originY;
      const dist = Math.hypot(dx, dy);
      const maxDist = 50;
      
      if (dist > maxDist) {
        state.current.joystick.currX = state.current.joystick.originX + (dx / dist) * maxDist;
        state.current.joystick.currY = state.current.joystick.originY + (dy / dist) * maxDist;
      } else {
        state.current.joystick.currX = x;
        state.current.joystick.currY = y;
      }
    }
  };

  const handleTouchEnd = () => {
    state.current.joystick.active = false;
  };

  /**
   * Offscreen sprite cache.
   *
   * Cells were drawn with arc() + fill() per entity - up to ~250 paths a
   * frame once orbs, enemies and particles are counted. A path fill costs
   * rasteriser setup every time; drawImage of a pre-rendered bitmap does not.
   *
   * Sprites are keyed by colour and cached at a fixed 64px radius, then scaled
   * at draw time. Caching per radius instead would mean a new bitmap every
   * time the player grows by half a pixel.
   */
  const spriteCache = useRef(new Map<string, HTMLCanvasElement>());

  /**
   * Radius at which sprites are rasterised, and the cutover point.
   *
   * Anything that would render larger than this in real device pixels is drawn
   * as a path instead - scaling a bitmap up past 1:1 is what made large cells
   * look low-resolution.
   *
   * 64 rather than 128 to bound memory: each sprite is (2R)^2 x 4 bytes, and
   * the prism skin alone contributes 36 quantised hues. At 64 the whole cache
   * is ~3 MB; at 128 it would be ~11.5 MB, which is real money on a mid-range
   * phone. Everything above the cutover draws as a path anyway, so the larger
   * bitmap would buy nothing.
   */
  const SPRITE_R = 64;

  /** Guard against unbounded growth if a skin ever introduces more colours. */
  const SPRITE_CACHE_MAX = 64;

  const spriteFor = (color: string): HTMLCanvasElement => {
    const cached = spriteCache.current.get(color);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = c.height = SPRITE_R * 2;
    const g = c.getContext('2d');
    if (g) {
      g.beginPath();
      g.arc(SPRITE_R, SPRITE_R, SPRITE_R, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
    }
    if (spriteCache.current.size >= SPRITE_CACHE_MAX) spriteCache.current.clear();
    spriteCache.current.set(color, c);
    return c;
  };

  // --- UI helpers ---
  // Legend swatches are driven by the same COLORS the renderer uses, so the
  // how-to-play screen can never describe a colour the game no longer draws.
  const Dot = ({ color, size = 16 }: { color: string; size?: number }) => (
    <span
      className="shrink-0 rounded-full"
      style={{ width: size, height: size, backgroundColor: color }}
      aria-hidden
    />
  );

  /**
   * Boss swatch.
   *
   * A plain red dot didn't match what the canvas actually draws - a boss has a
   * white inner ring and two dark angry slits. The geometry below is the same
   * ratios used in draw(): ring at r-5 with a 3px stroke, slits from
   * (0.5r, -0.4r) to (0.12r, -0.12r), mirrored, stroked at 0.16r.
   */
  const BossDot = ({ size = 26 }: { size?: number }) => {
    const r = size / 2;
    const ring = Math.max(2, r - 5 * (r / 13)); // scale the canvas 5px inset
    const eye = Math.max(1.5, r * 0.16);
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
        <circle cx={r} cy={r} r={r} fill={COLORS.boss} />
        <circle cx={r} cy={r} r={ring} fill="none" stroke="#fff" strokeWidth={Math.max(1.5, r * 0.23)} />
        <g stroke="#020617" strokeWidth={eye} strokeLinecap="round">
          <line x1={r - r * 0.5} y1={r - r * 0.4} x2={r - r * 0.12} y2={r - r * 0.12} />
          <line x1={r + r * 0.5} y1={r - r * 0.4} x2={r + r * 0.12} y2={r - r * 0.12} />
        </g>
      </svg>
    );
  };

  const LegendRow = ({
    color, size, title, body, swatch,
  }: { color?: string; size?: number; title: string; body: string; swatch?: React.ReactNode }) => (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-8 flex items-center justify-center pt-0.5">
        {swatch ?? <Dot color={color ?? '#fff'} size={size} />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white leading-tight">{title}</div>
        <div className="text-xs text-slate-400 leading-snug mt-0.5">{body}</div>
      </div>
    </div>
  );


  // Sound / vibration toggles. Rendered on both the title screen and the
  // pause overlay, so they live in one place.
  const settingsToggles = (
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={() => {
          const nextMuted = toggleMuted();
          setMutedState(nextMuted);
          if (!nextMuted) sfx.click();
          haptics.tap();
        }}
        className="btn btn-ghost btn-sm"
        aria-pressed={!muted}
        aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
      >
        {muted ? <VolumeX className="w-4 h-4 text-slate-500" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
        Sound
      </button>
      <button
        onClick={() => {
          const next = toggleHaptics();
          setVibeOn(next);
          // Fire straight away so the toggle previews itself.
          if (next) haptics.tap();
          sfx.click();
        }}
        className="btn btn-ghost btn-sm"
        aria-pressed={vibeOn}
        aria-label={vibeOn ? 'Turn vibration off' : 'Turn vibration on'}
      >
        {vibeOn ? <Vibrate className="w-4 h-4 text-cyan-400" /> : <VibrateOff className="w-4 h-4 text-slate-500" />}
        Vibrate
      </button>
    </div>
  );

  const equippedSkin = getSkin(save.equippedSkin);
  const skinPreviewStyle = (skin: Skin): React.CSSProperties =>
    skin.prism
      ? {
          background: 'conic-gradient(#f43f5e, #f59e0b, #84cc16, #0ea5e9, #8b5cf6, #f43f5e)',
          boxShadow: '0 0 20px rgba(255, 255, 255, 0.6)',
        }
      : { backgroundColor: skin.color, boxShadow: `0 0 20px ${skin.glow}` };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950 select-none" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseDown={handleTouchStart}
        onMouseMove={handleTouchMove}
        onMouseUp={handleTouchEnd}
        onMouseLeave={handleTouchEnd}
      />

      {stageBanner && uiState.status === 'playing' && (
        <div className="fade-in absolute inset-x-0 top-1/3 z-10 flex justify-center pointer-events-none">
          <div className="px-5 py-3 rounded-2xl bg-slate-950/70 backdrop-blur-sm border border-white/10 text-center">
            <div className="label text-slate-400 mb-1">New stage</div>
            <div className="text-lg font-semibold text-white">{stageBanner}</div>
          </div>
        </div>
      )}

      {/* --- HUD ---
          translateZ(0) promotes the overlay to its own compositor layer so the
          canvas repainting 60x/second can't force it to repaint too. */}
      {uiState.status === 'playing' && (
        <div className="absolute top-0 left-0 w-full p-4 safe-top pointer-events-none flex flex-col gap-2 gpu-layer">
          <div className="flex justify-between items-start">
            <div className="bg-slate-900/85 border border-white/10 rounded-2xl px-3 py-2">
              <div className="label text-slate-400 mb-1">SCORE</div>
              <div className="text-2xl font-semibold tabular-nums text-white">{uiState.score}</div>
            </div>
            <button
              onClick={pauseGame}
              aria-label="Pause"
              className="pointer-events-auto bg-slate-900/85 border border-white/10 rounded-2xl p-3 text-white hover:bg-slate-800 active:bg-slate-950 [box-shadow:3px_3px_0_#000] active:[box-shadow:0_0_0_#000] active:translate-x-[3px] active:translate-y-[3px] transition-all"
            >
              <Pause className="w-5 h-5" />
            </button>
            <div className="bg-slate-900/70 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-2 text-right">
              <div className="label text-slate-400 mb-1">{stageName(uiState.level)}</div>
              <div className="text-2xl font-semibold tabular-nums text-violet-300">{uiState.level}</div>
            </div>
          </div>
          
          {/* Size / Hunger Bar */}
          <div className="w-full max-w-xs mx-auto mt-2">
            <div className="flex justify-between label text-slate-400 mb-1 px-1">
              <span>STARVING</span>
              <span>SIZE {uiState.size}</span>
            </div>
            <div className="h-2 w-full bg-slate-900/70 border border-white/10 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-200 ease-out ${
                  uiState.size < 15
                    ? 'bg-gradient-to-r from-rose-600 to-rose-400'
                    : 'bg-gradient-to-r from-cyan-500 to-cyan-300'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, (uiState.size - 10) / 40 * 100))}%` }}
              />
            </div>
            {(uiState.shield > 0 || uiState.magnet > 0 || uiState.freeze > 0 || uiState.radar > 0) && (
              <div className="flex justify-center gap-2 mt-2">
                {uiState.shield > 0 && (
                  <div className="bg-cyan-500/10 backdrop-blur-sm border border-cyan-400/30 rounded-full px-3 py-1 label text-cyan-300">SHIELD {uiState.shield}</div>
                )}
                {uiState.magnet > 0 && (
                  <div className="bg-purple-500/10 backdrop-blur-sm border border-purple-400/30 rounded-full px-3 py-1 label text-purple-300">MAGNET {uiState.magnet}</div>
                )}
                {uiState.freeze > 0 && (
                  <div className="bg-blue-500/10 backdrop-blur-sm border border-blue-400/30 rounded-full px-3 py-1 label text-blue-300">FREEZE {uiState.freeze}</div>
                )}
                {uiState.radar > 0 && (
                  <div className="bg-pink-500/10 backdrop-blur-sm border border-pink-400/30 rounded-full px-3 py-1 label text-pink-300">RADAR {uiState.radar}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Attract / intro screen --- */}
      {!introDone && uiState.status === 'menu' && (
        <button
          type="button"
          onClick={() => { sfx.click(); setIntroDone(true); }}
          className="fade-in absolute inset-0 z-20 w-full bg-slate-950 flex flex-col items-center justify-center safe-inset overflow-hidden cursor-pointer"
        >
          {/* Decorative drifting cells. Purely atmosphere - the real game
              canvas is still running underneath. */}
          <div aria-hidden className="absolute inset-0 pointer-events-none">
            <div className="drift absolute w-24 h-24 rounded-full blur-2xl bg-cyan-500/25" style={{ top: '14%', left: '12%' }} />
            <div className="drift absolute w-16 h-16 rounded-full blur-2xl bg-emerald-500/25" style={{ top: '66%', left: '18%', animationDelay: '1.4s' }} />
            <div className="drift absolute w-28 h-28 rounded-full blur-2xl bg-violet-500/20" style={{ top: '24%', right: '10%', animationDelay: '2.6s' }} />
            <div className="drift absolute w-14 h-14 rounded-full blur-2xl bg-amber-500/20" style={{ bottom: '16%', right: '20%', animationDelay: '3.8s' }} />
          </div>

          <div className="relative flex flex-col items-center">
            <div className="w-28 h-28 rounded-full mb-8 pulse-soft" style={skinPreviewStyle(equippedSkin)} />
            <h1 className="text-5xl font-bold tracking-tight text-white mb-3">Neon Cell</h1>
            <p className="text-base text-slate-500 mb-16">Grow. Survive. Repeat.</p>
            <div className="label text-cyan-300 pulse-soft">Tap to begin</div>
          </div>
        </button>
      )}

      {/* --- Landing Page --- */}
      {uiState.status === 'menu' && screen === 'home' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10 safe-inset">
          <div className="card pop-in p-7 max-w-sm w-full mx-4 text-center max-h-[92vh] overflow-y-auto">
            <div className="w-24 h-24 rounded-3xl bg-slate-950/60 border border-white/10 flex items-center justify-center mx-auto mb-6">
              <div className="w-14 h-14 rounded-full pulse-soft" style={skinPreviewStyle(equippedSkin)} />
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Neon Cell</h1>
            <p className="text-base text-slate-500 leading-snug mb-7">Eat orbs. Avoid bigger cells.</p>

            <div className="flex items-center justify-center gap-8 mb-7">
              <div>
                <div className="label text-slate-600 mb-1">Best</div>
                <div className="text-xl font-semibold tabular-nums text-white">{save.bestScore}</div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div>
                <div className="label text-slate-600 mb-1 flex items-center justify-center gap-1.5">
                  <Coins className="w-3 h-3" /> Points
                </div>
                <div className="text-xl font-semibold tabular-nums text-amber-300">{save.coins}</div>
              </div>
            </div>
            <button onClick={initGame} className="btn btn-primary text-base py-5 mb-3">
              <Play className="w-5 h-5 fill-current" />
              Start
            </button>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => { sfx.click(); haptics.tap(); setScreen('shop'); }} className="btn btn-ghost btn-sm">
                <ShoppingBag className="w-4 h-4 text-violet-400" />
                Skins
              </button>
              <button onClick={() => { sfx.click(); haptics.tap(); setScreen('trophies'); }} className="btn btn-ghost btn-sm">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>{save.trophies.length}/{TROPHIES.length}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={() => { sfx.click(); haptics.tap(); setScreen('howto'); }} className="btn btn-ghost btn-sm">
                <HelpCircle className="w-4 h-4 text-cyan-400" />
                How to play
              </button>
              <button onClick={() => { sfx.click(); haptics.tap(); setScreen('privacy'); }} className="btn btn-ghost btn-sm">
                <FileText className="w-4 h-4 text-slate-400" />
                Privacy
              </button>
            </div>

            {settingsToggles}
          </div>
        </div>
      )}

      {/* --- Skin Shop --- */}
      {/* --- How to play --- */}
      {uiState.status === 'menu' && screen === 'howto' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10 safe-inset">
          <div className="card pop-in p-6 max-w-sm w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => { sfx.click(); setScreen('home'); }}
                aria-label="Back to menu"
                className="btn btn-ghost !w-auto !p-3"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-xl font-semibold tracking-tight text-white">How to play</h2>
              <div className="w-11" />
            </div>

            <div className="overflow-y-auto -mx-1 px-1">
              <div className="panel p-4 mb-4">
                <div className="label text-slate-500 mb-2">The one rule</div>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Absorb anything smaller than you. Never touch anything bigger.
                  Drag anywhere on screen to steer.
                </p>
              </div>

              <div className="label text-slate-500 mb-1">What you'll see</div>
              <div className="divide-y divide-white/5">
                <LegendRow
                  color={COLORS.orb} size={12}
                  title="Green orb"
                  body="Food. Each one makes you slightly bigger."
                />
                <LegendRow
                  color={COLORS.speedOrb} size={15}
                  title="Gold orb"
                  body="A burst of speed for three seconds, and a bigger size boost."
                />
                <LegendRow
                  color={COLORS.enemyPrey} size={17}
                  title="Amber cell — prey"
                  body="Small enough to absorb. Run it down."
                />
                <LegendRow
                  color={COLORS.enemy} size={22}
                  title="Red cell — threat"
                  body="Bigger than you. Contact ends the run. Shoot it or keep away."
                />
                <LegendRow
                  swatch={<BossDot size={26} />}
                  title="Boss"
                  body="Kill one to level up and expand the arena."
                />
              </div>

              <div className="label text-slate-500 mt-4 mb-1">Power-ups</div>
              <div className="divide-y divide-white/5">
                <LegendRow color={COLORS.shield} size={14} title="Shield" body="Five seconds where nothing can hurt you." />
                <LegendRow color={COLORS.magnet} size={14} title="Magnet" body="Pulls nearby orbs toward you for six seconds." />
                <LegendRow color={COLORS.freeze} size={14} title="Freeze" body="Every enemy stops dead for four seconds." />
                <LegendRow color={COLORS.radar} size={14} title="Radar" body="Shows the whole arena on a minimap for eight seconds." />
              </div>

              <div className="label text-slate-500 mt-4 mb-1">Staying alive</div>
              <div className="panel p-4 space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed">
                  <span className="text-white font-semibold">You shrink over time.</span>{' '}
                  The bar at the top is your size. Keep eating.
                </p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  <span className="text-white font-semibold">You fire automatically</span>{' '}
                  at anything in range. Each shot costs a little size, but a kill
                  drops orbs worth more than it cost.
                </p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  <span className="text-white font-semibold">Watch for the ring.</span>{' '}
                  A cell about to shoot draws a ring that tightens onto it. That's
                  your half-second to move.
                </p>
              </div>

              <p className="text-xs text-slate-500 leading-snug mt-4">
                Bank points from every run to unlock skins. Trophies unlock on their own
                as you hit milestones.
              </p>
            </div>

            <button onClick={() => { sfx.click(); setScreen('home'); }} className="btn btn-primary mt-4">
              Got it
            </button>
          </div>
        </div>
      )}

      {/* --- Privacy --- */}
      {uiState.status === 'menu' && screen === 'privacy' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10 safe-inset">
          <div className="card pop-in p-6 max-w-sm w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => { sfx.click(); setScreen('home'); }}
                aria-label="Back to menu"
                className="btn btn-ghost !w-auto !p-3"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-xl font-semibold tracking-tight text-white">Privacy</h2>
              <div className="w-11" />
            </div>

            <div className="overflow-y-auto -mx-1 px-1">
              <div className="panel p-4 mb-4">
                <p className="text-sm text-slate-200 leading-relaxed">
                  This game collects nothing, sends nothing, and has no way to.
                </p>
              </div>

              <div className="space-y-4 text-sm text-slate-400 leading-relaxed">
                <div>
                  <div className="text-white font-semibold mb-1">No data collection</div>
                  No accounts, no analytics, no advertising, no tracking. Nothing about
                  you or your device is gathered.
                </div>
                <div>
                  <div className="text-white font-semibold mb-1">No internet access</div>
                  The app does not request the internet permission at all, so it
                  cannot transmit anything even in principle.
                </div>
                <div>
                  <div className="text-white font-semibold mb-1">Stored on your device only</div>
                  Best score, points, unlocked skins and trophies, and your sound and
                  vibration settings are saved locally. Uninstalling the app deletes them.
                </div>
                <div>
                  <div className="text-white font-semibold mb-1">Permissions</div>
                  Two, both cosmetic: keeping the screen awake during a run, and
                  vibration for feedback. Vibration can be turned off on the title screen.
                </div>
                <div>
                  <div className="text-white font-semibold mb-1">Children</div>
                  Intended for ages 13 and over. As no data is collected, none is
                  collected from children either.
                </div>
                <div>
                  <div className="text-white font-semibold mb-1">If this changes</div>
                  Should a future version add advertising, it would require the internet
                  permission and this policy and the Play data safety declaration would be
                  updated before that version ships.
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-snug mt-5">
                Neon Cell Survival · v1.0.0
              </p>
            </div>

            <button onClick={() => { sfx.click(); setScreen('home'); }} className="btn btn-ghost mt-4">
              Close
            </button>
          </div>
        </div>
      )}

      {uiState.status === 'menu' && screen === 'shop' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10 safe-inset">
          <div className="card pop-in p-6 max-w-sm w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setScreen('home')}
                aria-label="Back to menu"
                className="btn btn-ghost !w-auto !p-3"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-xl font-semibold tracking-tight text-white">Skin shop</h2>
              <div className="panel px-3 py-2 label text-amber-300 flex items-center gap-1.5">
                <Coins className="w-3 h-3" />
                {save.coins}
              </div>
            </div>
            <p className="text-sm text-slate-500 leading-tight mb-3 text-center">Spend run points on new colors.</p>

            <div className="grid grid-cols-2 gap-3 overflow-y-auto pr-1">
              {SKINS.map(skin => {
                const owned = save.ownedSkins.includes(skin.id);
                const equipped = save.equippedSkin === skin.id;
                const affordable = save.coins >= skin.price;
                return (
                  <div key={skin.id} className={`panel p-3 flex flex-col items-center gap-2 ${equipped ? '!border-cyan-500' : ''}`}>
                    <div className="w-10 h-10 rounded-full" style={skinPreviewStyle(skin)} />
                    <div className="text-sm text-white text-center leading-none">{skin.name}</div>
                    {equipped ? (
                      <div className="w-full py-2 label text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-xl flex items-center justify-center gap-1.5">
                        <Check className="w-3 h-3" /> IN USE
                      </div>
                    ) : owned ? (
                      <button onClick={() => equipSkin(skin)} className="btn btn-ghost !text-[9px] !py-2 !border-2">
                        Equip
                      </button>
                    ) : (
                      <button onClick={() => buySkin(skin)} disabled={!affordable} className="btn btn-amber !text-[9px] !py-2 !border-2">
                        {affordable ? <Coins className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        {skin.price}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- Trophies --- */}
      {uiState.status === 'menu' && screen === 'trophies' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10 safe-inset">
          <div className="card pop-in p-6 max-w-sm w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setScreen('home')}
                aria-label="Back to menu"
                className="btn btn-ghost !w-auto !p-3"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="text-xl font-semibold tracking-tight text-white">Trophies</h2>
              <div className="panel px-3 py-2 label text-amber-300">
                {save.trophies.length}/{TROPHIES.length}
              </div>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto pr-1">
              {TROPHIES.map(t => {
                const unlocked = save.trophies.includes(t.id);
                return (
                  <div key={t.id} className={`panel p-3 flex items-center gap-3 ${unlocked ? '!border-amber-400/40' : 'opacity-70'}`}>
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${unlocked ? 'bg-amber-500/10 border-amber-400/40' : 'bg-slate-800/60 border-white/10'}`}>
                      {unlocked
                        ? <Trophy className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                        : <Lock className="w-5 h-5 text-slate-600" />}
                    </div>
                    <div className="text-left">
                      <div className={`text-sm font-semibold mb-1 ${unlocked ? 'text-white' : 'text-slate-500'}`}>{t.name}</div>
                      <div className="text-xs text-slate-500 leading-none">{t.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- Pause Menu --- */}
      {uiState.status === 'paused' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10 safe-inset">
          <div className="card pop-in p-7 max-w-sm w-full mx-4 text-center max-h-[92vh] overflow-y-auto">
            <h2 className="text-3xl font-bold tracking-tight text-white mb-3">Paused</h2>
            <p className="text-base text-slate-400 mb-6">Score <span className="text-white">{uiState.score}</span></p>
            <button onClick={resumeGame} className="btn btn-primary mb-3">
              <Play className="w-4 h-4 fill-current" />
              Resume
            </button>
            <button onClick={quitRun} className="btn btn-ghost mb-5">
              <Home className="w-4 h-4" />
              End &amp; bank points
            </button>

            <div className="pt-5 border-t border-white/10">
              {settingsToggles}
            </div>
          </div>
        </div>
      )}

      {/* --- Revive Offer --- */}
      {uiState.status === 'reviving' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 safe-inset">
          <div className="card pop-in p-7 max-w-sm w-full mx-4 text-center max-h-[92vh] overflow-y-auto">
            <h2 className="text-3xl font-bold tracking-tight text-rose-400 mb-3">Revive?</h2>
            <div className={`text-6xl font-bold tabular-nums mb-4 ${reviveCountdown <= 2 ? 'text-rose-400 pulse-soft' : 'text-white'}`}>
              {adPlaying ? '...' : Math.max(0, reviveCountdown)}
            </div>
            <p className="text-base text-slate-400 leading-tight mb-5">
              Keep your score of <span className="text-white">{uiState.score}</span> and jump back in!
            </p>

            {ADS_ENABLED && (
              <button onClick={reviveWithAd} disabled={adPlaying} className="btn btn-primary mb-3">
                <Play className="w-4 h-4 fill-current" />
                {adPlaying ? 'Ad playing...' : 'Watch ad · Free'}
              </button>
            )}
            <button
              onClick={reviveWithPoints}
              disabled={adPlaying || save.coins < REVIVE_COST}
              className={`btn mb-3 ${ADS_ENABLED ? 'btn-amber' : 'btn-primary'}`}
            >
              <Heart className="w-4 h-4 fill-current" />
              {REVIVE_COST} points
            </button>
            <button onClick={finalizeGameOver} disabled={adPlaying} className="btn btn-ghost">
              Skip
            </button>

            <div className="text-sm text-slate-500 mt-4 flex items-center justify-center gap-1 leading-none">
              <Coins className="w-4 h-4" /> {save.coins} points
            </div>
          </div>
        </div>
      )}

      {uiState.status === 'gameover' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 p-4 safe-inset">
          {/* max-h + scroll: a run that unlocks several trophies at once used to
              overflow the screen and clip the heading off the top. */}
          <div className="card pop-in p-6 max-w-sm w-full text-center max-h-full overflow-y-auto">
            <h2 className="text-3xl font-bold tracking-tight text-rose-400 mb-1">Game over</h2>
            <div className="label text-slate-500 mb-4">LEVEL {uiState.level}</div>

            <div className="panel p-4 mb-3">
              <div className="label text-slate-500 mb-2">SCORE</div>
              <div className="text-5xl font-bold tabular-nums text-white mb-2">{uiState.score}</div>
              <div className="label text-amber-400 flex items-center justify-center gap-1">
                <Coins className="w-3 h-3" />
                +{uiState.score} · {save.coins} TOTAL
              </div>
            </div>

            {newTrophies.length > 0 && (
              <div className="panel !border-amber-400/40 bg-amber-500/10 p-3 mb-3 text-left">
                <div className="label text-amber-400 mb-2 flex items-center gap-1">
                  <Trophy className="w-3 h-3" />
                  {newTrophies.length === 1 ? 'TROPHY UNLOCKED' : `${newTrophies.length} TROPHIES UNLOCKED`}
                </div>
                {/* Cap the list: an early run can trip eight at once. */}
                {newTrophies.slice(0, 3).map(t => (
                  <div key={t.id} className="text-sm text-white leading-tight">
                    {t.name}
                  </div>
                ))}
                {newTrophies.length > 3 && (
                  <div className="text-sm text-slate-400 leading-tight">
                    +{newTrophies.length - 3} more
                  </div>
                )}
              </div>
            )}

            <button onClick={initGame} className="btn btn-primary mb-3">
              <RotateCcw className="w-4 h-4" />
              Play again
            </button>
            <button onClick={goToMenu} className="btn btn-ghost">
              <Home className="w-4 h-4" />
              Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
