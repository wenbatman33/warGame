// 設定與戰役進度（localStorage）
import type { Quality } from '../render/stage';

const KEY_S = 'wargame.settings.v1';
const KEY_P = 'wargame.progress.v1';

export interface Settings {
  quality: Quality;
  master: number;
  music: number;
  sfx: number;
  voice: number;
  tips: boolean;
  edgePan: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
}

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer:coarse)').matches;

export const SETTINGS: Settings = {
  quality: coarse ? 'medium' : 'high',
  master: 0.85,
  music: 0.55,
  sfx: 0.9,
  voice: 1,
  tips: true,
  edgePan: !coarse,
  difficulty: 'normal',
};

export interface Progress {
  stars: Record<string, boolean[]>;
  best: Record<string, number>;
}

export const PROGRESS: Progress = { stars: {}, best: {} };

export function loadAll(): void {
  try {
    Object.assign(SETTINGS, JSON.parse(localStorage.getItem(KEY_S) ?? '{}'));
    Object.assign(PROGRESS, JSON.parse(localStorage.getItem(KEY_P) ?? '{}'));
  } catch {
    /* 讀不到就用預設 */
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(KEY_S, JSON.stringify(SETTINGS));
  } catch {
    /* 私密模式等 */
  }
}

export function recordResult(id: string, stars: boolean[], time: number, win: boolean): void {
  const old = PROGRESS.stars[id] ?? [false, false, false];
  PROGRESS.stars[id] = old.map((v, i) => v || !!stars[i]);
  if (win) PROGRESS.best[id] = Math.min(PROGRESS.best[id] ?? Infinity, time);
  try {
    localStorage.setItem(KEY_P, JSON.stringify(PROGRESS));
  } catch {
    /* 略 */
  }
}

export function starCount(id: string): number {
  return (PROGRESS.stars[id] ?? []).filter(Boolean).length;
}
