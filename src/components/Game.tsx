import React, { useRef, useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, Trophy, ShoppingBag, ArrowLeft, Lock, Check, Coins, Home, Heart } from 'lucide-react';
import { SKINS, TROPHIES, getSkin, loadSave, persistSave, checkTrophies } from '../game/meta';
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
  enemy: '#ef4444', // red-500
  enemyGlow: 'rgba(239, 68, 68, 0.8)',
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
  radarTimer: number;
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
  const [screen, setScreen] = useState<'home' | 'shop' | 'trophies'>('home');
  const [newTrophies, setNewTrophies] = useState<TrophyDef[]>([]);
  const [reviveCountdown, setReviveCountdown] = useState(5);
  const [adPlaying, setAdPlaying] = useState(false);
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
    };
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
    const isSpeed = Math.random() < 0.05;
    s.orbs.push({
      id: entityIdCounter++,
      x: randomRange(0, s.arena.w),
      y: randomRange(0, s.arena.h),
      r: isSpeed ? 6 : 4,
      vx: 0,
      vy: 0,
      color: isSpeed ? COLORS.speedOrb : COLORS.orb,
      glow: isSpeed ? COLORS.speedOrbGlow : COLORS.orbGlow,
      type: isSpeed ? 'speed' : 'normal',
    });
  };

  const spawnEnemy = (isBoss = false) => {
    const s = state.current;
    // Spawn away from player
    let ex = 0, ey = 0;
    do {
      ex = randomRange(0, s.arena.w);
      ey = randomRange(0, s.arena.h);
    } while (dist(ex, ey, s.player.x, s.player.y) < 400);

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
      // Normal enemy size relative to player (some smaller, some bigger)
      const sizeMult = randomRange(0.4, 1.8);
      s.enemies.push({
        id: entityIdCounter++,
        x: ex, y: ey,
        r: Math.max(10, s.player.r * sizeMult),
        vx: randomRange(-1.5, 1.5), vy: randomRange(-1.5, 1.5),
        color: COLORS.enemy, glow: COLORS.enemyGlow,
        type: 'normal',
        shootTimer: 0,
      });
    }
  };

  const spawnParticles = (x: number, y: number, color: string, count: number) => {
    const s = state.current;
    for (let i = 0; i < count; i++) {
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
      s.powerupTimer = Math.floor(randomRange(600, 1000));
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
      const cw = canvasRef.current.width;
      const ch = canvasRef.current.height;
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
      // Find closest enemy within range
      let closestEnemy: Enemy | null = null;
      let closestDist = 400; // Shooting range
      for (const enemy of s.enemies) {
        if (enemy.type === 'projectile') continue;
        const d = dist(s.player.x, s.player.y, enemy.x, enemy.y);
        if (d < closestDist) {
          closestDist = d;
          closestEnemy = enemy;
        }
      }

      if (closestEnemy && s.player.r > 12) { // Need minimum size to shoot
        const angle = Math.atan2(closestEnemy.y - s.player.y, closestEnemy.x - s.player.x);
        s.playerProjectiles.push({
          id: entityIdCounter++,
          x: s.player.x,
          y: s.player.y,
          r: 4,
          vx: Math.cos(angle) * 8,
          vy: Math.sin(angle) * 8,
          color: COLORS.player,
          glow: COLORS.playerGlow,
        });
        s.player.r -= 0.5; // Cost of shooting
        s.player.shootTimer = 15; // Shoot every 0.25 seconds (at 60fps)
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
            if (enemy.type === 'boss') s.runBossesKilled++;
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
      } else if (enemy.type === 'boss') {
        // Boss moves slowly towards player
        const angle = Math.atan2(s.player.y - enemy.y, s.player.x - enemy.x);
        enemy.vx = Math.cos(angle) * 0.3;
        enemy.vy = Math.sin(angle) * 0.3;
        
        // Boss shoots
        enemy.shootTimer++;
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
          s.player.r -= 5;
          spawnParticles(s.player.x, s.player.y, COLORS.player, 10);
          s.enemies.splice(i, 1);
          // Short buzz on taking a hit (Android only; iOS ignores it)
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(40); } catch { /* not critical */ }
          }
          if (s.player.r < 10) gameOver();
        } else if (s.player.r > enemy.r * 1.1) {
          // Player eats enemy
          s.player.r += enemy.r * 0.2;
          s.score += enemy.type === 'boss' ? 100 : Math.floor(enemy.r);
          s.runEnemiesDestroyed++;
          if (enemy.type === 'boss') s.runBossesKilled++;
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
        } else if (enemy.r > s.player.r * 1.1) {
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
      s.arena.w += 200;
      s.arena.h += 200;
      for(let j=0; j<10; j++) spawnOrb();
      
      if (s.level % 3 === 0 && !s.enemies.some(e => e.type === 'boss')) {
        spawnEnemy(true); // Spawn boss
      } else {
        spawnEnemy(); // Spawn normal enemy
      }
    }

    // Sync UI state periodically (not every frame to save React renders, but size/score need it)
    // Actually, we can sync every frame if it's just a few numbers, but let's do it carefully.
    setUiState({
      status: s.status,
      score: s.score,
      level: s.level,
      size: Math.floor(s.player.r),
      shield: Math.ceil(s.player.invincibleTimer / 60),
      magnet: Math.ceil(s.player.magnetTimer / 60),
      freeze: Math.ceil(s.freezeTimer / 60),
      radar: Math.ceil(s.radarTimer / 60),
    });
  };

  const draw = (ctx: CanvasRenderingContext2D, cw: number, ch: number) => {
    const s = state.current;

    // Clear background
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, cw, ch);

    if (s.status === 'menu') return;

    ctx.save();
    ctx.translate(-s.camera.x, -s.camera.y);

    // Draw Grid
    ctx.strokeStyle = COLORS.grid;
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

    // Draw Arena Bounds
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, s.arena.w, s.arena.h);

    // Helper to draw glowing circles
    const drawCircle = (x: number, y: number, r: number, color: string, glow: string) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 15;
      ctx.fill();
      ctx.shadowBlur = 0; // reset
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

    // Draw Player Projectiles
    s.playerProjectiles.forEach(proj => drawCircle(proj.x, proj.y, proj.r, proj.color, proj.glow));

    // Draw Enemies (dimmed while frozen)
    const enemiesFrozen = s.freezeTimer > 0;
    s.enemies.forEach(enemy => {
      if (enemiesFrozen) ctx.globalAlpha = 0.5;
      drawCircle(enemy.x, enemy.y, enemy.r, enemy.color, enemy.glow);
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
    s.particles.forEach(p => {
      ctx.globalAlpha = 1 - p.life / p.maxLife;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });

    // Draw Player
    if (s.status === 'playing' || s.status === 'paused' || s.status === 'reviving') {
      let pColor = s.player.color;
      let pGlow = s.player.glow;
      if (skinRef.current.prism) {
        const hue = Math.floor((Date.now() / 15) % 360);
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

    ctx.restore();

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

    const loop = () => {
      update();
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Handle resize
          if (containerRef.current) {
            const { clientWidth, clientHeight } = containerRef.current;
            if (canvas.width !== clientWidth || canvas.height !== clientHeight) {
              canvas.width = clientWidth;
              canvas.height = clientHeight;
            }
          }
          draw(ctx, canvas.width, canvas.height);
        }
      }
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

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
    const iv = window.setInterval(() => setReviveCountdown(c => c - 1), 1000);
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

  // --- UI helpers ---
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

      {/* --- HUD --- */}
      {uiState.status === 'playing' && (
        <div className="absolute top-0 left-0 w-full p-4 pointer-events-none flex flex-col gap-2">
          <div className="flex justify-between items-start">
            <div className="bg-slate-900/85 border-4 border-slate-700 px-3 py-2">
              <div className="font-pixel text-[8px] text-slate-400 mb-1">SCORE</div>
              <div className="font-pixel text-base text-white">{uiState.score}</div>
            </div>
            <button
              onClick={pauseGame}
              aria-label="Pause"
              className="pointer-events-auto bg-slate-900/85 border-4 border-slate-700 p-3 text-white hover:bg-slate-800 active:bg-slate-950 [box-shadow:3px_3px_0_#000] active:[box-shadow:0_0_0_#000] active:translate-x-[3px] active:translate-y-[3px] transition-all"
            >
              <Pause className="w-5 h-5" />
            </button>
            <div className="bg-slate-900/85 border-4 border-slate-700 px-3 py-2 text-right">
              <div className="font-pixel text-[8px] text-slate-400 mb-1">LEVEL</div>
              <div className="font-pixel text-base text-violet-400">{uiState.level}</div>
            </div>
          </div>
          
          {/* Size / Hunger Bar */}
          <div className="w-full max-w-xs mx-auto mt-2">
            <div className="flex justify-between font-pixel text-[8px] text-slate-400 mb-1 px-1">
              <span>STARVING</span>
              <span>SIZE {uiState.size}</span>
            </div>
            <div className="h-4 w-full bg-slate-900/85 border-4 border-slate-700 overflow-hidden">
              <div 
                className={`h-full transition-all duration-200 ease-out ${uiState.size < 15 ? 'bg-red-500' : 'bg-cyan-500'}`}
                style={{ width: `${Math.min(100, Math.max(0, (uiState.size - 10) / 40 * 100))}%` }}
              />
            </div>
            {(uiState.shield > 0 || uiState.magnet > 0 || uiState.freeze > 0 || uiState.radar > 0) && (
              <div className="flex justify-center gap-2 mt-2">
                {uiState.shield > 0 && (
                  <div className="bg-slate-900/85 border-2 border-cyan-400 px-2 py-1 font-pixel text-[8px] text-cyan-300">SHIELD {uiState.shield}</div>
                )}
                {uiState.magnet > 0 && (
                  <div className="bg-slate-900/85 border-2 border-purple-400 px-2 py-1 font-pixel text-[8px] text-purple-300">MAGNET {uiState.magnet}</div>
                )}
                {uiState.freeze > 0 && (
                  <div className="bg-slate-900/85 border-2 border-blue-400 px-2 py-1 font-pixel text-[8px] text-blue-300">FREEZE {uiState.freeze}</div>
                )}
                {uiState.radar > 0 && (
                  <div className="bg-slate-900/85 border-2 border-pink-400 px-2 py-1 font-pixel text-[8px] text-pink-300">RADAR {uiState.radar}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- Landing Page --- */}
      {uiState.status === 'menu' && screen === 'home' && (
        <div className="crt absolute inset-0 flex items-center justify-center bg-black/70 z-10">
          <div className="px-card p-6 max-w-sm w-full mx-4 text-center">
            <div className="w-20 h-20 px-inset flex items-center justify-center mx-auto mb-5">
              <div className="w-12 h-12 rounded-full animate-pulse" style={skinPreviewStyle(equippedSkin)} />
            </div>
            <h1 className="font-pixel text-2xl text-cyan-400 mb-3 [text-shadow:0_0_12px_rgba(14,165,233,0.8),3px_3px_0_#000]">NEON CELL</h1>
            <p className="font-retro text-xl text-slate-400 leading-tight mb-5">Eat green orbs to grow. Avoid bigger red cells. Don't starve!</p>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="px-inset p-3">
                <div className="font-pixel text-[8px] text-slate-500 mb-2">HI-SCORE</div>
                <div className="font-pixel text-base text-white">{save.bestScore}</div>
              </div>
              <div className="px-inset p-3">
                <div className="font-pixel text-[8px] text-slate-500 mb-2 flex items-center justify-center gap-1">
                  <Coins className="w-3 h-3" /> POINTS
                </div>
                <div className="font-pixel text-base text-amber-400">{save.coins}</div>
              </div>
            </div>

            <div className="font-pixel text-[10px] text-cyan-400 blink mb-3">PUSH START BUTTON</div>
            <button onClick={initGame} className="btn-px btn-px-cyan mb-3">
              <Play className="w-4 h-4 fill-current" />
              Start
            </button>

            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setScreen('shop')} className="btn-px btn-px-slate">
                <ShoppingBag className="w-4 h-4 text-violet-400" />
                Skins
              </button>
              <button onClick={() => setScreen('trophies')} className="btn-px btn-px-slate">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>{save.trophies.length}/{TROPHIES.length}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Skin Shop --- */}
      {uiState.status === 'menu' && screen === 'shop' && (
        <div className="crt absolute inset-0 flex items-center justify-center bg-black/70 z-10">
          <div className="px-card p-5 max-w-sm w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setScreen('home')}
                aria-label="Back to menu"
                className="btn-px btn-px-slate !w-auto !p-3"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="font-pixel text-sm text-white [text-shadow:2px_2px_0_#000]">SKIN SHOP</h2>
              <div className="px-inset px-3 py-2 font-pixel text-xs text-amber-400 flex items-center gap-1">
                <Coins className="w-3 h-3" />
                {save.coins}
              </div>
            </div>
            <p className="font-retro text-lg text-slate-500 leading-tight mb-3 text-center">Earn points by playing runs. Spend them on new cell colors.</p>

            <div className="grid grid-cols-2 gap-3 overflow-y-auto pr-1">
              {SKINS.map(skin => {
                const owned = save.ownedSkins.includes(skin.id);
                const equipped = save.equippedSkin === skin.id;
                const affordable = save.coins >= skin.price;
                return (
                  <div key={skin.id} className={`px-inset p-3 flex flex-col items-center gap-2 ${equipped ? '!border-cyan-500' : ''}`}>
                    <div className="w-10 h-10 rounded-full" style={skinPreviewStyle(skin)} />
                    <div className="font-retro text-lg text-white text-center leading-none">{skin.name}</div>
                    {equipped ? (
                      <div className="w-full py-2 font-pixel text-[9px] text-cyan-400 bg-cyan-500/15 border-2 border-cyan-500/50 flex items-center justify-center gap-1">
                        <Check className="w-3 h-3" /> IN USE
                      </div>
                    ) : owned ? (
                      <button onClick={() => equipSkin(skin)} className="btn-px btn-px-slate !text-[9px] !py-2 !border-2">
                        Equip
                      </button>
                    ) : (
                      <button onClick={() => buySkin(skin)} disabled={!affordable} className="btn-px btn-px-amber !text-[9px] !py-2 !border-2">
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
        <div className="crt absolute inset-0 flex items-center justify-center bg-black/70 z-10">
          <div className="px-card p-5 max-w-sm w-full mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => setScreen('home')}
                aria-label="Back to menu"
                className="btn-px btn-px-slate !w-auto !p-3"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <h2 className="font-pixel text-sm text-white [text-shadow:2px_2px_0_#000]">TROPHIES</h2>
              <div className="px-inset px-3 py-2 font-pixel text-xs text-amber-400">
                {save.trophies.length}/{TROPHIES.length}
              </div>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto pr-1">
              {TROPHIES.map(t => {
                const unlocked = save.trophies.includes(t.id);
                return (
                  <div key={t.id} className={`px-inset p-3 flex items-center gap-3 ${unlocked ? '!border-amber-500/60' : 'opacity-70'}`}>
                    <div className={`w-10 h-10 flex items-center justify-center shrink-0 border-2 ${unlocked ? 'bg-amber-500/15 border-amber-500/60' : 'bg-slate-800 border-slate-700'}`}>
                      {unlocked
                        ? <Trophy className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                        : <Lock className="w-5 h-5 text-slate-600" />}
                    </div>
                    <div className="text-left">
                      <div className={`font-pixel text-[10px] mb-1 ${unlocked ? 'text-white' : 'text-slate-500'}`}>{t.name}</div>
                      <div className="font-retro text-base text-slate-500 leading-none">{t.desc}</div>
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
        <div className="crt absolute inset-0 flex items-center justify-center bg-black/70 z-10">
          <div className="px-card p-6 max-w-sm w-full mx-4 text-center">
            <h2 className="font-pixel text-xl text-white mb-3 [text-shadow:3px_3px_0_#000]">PAUSED</h2>
            <p className="font-retro text-xl text-slate-400 mb-6">Score so far: <span className="text-white">{uiState.score}</span></p>
            <button onClick={resumeGame} className="btn-px btn-px-cyan mb-3">
              <Play className="w-4 h-4 fill-current" />
              Resume
            </button>
            <button onClick={quitRun} className="btn-px btn-px-slate">
              <Home className="w-4 h-4" />
              End &amp; bank points
            </button>
          </div>
        </div>
      )}

      {/* --- Revive Offer --- */}
      {uiState.status === 'reviving' && (
        <div className="crt absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="px-card p-6 max-w-sm w-full mx-4 text-center">
            <h2 className="font-pixel text-xl text-red-500 mb-3 [text-shadow:0_0_12px_rgba(239,68,68,0.8),3px_3px_0_#000]">REVIVE?</h2>
            <div className={`font-pixel text-3xl mb-4 ${reviveCountdown <= 2 ? 'text-red-500 blink' : 'text-white'}`}>
              {adPlaying ? '...' : Math.max(0, reviveCountdown)}
            </div>
            <p className="font-retro text-xl text-slate-400 leading-tight mb-5">
              Keep your score of <span className="text-white">{uiState.score}</span> and jump back in!
            </p>

            <button onClick={reviveWithAd} disabled={adPlaying} className="btn-px btn-px-cyan mb-3">
              <Play className="w-4 h-4 fill-current" />
              {adPlaying ? 'Ad playing...' : 'Watch ad · Free'}
            </button>
            <button
              onClick={reviveWithPoints}
              disabled={adPlaying || save.coins < REVIVE_COST}
              className="btn-px btn-px-amber mb-3"
            >
              <Heart className="w-4 h-4 fill-current" />
              {REVIVE_COST} points
            </button>
            <button onClick={finalizeGameOver} disabled={adPlaying} className="btn-px btn-px-slate">
              No thanks
            </button>

            <div className="font-retro text-lg text-slate-500 mt-4 flex items-center justify-center gap-1 leading-none">
              <Coins className="w-4 h-4" /> Wallet: {save.coins} points
            </div>
          </div>
        </div>
      )}

      {uiState.status === 'gameover' && (
        <div className="crt absolute inset-0 flex items-center justify-center bg-black/80 z-10">
          <div className="px-card p-6 max-w-sm w-full mx-4 text-center">
            <h2 className="font-pixel text-xl text-red-500 mb-2 [text-shadow:0_0_12px_rgba(239,68,68,0.8),3px_3px_0_#000]">GAME OVER</h2>
            <div className="font-retro text-xl text-slate-400 mb-4">You reached Level {uiState.level}</div>

            <div className="px-inset p-4 mb-4">
              <div className="font-pixel text-[8px] text-slate-500 mb-2">FINAL SCORE</div>
              <div className="font-pixel text-2xl text-white mb-2">{uiState.score}</div>
              <div className="font-retro text-lg text-amber-400 flex items-center justify-center gap-1 leading-none">
                <Coins className="w-4 h-4" />
                +{uiState.score} points banked · {save.coins} total
              </div>
            </div>

            {newTrophies.length > 0 && (
              <div className="px-inset !border-amber-500/60 bg-amber-500/10 p-3 mb-4 text-left">
                <div className="font-pixel text-[9px] text-amber-400 blink mb-2 flex items-center gap-1">
                  <Trophy className="w-3 h-3" /> TROPHY UNLOCKED!
                </div>
                {newTrophies.map(t => (
                  <div key={t.id} className="font-retro text-lg text-white leading-tight">
                    {t.name} <span className="text-slate-400">— {t.desc}</span>
                  </div>
                ))}
              </div>
            )}

            <button onClick={initGame} className="btn-px btn-px-cyan mb-3">
              <RotateCcw className="w-4 h-4" />
              Continue?
            </button>
            <button onClick={goToMenu} className="btn-px btn-px-slate">
              <Home className="w-4 h-4" />
              Quit to title
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
