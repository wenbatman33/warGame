// 士兵、騎兵、武將的程式建模（頭身約 1:6，CoC 式厚實輪廓）
import * as THREE from 'three';
import { B, makeRig, RIDER_OFFSET, type Rig, type WeaponKind } from './rig';
import { between, box, cone, cyl, hemi, ModelBuilder, sphere, T } from './kit';

export type ModelKey =
  | 'sword'
  | 'spear'
  | 'ji'
  | 'archer'
  | 'crossbow'
  | 'lightcav'
  | 'heavycav'
  | 'horsearcher'
  | 'gen_glaive'
  | 'gen_spear'
  | 'gen_ji'
  | 'gen_sword'
  | 'gen_fan';

export interface ModelDef {
  key: ModelKey;
  weapon: WeaponKind;
  mounted: boolean;
  rig: Rig;
  geometry: THREE.BufferGeometry;
}

const COL = {
  skin: '#e2ae84',
  hair: '#2a1d16',
  pants: '#463c35',
  wraps: '#cbbd9c',
  boots: '#5a3a22',
  leather: '#7a5434',
  iron: '#737a80',
  lamellar: '#4a4640',
  steel: '#dfe5ea',
  bronze: '#c39343',
  gold: '#e8b84a',
  wood: '#8a5a32',
  darkwood: '#4e321d',
  white: '#f2ece0',
  rope: '#d8c9a0',
};

type Armor = 'light' | 'medium' | 'heavy' | 'general';
type Helmet = 'round' | 'cone' | 'cap' | 'band' | 'general' | 'guan';

interface HumanOpts {
  armor: Armor;
  helmet: Helmet;
  cape?: boolean;
  beard?: boolean;
  quiver?: boolean;
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 人形（綁定姿勢：站直、雙臂下垂、面向 +Z） */
function human(mb: ModelBuilder, o: HumanOpts): void {
  const armorTint = o.armor === 'light' ? 0 : o.armor === 'medium' ? 0.45 : 0.36;
  const vestCol = o.armor === 'light' ? COL.leather : COL.lamellar;
  // 腿
  for (const s of [1, -1]) {
    const x = 0.1 * s;
    const thigh = s > 0 ? B.thighL : B.thighR;
    const shin = s > 0 ? B.shinL : B.shinR;
    mb.add(between(cyl(0.075, 0.066, 1, 8), v(x, 0.93, 0), v(x, 0.5, 0)), COL.pants, thigh);
    mb.add(between(cyl(0.064, 0.05, 1, 8), v(x, 0.5, 0), v(x, 0.09, 0)), o.armor === 'light' ? COL.wraps : COL.boots, shin);
    mb.add(box(0.105, 0.085, 0.23), COL.boots, shin, T(x, 0.045, 0.045));
    if (o.armor === 'heavy' || o.armor === 'general') {
      // 護脛
      mb.add(box(0.1, 0.22, 0.05), COL.iron, shin, T(x, 0.33, 0.055));
    }
  }
  // 骨盆與甲裙
  mb.add(box(0.29, 0.17, 0.19), COL.pants, B.pelvis, T(0, 0.94, 0));
  mb.add(cyl(0.18, 0.255, 0.36, 10), vestCol, B.pelvis, T(0, 0.83, 0, 0, 0, 0, 1, 1, 0.74), armorTint);
  mb.add(box(0.15, 0.4, 0.035), '#ffffff', B.pelvis, T(0, 0.76, 0.165, -0.08), 1);
  mb.add(box(0.15, 0.36, 0.035), '#ffffff', B.pelvis, T(0, 0.78, -0.165, 0.08), 1);
  mb.add(cyl(0.2, 0.2, 0.07, 10), COL.leather, B.pelvis, T(0, 1.0, 0, 0, 0, 0, 1, 1, 0.76));
  mb.add(box(0.07, 0.06, 0.03), COL.bronze, B.pelvis, T(0, 1.0, 0.155));
  // 軀幹：內衣（隊伍色）＋ 甲
  mb.add(cyl(0.172, 0.158, 0.48, 10), '#ffffff', B.chest, T(0, 1.24, 0, 0, 0, 0, 1, 1, 0.68), 1);
  mb.add(cyl(0.19, 0.178, 0.38, 10), vestCol, B.chest, T(0, 1.25, 0.004, 0, 0, 0, 1, 1, 0.72), armorTint);
  if (o.armor === 'heavy' || o.armor === 'general') {
    mb.add(box(0.27, 0.17, 0.05), o.armor === 'general' ? COL.gold : COL.iron, B.chest, T(0, 1.33, 0.125, -0.1));
    mb.add(box(0.27, 0.12, 0.05), COL.iron, B.chest, T(0, 1.3, -0.125, 0.08));
  }
  if (o.armor !== 'light') {
    // 胸前護心鏡
    mb.add(cyl(0.06, 0.06, 0.02, 10), COL.bronze, B.chest, T(0, 1.3, 0.14, Math.PI / 2));
  }
  mb.add(cyl(0.055, 0.062, 0.1, 8), COL.skin, B.chest, T(0, 1.475, 0));
  // 頭
  mb.add(sphere(0.102, 10, 8), COL.skin, B.head, T(0, 1.585, 0.005, 0, 0, 0, 0.94, 1.1, 1));
  mb.add(box(0.032, 0.045, 0.045), COL.skin, B.head, T(0, 1.57, 0.1));
  mb.add(box(0.11, 0.02, 0.02), COL.hair, B.head, T(0, 1.615, 0.092));
  if (o.beard) {
    mb.add(box(0.12, 0.12, 0.08), COL.hair, B.head, T(0, 1.5, 0.07, 0.3));
  }
  helmet(mb, o.helmet);
  // 手臂
  for (const s of [1, -1]) {
    const ua = s > 0 ? B.uArmL : B.uArmR;
    const fa = s > 0 ? B.fArmL : B.fArmR;
    mb.add(between(cyl(0.054, 0.047, 1, 8), v(0.215 * s, 1.42, 0), v(0.235 * s, 1.13, 0)), '#ffffff', ua, undefined, 1);
    mb.add(between(cyl(0.047, 0.041, 1, 8), v(0.235 * s, 1.14, 0), v(0.245 * s, 0.89, 0)), o.armor === 'light' ? COL.wraps : COL.leather, fa);
    mb.add(sphere(0.046, 8, 6), COL.skin, fa, T(0.245 * s, 0.855, 0.005));
    // 肩甲
    mb.add(sphere(0.095, 8, 6), vestCol, ua, T(0.215 * s, 1.4, 0, 0, 0, 0.35 * s, 1.15, 0.72, 1.12), armorTint + (o.armor === 'light' ? 0.0 : 0.1));
  }
  if (o.cape) {
    mb.add(box(0.4, 0.82, 0.03), '#ffffff', B.chest, T(0, 1.02, -0.17, 0.14), 1);
  }
  if (o.quiver) {
    mb.add(cyl(0.055, 0.05, 0.52, 8), COL.leather, B.chest, T(0.1, 1.27, -0.17, 0, 0, 0.38));
    mb.add(box(0.1, 0.08, 0.08), COL.white, B.chest, T(0.2, 1.53, -0.17, 0, 0, 0.38));
  }
}

function helmet(mb: ModelBuilder, h: Helmet): void {
  switch (h) {
    case 'round':
      mb.add(hemi(0.118, 10, 5), COL.iron, B.head, T(0, 1.6, 0));
      mb.add(cyl(0.128, 0.128, 0.025, 10), COL.iron, B.head, T(0, 1.6, 0));
      mb.add(cyl(0.012, 0.012, 0.06), COL.bronze, B.head, T(0, 1.74, 0));
      mb.add(cone(0.045, 0.16, 6), '#ffffff', B.head, T(0, 1.83, 0, Math.PI), 1);
      // 護頸
      mb.add(box(0.2, 0.1, 0.04), COL.lamellar, B.head, T(0, 1.55, -0.1, 0.15));
      break;
    case 'cone':
      mb.add(cone(0.125, 0.22, 10), COL.iron, B.head, T(0, 1.71, 0));
      mb.add(cyl(0.122, 0.118, 0.06, 10), COL.bronze, B.head, T(0, 1.62, 0));
      mb.add(sphere(0.045, 6, 4), '#ffffff', B.head, T(0, 1.83, 0, 0, 0, 0, 1, 1.6, 1), 1);
      mb.add(box(0.2, 0.1, 0.04), COL.lamellar, B.head, T(0, 1.55, -0.1, 0.15));
      break;
    case 'cap':
      mb.add(cyl(0.104, 0.11, 0.09, 10), '#3a3430', B.head, T(0, 1.665, 0));
      mb.add(cyl(0.113, 0.113, 0.035, 10), '#ffffff', B.head, T(0, 1.635, 0), 1);
      mb.add(sphere(0.05, 6, 4), '#3a3430', B.head, T(0, 1.72, -0.02));
      break;
    case 'band':
      mb.add(sphere(0.106, 10, 6), COL.hair, B.head, T(0, 1.61, -0.012, 0, 0, 0, 1, 0.95, 1));
      mb.add(cyl(0.11, 0.11, 0.035, 10), '#ffffff', B.head, T(0, 1.63, 0), 1);
      mb.add(sphere(0.045, 6, 4), COL.hair, B.head, T(0, 1.69, -0.06));
      break;
    case 'guan':
      // 文官冠
      mb.add(sphere(0.106, 10, 6), COL.hair, B.head, T(0, 1.61, -0.012));
      mb.add(box(0.07, 0.12, 0.16), '#2a2a2a', B.head, T(0, 1.73, -0.01));
      mb.add(box(0.02, 0.02, 0.3), '#2a2a2a', B.head, T(0, 1.72, -0.02));
      break;
    case 'general':
      mb.add(hemi(0.125, 12, 6), COL.gold, B.head, T(0, 1.6, 0));
      mb.add(cyl(0.135, 0.135, 0.03, 12), COL.gold, B.head, T(0, 1.6, 0));
      mb.add(box(0.05, 0.12, 0.06), COL.gold, B.head, T(0.11, 1.54, 0.03));
      mb.add(box(0.05, 0.12, 0.06), COL.gold, B.head, T(-0.11, 1.54, 0.03));
      mb.add(box(0.22, 0.12, 0.05), COL.gold, B.head, T(0, 1.56, -0.11, 0.15));
      mb.add(cyl(0.015, 0.015, 0.1), COL.gold, B.head, T(0, 1.76, 0));
      mb.add(cone(0.06, 0.22, 8), '#ffffff', B.head, T(0, 1.9, 0, Math.PI), 1);
      // 雉雞翎
      mb.add(box(0.02, 0.02, 0.75), '#c0392b', B.head, T(0.05, 1.98, -0.25, -0.75));
      mb.add(box(0.02, 0.02, 0.75), '#c0392b', B.head, T(-0.05, 1.98, -0.25, -0.75));
      break;
  }
}

/** 兵器（右手骨骼，綁定時沿 +Z 從手部伸出） */
function weapon(mb: ModelBuilder, w: WeaponKind): void {
  const hx = -0.245;
  const hy = 0.86;
  const W = B.weapon;
  const along = (z0: number, z1: number) => [v(hx, hy, z0), v(hx, hy, z1)] as const;
  switch (w) {
    case 'sword': {
      mb.add(between(cyl(0.02, 0.02, 1, 6), ...along(-0.1, 0.06)), COL.darkwood, W);
      mb.add(box(0.09, 0.025, 0.035), COL.bronze, W, T(hx, hy, 0.075));
      mb.add(box(0.022, 0.075, 0.66), COL.steel, W, T(hx, hy + 0.012, 0.42));
      mb.add(box(0.022, 0.06, 0.12), COL.steel, W, T(hx, hy + 0.03, 0.78, -0.35));
      break;
    }
    case 'spear':
    case 'lance': {
      const L = w === 'lance' ? 3.4 : 3.3;
      const back = w === 'lance' ? 1.2 : 1.0;
      mb.add(between(cyl(0.022, 0.022, 1, 6), ...along(-back, L - back)), COL.wood, W);
      const tip = L - back;
      mb.add(cone(0.045, 0.3, 6), COL.steel, W, T(hx, hy, tip + 0.13, Math.PI / 2));
      mb.add(sphere(0.06, 6, 4), '#ffffff', W, T(hx, hy, tip - 0.08, 0, 0, 0, 1, 1, 1.6), 1);
      break;
    }
    case 'ji': {
      mb.add(between(cyl(0.024, 0.024, 1, 6), ...along(-0.8, 1.95)), COL.wood, W);
      mb.add(cone(0.04, 0.28, 6), COL.steel, W, T(hx, hy, 2.08, Math.PI / 2));
      mb.add(box(0.02, 0.22, 0.12), COL.steel, W, T(hx, hy + 0.11, 1.84, 0.2));
      mb.add(box(0.02, 0.1, 0.08), COL.steel, W, T(hx, hy - 0.07, 1.86));
      mb.add(sphere(0.055, 6, 4), '#ffffff', W, T(hx, hy, 1.72, 0, 0, 0, 1, 1, 1.6), 1);
      break;
    }
    case 'glaive': {
      // 青龍偃月刀
      mb.add(between(cyl(0.026, 0.026, 1, 6), ...along(-0.9, 1.65)), '#2f5d3a', W);
      mb.add(box(0.03, 0.2, 0.62), COL.steel, W, T(hx, hy + 0.07, 1.92, 0.08));
      mb.add(box(0.03, 0.1, 0.2), COL.steel, W, T(hx, hy + 0.17, 2.18, -0.6));
      mb.add(sphere(0.06, 6, 5), COL.gold, W, T(hx, hy, 1.64));
      mb.add(cone(0.035, 0.18, 6), COL.gold, W, T(hx, hy, -0.98, -Math.PI / 2));
      break;
    }
    case 'crossbow': {
      mb.add(box(0.055, 0.065, 0.72), COL.wood, W, T(hx, hy + 0.03, 0.22));
      mb.add(box(0.66, 0.035, 0.045), COL.darkwood, W, T(hx, hy + 0.05, 0.55));
      mb.add(box(0.62, 0.008, 0.008), COL.rope, W, T(hx, hy + 0.05, 0.47));
      mb.add(box(0.03, 0.03, 0.4), COL.steel, W, T(hx, hy + 0.08, 0.5));
      break;
    }
    case 'fan': {
      mb.add(between(cyl(0.015, 0.015, 1, 6), ...along(-0.05, 0.2)), COL.darkwood, W);
      mb.add(cone(0.16, 0.36, 10), COL.white, W, T(hx, hy, 0.4, -Math.PI / 2, 0, 0, 1, 1, 0.15));
      break;
    }
    default:
      break;
  }
}

/** 副手：盾或弓（左手骨骼） */
function offhand(mb: ModelBuilder, kind: 'shield' | 'bow' | 'smallshield'): void {
  const hx = 0.245;
  const hy = 0.86;
  const O = B.offhand;
  if (kind === 'shield' || kind === 'smallshield') {
    const r = kind === 'shield' ? 0.31 : 0.24;
    mb.add(cyl(r + 0.02, r + 0.02, 0.03, 14), COL.bronze, O, T(hx + 0.03, hy - 0.04, 0));
    mb.add(cyl(r, r, 0.045, 14), '#ffffff', O, T(hx + 0.03, hy - 0.04, 0), 1);
    mb.add(sphere(0.07, 8, 4), COL.bronze, O, T(hx + 0.03, hy - 0.04, 0, 0, 0, 0, 1, 0.55, 1));
    return;
  }
  // 弓：綁定沿 Z，弓背往 -Y 凸
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const z = -0.68 + (1.36 * i) / 6;
    const y = 0.16 * (z / 0.68) ** 2 - (Math.abs(z) > 0.6 ? (Math.abs(z) - 0.6) * 0.8 : 0);
    pts.push(v(hx, hy + y, z));
  }
  for (let i = 0; i < 6; i++) mb.add(between(cyl(0.022, 0.022, 1, 5), pts[i], pts[i + 1]), COL.darkwood, O);
  mb.add(between(cyl(0.004, 0.004, 1, 3), pts[0], pts[6]), COL.rope, O);
  mb.add(box(0.04, 0.05, 0.12), COL.leather, O, T(hx, hy, 0));
}

/** 馬（面向 +Z） */
function horse(mb: ModelBuilder, coat: string, o: { barding?: boolean; caparison?: boolean; gold?: boolean }): void {
  const dark = new THREE.Color(coat).multiplyScalar(0.55).getStyle();
  const H = B.hBody;
  mb.add(cyl(0.34, 0.33, 1.08, 12), coat, H, T(0, 1.22, -0.02, Math.PI / 2, 0, 0, 0.9, 1, 1));
  mb.add(sphere(0.36, 12, 8), coat, H, T(0, 1.24, 0.52, 0, 0, 0, 0.88, 1, 1));
  mb.add(sphere(0.37, 12, 8), coat, H, T(0, 1.27, -0.54, 0, 0, 0, 0.92, 1, 1));
  // 頸與頭
  mb.add(between(cyl(0.13, 0.21, 1, 10), v(0, 1.36, 0.6), v(0, 1.96, 0.98)), coat, B.hNeck);
  mb.add(box(0.07, 0.62, 0.14), dark, B.hNeck, T(0, 1.72, 0.74, -0.56));
  mb.add(box(0.2, 0.23, 0.52), coat, B.hNeck, T(0, 1.9, 1.18, 0.95));
  mb.add(box(0.17, 0.17, 0.12), dark, B.hNeck, T(0, 1.7, 1.38, 0.95));
  mb.add(cone(0.04, 0.13, 5), coat, B.hNeck, T(0.065, 2.1, 1.0, -0.2));
  mb.add(cone(0.04, 0.13, 5), coat, B.hNeck, T(-0.065, 2.1, 1.0, -0.2));
  // 腿
  const legsDef: [number, number, number, number][] = [
    [0.17, 0.62, B.hFLu, B.hFLl],
    [-0.17, 0.62, B.hFRu, B.hFRl],
    [0.17, -0.62, B.hBLu, B.hBLl],
    [-0.17, -0.68, B.hBRu, B.hBRl],
  ];
  for (const [x, z, up, lo] of legsDef) {
    const back = z < 0;
    mb.add(between(cyl(back ? 0.12 : 0.095, 0.065, 1, 8), v(x, 1.12, z), v(x, 0.58, z + (back ? -0.06 : 0.02))), coat, up);
    mb.add(between(cyl(0.05, 0.044, 1, 6), v(x, 0.6, z + (back ? -0.06 : 0.02)), v(x, 0.11, z + (back ? -0.04 : 0.03))), coat, lo);
    mb.add(cyl(0.06, 0.072, 0.11, 8), '#2a2522', lo, T(x, 0.055, z + (back ? -0.04 : 0.04)));
    mb.add(cyl(0.055, 0.055, 0.12, 6), dark, lo, T(x, 0.2, z + (back ? -0.04 : 0.03)));
  }
  mb.add(between(cyl(0.07, 0.03, 1, 6), v(0, 1.4, -0.92), v(0, 0.92, -1.14)), dark, B.hTail);
  // 鞍
  mb.add(box(0.46, 0.12, 0.56), COL.leather, H, T(0, 1.585, -0.1));
  mb.add(box(0.4, 0.14, 0.06), COL.leather, H, T(0, 1.66, 0.16));
  if (o.caparison || o.barding) {
    mb.add(box(0.76, 0.5, 0.9), '#ffffff', H, T(0, 1.33, -0.08), 1);
  }
  if (o.barding) {
    // 馬鎧：胸甲＋頸甲
    mb.add(sphere(0.4, 10, 6), o.gold ? COL.gold : COL.lamellar, H, T(0, 1.2, 0.56, 0, 0, 0, 0.9, 1, 0.9), o.gold ? 0 : 0.3);
    mb.add(between(cyl(0.16, 0.23, 1, 8), v(0, 1.4, 0.64), v(0, 1.82, 0.9)), o.gold ? COL.gold : COL.lamellar, B.hNeck, undefined, o.gold ? 0 : 0.3);
    mb.add(box(0.22, 0.12, 0.3), COL.iron, B.hNeck, T(0, 1.98, 1.12, 0.95));
  }
  // 韁繩
  mb.add(box(0.3, 0.02, 0.02), COL.leather, B.hNeck, T(0, 1.78, 1.3, 0.95));
}

interface Recipe {
  weapon: WeaponKind;
  mounted: boolean;
  human: HumanOpts;
  off?: 'shield' | 'bow' | 'smallshield';
  horse?: { coat: string; barding?: boolean; caparison?: boolean; gold?: boolean };
}

const RECIPES: Record<ModelKey, Recipe> = {
  sword: { weapon: 'sword', mounted: false, human: { armor: 'medium', helmet: 'round' }, off: 'shield' },
  spear: { weapon: 'spear', mounted: false, human: { armor: 'medium', helmet: 'cone' } },
  ji: { weapon: 'ji', mounted: false, human: { armor: 'heavy', helmet: 'round' } },
  archer: { weapon: 'bow', mounted: false, human: { armor: 'light', helmet: 'cap', quiver: true }, off: 'bow' },
  crossbow: { weapon: 'crossbow', mounted: false, human: { armor: 'light', helmet: 'band' } },
  lightcav: { weapon: 'sword', mounted: true, human: { armor: 'medium', helmet: 'band' }, off: 'smallshield', horse: { coat: '#8b5a33', caparison: true } },
  heavycav: { weapon: 'lance', mounted: true, human: { armor: 'heavy', helmet: 'round' }, horse: { coat: '#4b3427', barding: true } },
  horsearcher: { weapon: 'bow', mounted: true, human: { armor: 'light', helmet: 'band', quiver: true }, off: 'bow', horse: { coat: '#a87d55', caparison: true } },
  gen_glaive: { weapon: 'glaive', mounted: true, human: { armor: 'general', helmet: 'general', cape: true, beard: true }, horse: { coat: '#7a2a1a', barding: true, gold: true } },
  gen_spear: { weapon: 'lance', mounted: true, human: { armor: 'general', helmet: 'general', cape: true }, horse: { coat: '#ece6da', barding: true, gold: true } },
  gen_ji: { weapon: 'ji', mounted: true, human: { armor: 'general', helmet: 'general', cape: true, beard: true }, horse: { coat: '#2a2220', barding: true, gold: true } },
  gen_sword: { weapon: 'sword', mounted: true, human: { armor: 'general', helmet: 'general', cape: true, beard: true }, off: 'smallshield', horse: { coat: '#3b2a20', barding: true, gold: true } },
  gen_fan: { weapon: 'fan', mounted: true, human: { armor: 'light', helmet: 'guan', cape: true, beard: true }, horse: { coat: '#d9d2c4', caparison: true } },
};

export const MODEL_KEYS = Object.keys(RECIPES) as ModelKey[];

export function buildModel(key: ModelKey): ModelDef {
  const r = RECIPES[key];
  const mb = new ModelBuilder();
  if (r.mounted) {
    horse(mb, r.horse!.coat, r.horse!);
    mb.offset.set(RIDER_OFFSET.x, RIDER_OFFSET.y, RIDER_OFFSET.z);
  }
  human(mb, r.human);
  weapon(mb, r.weapon);
  if (r.off) offhand(mb, r.off);
  return { key, weapon: r.weapon, mounted: r.mounted, rig: makeRig(r.mounted), geometry: mb.build() };
}
