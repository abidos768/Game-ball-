/**
 * Meta-game systems: skins, trophies, and persistent save data.
 */

// --- Skins ---
export type Skin = {
  id: string;
  name: string;
  price: number;
  color: string;
  glow: string;
  prism?: boolean; // animated rainbow skin
};

export const SKINS: Skin[] = [
  { id: 'cyan', name: 'Neon Cyan', price: 0, color: '#0ea5e9', glow: 'rgba(14, 165, 233, 0.8)' },
  { id: 'lime', name: 'Toxic Lime', price: 100, color: '#84cc16', glow: 'rgba(132, 204, 22, 0.8)' },
  { id: 'amber', name: 'Solar Amber', price: 250, color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.8)' },
  { id: 'rose', name: 'Blood Rose', price: 500, color: '#f43f5e', glow: 'rgba(244, 63, 94, 0.8)' },
  { id: 'violet', name: 'Void Violet', price: 800, color: '#8b5cf6', glow: 'rgba(139, 92, 246, 0.8)' },
  { id: 'gold', name: 'Royal Gold', price: 1200, color: '#facc15', glow: 'rgba(250, 204, 21, 0.9)' },
  { id: 'diamond', name: 'Diamond White', price: 2000, color: '#f8fafc', glow: 'rgba(248, 250, 252, 0.9)' },
  { id: 'prism', name: 'Prism', price: 3000, color: '#0ea5e9', glow: 'rgba(255, 255, 255, 0.8)', prism: true },
];

export const getSkin = (id: string): Skin => SKINS.find(s => s.id === id) ?? SKINS[0];

// --- Save Data ---
export type SaveData = {
  coins: number; // spendable points, earned from run scores
  bestScore: number;
  bestLevel: number;
  gamesPlayed: number;
  enemiesDestroyed: number;
  bossesKilled: number;
  ownedSkins: string[];
  equippedSkin: string;
  trophies: string[];
};

const SAVE_KEY = 'neon-cell-save-v1';

const DEFAULT_SAVE: SaveData = {
  coins: 0,
  bestScore: 0,
  bestLevel: 1,
  gamesPlayed: 0,
  enemiesDestroyed: 0,
  bossesKilled: 0,
  ownedSkins: ['cyan'],
  equippedSkin: 'cyan',
  trophies: [],
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...DEFAULT_SAVE };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SAVE,
      ...parsed,
      ownedSkins: Array.isArray(parsed.ownedSkins) && parsed.ownedSkins.length > 0 ? parsed.ownedSkins : ['cyan'],
      trophies: Array.isArray(parsed.trophies) ? parsed.trophies : [],
    };
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

export function persistSave(save: SaveData) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage unavailable (private mode, etc.) — game still works, progress just won't persist.
  }
}

// --- Trophies ---
export type TrophyDef = {
  id: string;
  name: string;
  desc: string;
  check: (s: SaveData) => boolean;
};

export const TROPHIES: TrophyDef[] = [
  { id: 'first_game', name: 'First Contact', desc: 'Finish your first run', check: s => s.gamesPlayed >= 1 },
  { id: 'score_100', name: 'Century Cell', desc: 'Score 100 in a single run', check: s => s.bestScore >= 100 },
  { id: 'score_500', name: 'Half Grand', desc: 'Score 500 in a single run', check: s => s.bestScore >= 500 },
  { id: 'score_1000', name: 'Neon Legend', desc: 'Score 1,000 in a single run', check: s => s.bestScore >= 1000 },
  { id: 'destroy_10', name: 'Predator', desc: 'Take down 10 enemy cells', check: s => s.enemiesDestroyed >= 10 },
  { id: 'destroy_50', name: 'Apex Cell', desc: 'Take down 50 enemy cells', check: s => s.enemiesDestroyed >= 50 },
  { id: 'boss_1', name: 'Boss Slayer', desc: 'Defeat a boss', check: s => s.bossesKilled >= 1 },
  { id: 'boss_5', name: 'Nightmare Fuel', desc: 'Defeat 5 bosses', check: s => s.bossesKilled >= 5 },
  { id: 'level_5', name: 'Deep Diver', desc: 'Reach level 5', check: s => s.bestLevel >= 5 },
  { id: 'level_10', name: 'Abyss Walker', desc: 'Reach level 10', check: s => s.bestLevel >= 10 },
  { id: 'fresh_look', name: 'Fresh Look', desc: 'Buy your first skin', check: s => s.ownedSkins.length >= 2 },
  { id: 'wardrobe', name: 'Full Wardrobe', desc: 'Own every skin', check: s => s.ownedSkins.length >= SKINS.length },
];

/** Returns save with any newly earned trophies added, plus the list of new unlocks. */
export function checkTrophies(save: SaveData): { save: SaveData; newly: TrophyDef[] } {
  const newly = TROPHIES.filter(t => !save.trophies.includes(t.id) && t.check(save));
  if (newly.length === 0) return { save, newly };
  return {
    save: { ...save, trophies: [...save.trophies, ...newly.map(t => t.id)] },
    newly,
  };
}
