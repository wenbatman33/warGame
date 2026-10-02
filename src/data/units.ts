// 兵種數值（docs/02 §1）；DEV 工具可即時調整
import type { ModelKey } from '../models/soldier';

export type UnitTypeId = 'sword' | 'spear' | 'halberd' | 'archer' | 'crossbow' | 'lightcav' | 'heavycav' | 'horsearcher' | 'guard';

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
  /** 對騎兵倍率 */
  vsCav: number;
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
    id: 'sword', name: '刀盾兵', short: '刀盾', model: 'sword', count: 120, hp: 100, atk: 12, def: 9, walk: 3.0, run: 5.0, mounted: false,
    charge: 4, reach: 1.5, vsCav: 1, shield: 0.5, spacing: [0.98, 1.2], width: 20, morale: 70, rate: 1.2, icon: '🛡️',
    desc: '主力步兵。盾牌正面擋箭 50%，攻守平衡，頂住正面的中堅。',
  },
  spear: {
    id: 'spear', name: '長槍兵', short: '長槍', model: 'spear', count: 120, hp: 90, atk: 10, def: 7, walk: 2.8, run: 4.6, mounted: false,
    charge: 3, reach: 2.3, vsCav: 2.5, shield: 0, spacing: [0.95, 1.15], width: 20, morale: 68, rate: 1.25, icon: '🔱',
    desc: '騎兵剋星：對騎兵傷害 ×2.5；「堅守」時擺出拒馬陣，騎兵正面衝鋒反吃三倍傷害。',
  },
  halberd: {
    id: 'halberd', name: '大戟士', short: '大戟', model: 'ji', count: 100, hp: 125, atk: 15, def: 11, walk: 2.6, run: 4.2, mounted: false,
    charge: 6, reach: 2.0, vsCav: 1.6, shield: 0, spacing: [1.0, 1.2], width: 20, morale: 78, rate: 1.35, icon: '⚔️',
    desc: '重裝精銳步兵，攻防兼備、士氣高，衝擊力強。',
  },
  archer: {
    id: 'archer', name: '弓兵', short: '弓兵', model: 'archer', count: 80, hp: 70, atk: 5, def: 3, walk: 3.0, run: 5.2, mounted: false,
    ranged: { dmg: 9, range: 135, reload: 4.2, ammo: 30, arc: 'high', ap: 0 },
    charge: 0, reach: 1.4, vsCav: 1, shield: 0, spacing: [1.05, 1.3], width: 20, morale: 60, rate: 1.4, icon: '🏹',
    desc: '拋射箭雨可越過前排，射程最遠；肉搏很弱，要有人保護。可射火矢點燃糧倉。',
  },
  crossbow: {
    id: 'crossbow', name: '弩兵', short: '弩兵', model: 'crossbow', count: 80, hp: 75, atk: 5, def: 4, walk: 2.8, run: 4.8, mounted: false,
    ranged: { dmg: 17, range: 105, reload: 6.0, ammo: 20, arc: 'flat', ap: 0.5 },
    charge: 0, reach: 1.4, vsCav: 1, shield: 0, spacing: [1.05, 1.3], width: 20, morale: 62, rate: 1.4, icon: '🎯',
    desc: '平射破甲，傷害高但裝填慢、射程較短。',
  },
  lightcav: {
    id: 'lightcav', name: '輕騎兵', short: '輕騎', model: 'lightcav', count: 48, hp: 130, atk: 10, def: 5, walk: 6.0, run: 11, mounted: true,
    charge: 16, reach: 2.2, vsCav: 1, shield: 0.2, spacing: [1.95, 2.9], width: 12, morale: 66, rate: 1.0, icon: '🐎',
    desc: '最快的部隊：繞後、追擊潰兵（×1.5）、縱火燒糧（對糧倉 ×3）。',
  },
  heavycav: {
    id: 'heavycav', name: '重騎兵', short: '重騎', model: 'heavycav', count: 40, hp: 185, atk: 14, def: 12, walk: 5.2, run: 9.5, mounted: true,
    charge: 36, reach: 2.4, vsCav: 1, shield: 0, spacing: [2.0, 3.0], width: 10, morale: 76, rate: 1.1, icon: '🏇',
    desc: '毀滅性的衝鋒：撞穿未堅守的步兵；但怕長槍拒馬。',
  },
  horsearcher: {
    id: 'horsearcher', name: '騎射手', short: '騎射', model: 'horsearcher', count: 40, hp: 110, atk: 6, def: 4, walk: 6.0, run: 10.5, mounted: true,
    ranged: { dmg: 8, range: 100, reload: 3.6, ammo: 24, arc: 'flat', ap: 0 },
    charge: 6, reach: 2.2, vsCav: 1, shield: 0, spacing: [1.95, 2.9], width: 10, morale: 64, rate: 1.0, icon: '🐴',
    desc: '機動射手，邊走邊射、打了就跑。',
  },
  guard: {
    id: 'guard', name: '親衛隊', short: '親衛', model: 'heavycav', count: 24, hp: 170, atk: 14, def: 12, walk: 5.2, run: 9.5, mounted: true,
    charge: 26, reach: 2.4, vsCav: 1, shield: 0, spacing: [2.0, 3.0], width: 8, morale: 85, rate: 1.05, icon: '⭐',
    desc: '武將的親衛騎兵，跟著武將衝鋒陷陣。',
  },
};

/** 每名士兵代表的人數 */
export const MEN_PER_SOLDIER = 10;
