// 兵種數值（docs/02 §1）；DEV 工具可即時調整
import type { ModelKey } from '../models/soldier';

/** 四種兵種＋武將親衛：刀盾、長槍、弓兵、騎兵（相剋圈：槍剋騎、騎剋弓、弓剋槍、盾剋槍） */
export type UnitTypeId = 'sword' | 'spear' | 'archer' | 'cav' | 'guard';

/** 相剋分類：盾（刀盾兵）、槍（長槍兵）、射（弓兵）、騎（騎兵、親衛） */
export type UnitClass = 'shield' | 'pole' | 'missile' | 'cav';

export interface RangedDef {
  dmg: number;
  range: number;
  reload: number;
  ammo: number;
  arc: 'high' | 'flat';
  /** 破甲比例 */
  ap: number;
}

export interface UnitDef {
  id: UnitTypeId;
  name: string;
  short: string;
  model: ModelKey;
  count: number;
  hp: number;
  atk: number;
  def: number;
  ranged?: RangedDef;
  walk: number;
  run: number;
  mounted: boolean;
  /** 衝鋒加成 */
  charge: number;
  /** 近戰距離 */
  reach: number;
  /** 相剋分類 */
  cls: UnitClass;
  /** 對騎兵倍率（槍剋騎） */
  vsCav: number;
  /** 正面受到近戰傷害的倍率（盾牌、兵器朝前；側面、背後另計） */
  front: number;
  /** 正面盾牌擋箭比例 */
  shield: number;
  /** 陣位間距 [橫, 縱] */
  spacing: [number, number];
  /** 預設每列人數 */
  width: number;
  morale: number;
  /** 攻擊間隔（秒） */
  rate: number;
  icon: string;
  desc: string;
}

export const UNITS: Record<UnitTypeId, UnitDef> = {
  sword: {
    id: 'sword', name: '刀盾兵', short: '刀盾', model: 'sword', count: 150, hp: 100, atk: 12, def: 9, walk: 3.0, run: 5.0, mounted: false,
    charge: 4, reach: 1.5, cls: 'shield', vsCav: 1, front: 0.7, shield: 0.6, spacing: [0.98, 1.2], width: 24, morale: 70, rate: 1.2, icon: '🛡️',
    desc: '前排肉盾：正面很硬、盾牌擋箭 60%；近身剋長槍兵。怕騎兵從側面衝。',
  },
  spear: {
    id: 'spear', name: '長槍兵', short: '長槍', model: 'spear', count: 150, hp: 90, atk: 10, def: 7, walk: 2.8, run: 4.6, mounted: false,
    charge: 3, reach: 2.3, cls: 'pole', vsCav: 2.4, front: 0.8, shield: 0, spacing: [0.95, 1.15], width: 24, morale: 68, rate: 1.25, icon: '🔱',
    desc: '騎兵剋星：對騎兵傷害 ×2.4；「堅守」時擺出拒馬，騎兵正面衝鋒反吃三倍傷害。怕弓弩與刀盾。',
  },
  archer: {
    id: 'archer', name: '弓兵', short: '弓兵', model: 'archer', count: 100, hp: 70, atk: 5, def: 3, walk: 3.0, run: 5.2, mounted: false,
    ranged: { dmg: 11, range: 135, reload: 6, ammo: 30, arc: 'high', ap: 0 },
    charge: 0, reach: 1.4, cls: 'missile', vsCav: 1, front: 1, shield: 0, spacing: [1.05, 1.3], width: 20, morale: 60, rate: 1.4, icon: '🏹',
    desc: '拋射箭雨越過前排，射程最遠；剋長槍兵（×1.5）。被騎兵近身就完了，要有人保護。可射火矢點燃糧倉。',
  },
  cav: {
    id: 'cav', name: '騎兵', short: '騎兵', model: 'lightcav', count: 60, hp: 160, atk: 12, def: 8, walk: 5.6, run: 10.5, mounted: true,
    charge: 26, reach: 2.3, cls: 'cav', vsCav: 1, front: 0.9, shield: 0.1, spacing: [1.35, 2.5], width: 15, morale: 72, rate: 1.05, icon: '🐎',
    desc: '機動與衝擊：從側面、背後衝鋒最致命（正面衝列陣步兵只剩一半）；斷糧道、截輜重、縱火燒糧（×3）。剋弓兵，怕長槍。',
  },
  guard: {
    id: 'guard', name: '親衛隊', short: '親衛', model: 'heavycav', count: 50, hp: 170, atk: 14, def: 12, walk: 5.2, run: 9.5, mounted: true,
    charge: 26, reach: 2.4, cls: 'cav', vsCav: 1, front: 0.85, shield: 0, spacing: [1.4, 2.6], width: 12, morale: 85, rate: 1.05, icon: '⭐',
    desc: '武將的親衛騎兵，跟著武將衝鋒陷陣。',
  },
};

/** 每名士兵代表的人數 */
export const MEN_PER_SOLDIER = 10;
