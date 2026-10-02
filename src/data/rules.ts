// 全域規則數值（docs/02 §3–5、docs/03）；DEV 工具可即時調整並匯出
export const RULES = {
  // 戰鬥
  hitBase: 0.44,
  /** 近戰傷害倍率（攻擊 × 倍率） */
  meleeDmg: 0.65,
  /** 肉搏中的士氣持續流失（依兵力比放大） */
  meleeDrain: 0.32,
  hitPerPoint: 0.02,
  flankMul: 1.3,
  rearMul: 1.6,
  uphillMul: 1.15,
  chargeMinSpeed: 6,
  braceReflect: 3,
  friendlyFireMul: 0.5,
  pursuitMul: 1.5,
  engageRadius: 7,
  tether: 14,
  arrowMoraleHit: 1,
  // 士氣
  moralePerLossPct: 0.9,
  heavyLossShock: 10,
  /** 10 秒內損失超過此比例 → 驚嚇 */
  heavyLossPct: 0.15,
  flankDrain: 2,
  rearDrain: 4,
  chargeShock: 8,
  outnumberDrain: 1,
  friendRoutShock: 6,
  enemyRoutBoost: 4,
  generalAuraRadius: 40,
  generalAuraRegen: 1.5,
  generalDeathArmy: 20,
  generalDeathOwn: 40,
  idleRegen: 1,
  routThreshold: 15,
  waverThreshold: 35,
  highThreshold: 80,
  rallyMorale: 30,
  rallyDelay: 15,
  maxRouts: 3,
  fireDrain: 2,
  // 體力
  staminaRun: 1.2,
  staminaRunCav: 0.6,
  staminaCharge: 2.5,
  staminaFight: 0.8,
  staminaWalk: 0.1,
  staminaRest: 2,
  // 糧草（docs/03）
  hqConsumePerSoldier: 0.0015,
  wagonInterval: 40,
  wagonLoad: 120,
  wagonSpeed: 4,
  depotIgniteRadius: 15,
  depotDefendRadius: 25,
  depotBurnRate: 0.02,
  depotBurntShock: 15,
  depotMainShock: 25,
  allDepotsShock: 10,
  supplyRadius: 120,
  /** 軍心大亂（主糧倉被焚）：持續秒數、士氣上限、每秒流失、攻擊倍率 */
  panicTime: 90,
  panicCap: 45,
  panicDrain: 0.35,
  panicAtk: 0.8,
  // 計策
  commandRegen: 8,
  commandMax: 10,
  commandStart: 4,
  // 地形優勢（docs/02 §6）
  /** 每公尺高低差的近戰加成，上下限 */
  heightPerMeter: 0.03,
  heightMax: 0.3,
  heightMin: -0.25,
  /** 每公尺高低差的射程加成，上限 */
  rangePerMeter: 0.012,
  rangeMax: 0.25,
  /** 衝鋒：下坡加成上限、上坡懲罰上限 */
  chargeDownhill: 0.3,
  chargeUphill: 0.4,
  /** 森林：受箭減傷、步兵防禦、騎兵衝鋒倍率、騎兵攻擊 */
  forestArrow: 0.3,
  forestDef: 0.08,
  forestCharge: 0.3,
  forestCavAtk: 0.8,
  /** 涉水（半渡而擊）：防禦、攻擊、交戰中士氣流失 */
  fordDef: 0.25,
  fordAtk: 0.85,
  fordMorale: 1.2,
  /** 己方營寨內：防禦、士氣回復 */
  campDef: 0.25,
  campMorale: 0.8,
  // 視野
  vision: 150,
  forestVision: 60,
  forestHideRange: 50,
};

/** 天氣效果 */
export const WEATHER = {
  rain: { range: 0.75, rangedDmg: 0.8, fire: 0.4, speed: 0.92, vision: 0.8, scatter: 1.2 },
  fog: { range: 1, rangedDmg: 1, fire: 1, speed: 1, vision: 0.45, scatter: 1.5 },
  clear: { range: 1, rangedDmg: 1, fire: 1, speed: 1, vision: 1, scatter: 1 },
};

export type SupplyState = 'ok' | 'low' | 'starving';

export const SUPPLY_EFFECTS: Record<SupplyState, { atk: number; def: number; speed: number; stamina: number; moraleCap: number; moraleDrain: number; name: string; icon: string }> = {
  ok: { atk: 1, def: 1, speed: 1, stamina: 1, moraleCap: 100, moraleDrain: 0, name: '充足', icon: '🍚' },
  low: { atk: 0.9, def: 0.95, speed: 0.95, stamina: 0.6, moraleCap: 75, moraleDrain: 0.2, name: '吃緊', icon: '🍙' },
  starving: { atk: 0.7, def: 0.8, speed: 0.8, stamina: 0.2, moraleCap: 50, moraleDrain: 0.7, name: '斷糧', icon: '💀' },
};
