// 全域規則數值（docs/02 §3–5、docs/03）；DEV 工具可即時調整並匯出
export const RULES = {
  // 戰鬥
  hitBase: 0.44,
  /** 近戰傷害倍率（攻擊 × 倍率） */
  meleeDmg: 0.4,
  /** 肉搏中的士氣持續流失（依兵力比放大） */
  meleeDrain: 0.12,
  hitPerPoint: 0.02,
  /** 側面、背後受到近戰傷害的倍率（正面倍率在各兵種 front） */
  flankMul: 1.4,
  rearMul: 2.0,
  /** 兵種相剋：騎剋射、盾剋槍（近戰）、射剋槍（箭矢）、騎兵衝鋒打弓弩 */
  cavVsMissile: 1.8,
  shieldVsPole: 1.15,
  missileVsPole: 1.35,
  /** 箭矢傷害總倍率 */
  rangedMul: 0.75,
  /** 每名騎兵一次衝鋒只撞一下：撞擊後幾秒內不再觸發（要拉開重衝） */
  chargeRecharge: 6,
  chargeVsMissile: 1.5,
  uphillMul: 1.15,
  chargeMinSpeed: 6,
  braceReflect: 3,
  friendlyFireMul: 0.5,
  pursuitMul: 1.5,
  engageRadius: 7,
  tether: 14,
  arrowMoraleHit: 0.4,
  // 士氣
  moralePerLossPct: 0.3,
  heavyLossShock: 6,
  /** 10 秒內損失超過此比例 → 驚嚇 */
  heavyLossPct: 0.15,
  flankDrain: 1,
  rearDrain: 2,
  chargeShock: 8,
  /** 騎兵正面衝擊列陣步兵的傷害倍率 */
  chargeFrontMul: 0.5,
  outnumberDrain: 0.3,
  friendRoutShock: 6,
  enemyRoutBoost: 4,
  generalAuraRadius: 40,
  generalAuraRegen: 1.5,
  generalDeathArmy: 10,
  generalDeathOwn: 25,
  /** 武將撤退：重傷（生命低於此比例）才撤；親衛全滅後武將仍會單騎作戰 */
  generalRetreatHp: 0.25,
  idleRegen: 1,
  /** 士氣分段（不會潰逃，只影響戰力）：高昂、低落、瓦解 */
  highThreshold: 80,
  lowThreshold: 50,
  brokenThreshold: 30,
  /** 動搖（AI 判斷撤退用） */
  waverThreshold: 35,
  /** 只剩開戰兵力的此比例 → 全軍敗退（殲滅九成） */
  defeatRemain: 0.1,
  fireDrain: 2,
  // 體力
  staminaRun: 1.2,
  staminaRunCav: 0.6,
  staminaCharge: 2.5,
  staminaFight: 0.8,
  staminaWalk: 0.1,
  staminaRest: 2,
  // 糧道（docs/03）
  /** 本陣存糧在糧道斷絕後能撐的秒數（劇本可用 consume 調整） */
  reserveSec: 110,
  /** 糧道暢通時的進糧速度（相對消耗） */
  lineFlow: 1.6,
  /** 斷糧道：敵軍站在糧道 25 m 內、附近 40 m 沒有我軍，持續 8 秒 */
  lineCutRadius: 25,
  lineGuardRadius: 40,
  lineCutTime: 8,
  /** 糧道被斷當下的全軍士氣衝擊 */
  lineCutShock: 10,
  /** 吃緊：本陣存糧低於此比例 */
  lowFrac: 0.4,
  /** 深入敵境、遠離己方糧道：幾秒後吃緊、幾秒後斷糧 */
  outLowSec: 60,
  outStarveSec: 120,
  /** 糧道沿線的補給寬度、營寨補給半徑 */
  lineSupplyWidth: 60,
  campSupplyRadius: 100,
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
  heightPerMeter: 0.035,
  heightMax: 0.45,
  heightMin: -0.35,
  /** 仰攻（交戰中比敵人低 5 m 以上）每秒士氣流失 */
  uphillMorale: 0.6,
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
  /** 半渡（涉水中或上岸 fordGrace 秒內）：受傷加成、攻擊倍率、交戰中士氣流失、箭傷加成 */
  fordDef: 0.6,
  fordAtk: 0.6,
  fordMorale: 1.5,
  fordGrace: 10,
  fordArrow: 1.3,
  /** 弓兵停下後架弓才能放箭（秒） */
  aimDelay: 1.2,
  /** 伏擊：從隱藏中殺出 → 目標中伏（士氣衝擊、持續秒數、受傷倍率、攻擊倍率） */
  ambushShock: 20,
  ambushTime: 12,
  ambushTaken: 1.35,
  ambushAtk: 0.8,
  /** 火場：每秒點燃機率、每次傷害、士氣流失、蔓延機率 */
  fireHitChance: 0.3,
  fireDmg: 18,
  fireMorale: 3,
  fireSpread: 0.35,
  /** 列陣迎敵（防守方）：站穩秒數、正面受傷倍率、反擊倍率 */
  formTime: 3,
  holdDef: 0.7,
  holdAtk: 1.15,
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

/** 糧況：暢通 → 糧道被斷（本陣存糧倒數）→ 吃緊 → 斷糧 */
export type SupplyState = 'ok' | 'cut' | 'low' | 'starving';

/** taken＝受到傷害倍率；moraleMin＝持續流失時的士氣下限 */
export const SUPPLY_EFFECTS: Record<SupplyState, { atk: number; taken: number; speed: number; stamina: number; moraleCap: number; moraleDrain: number; moraleMin: number; name: string; icon: string }> = {
  ok: { atk: 1, taken: 1, speed: 1, stamina: 1, moraleCap: 100, moraleDrain: 0, moraleMin: 0, name: '糧道暢通', icon: '🍚' },
  cut: { atk: 1, taken: 1, speed: 1, stamina: 0.9, moraleCap: 85, moraleDrain: 0.1, moraleMin: 40, name: '糧道被斷', icon: '✂️' },
  low: { atk: 0.9, taken: 1.15, speed: 1, stamina: 0.6, moraleCap: 70, moraleDrain: 0.2, moraleMin: 25, name: '吃緊', icon: '🍙' },
  starving: { atk: 0.8, taken: 1.35, speed: 0.85, stamina: 0.3, moraleCap: 60, moraleDrain: 0.7, moraleMin: 10, name: '斷糧', icon: '💀' },
};

/** 糧況嚴重程度（比較用） */
export const SUPPLY_RANK: Record<SupplyState, number> = { ok: 0, cut: 1, low: 2, starving: 3 };
