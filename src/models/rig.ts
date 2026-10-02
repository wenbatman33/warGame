// 骨架定義與動作姿勢：步兵／騎兵共用 24 根骨骼，姿勢用函式算，之後烘焙成骨骼動畫貼圖
// 座標：角色面向 +Z，右手在 -X 側。下垂的四肢 rx 為負＝往前擺；軀幹 rx 為正＝前傾
export const B = {
  pelvis: 0,
  chest: 1,
  head: 2,
  uArmL: 3,
  fArmL: 4,
  uArmR: 5,
  fArmR: 6,
  thighL: 7,
  shinL: 8,
  thighR: 9,
  shinR: 10,
  weapon: 11,
  offhand: 12,
  hBody: 13,
  hNeck: 14,
  hFLu: 15,
  hFLl: 16,
  hFRu: 17,
  hFRl: 18,
  hBLu: 19,
  hBLl: 20,
  hBRu: 21,
  hBRl: 22,
  hTail: 23,
} as const;
export const BONE_COUNT = 24;

export type WeaponKind = 'sword' | 'spear' | 'ji' | 'bow' | 'crossbow' | 'lance' | 'glaive' | 'fan' | 'none';
export type AnimName = 'idle' | 'walk' | 'run' | 'attack' | 'shoot' | 'die' | 'die2' | 'cheer' | 'brace' | 'flee';

export interface AnimSpec {
  frames: number;
  dur: number;
  loop: boolean;
}
export const ANIMS: Record<AnimName, AnimSpec> = {
  idle: { frames: 12, dur: 2.6, loop: true },
  walk: { frames: 16, dur: 1.0, loop: true },
  run: { frames: 12, dur: 0.62, loop: true },
  attack: { frames: 16, dur: 1.1, loop: true },
  shoot: { frames: 24, dur: 2.2, loop: true },
  die: { frames: 16, dur: 0.9, loop: false },
  die2: { frames: 16, dur: 1.0, loop: false },
  cheer: { frames: 12, dur: 1.0, loop: true },
  brace: { frames: 4, dur: 2.0, loop: true },
  flee: { frames: 12, dur: 0.55, loop: true },
};
export const ANIM_ORDER: AnimName[] = ['idle', 'walk', 'run', 'attack', 'shoot', 'die', 'die2', 'cheer', 'brace', 'flee'];

export interface Rig {
  mounted: boolean;
  parent: Int8Array;
  pivot: Float32Array; // BONE_COUNT*3
}

/** 騎手抬到馬背上的位移 */
export const RIDER_OFFSET = { x: 0, y: 0.68, z: -0.12 };

const FOOT_PIVOTS: [number, number, number][] = [
  [0, 0.95, 0],
  [0, 1.02, 0],
  [0, 1.48, 0],
  [0.215, 1.41, 0],
  [0.235, 1.14, 0],
  [-0.215, 1.41, 0],
  [-0.235, 1.14, 0],
  [0.1, 0.92, 0],
  [0.1, 0.5, 0],
  [-0.1, 0.92, 0],
  [-0.1, 0.5, 0],
  [-0.245, 0.86, 0],
  [0.245, 0.86, 0],
];
const FOOT_PARENTS = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9, 6, 4];
const HORSE_PIVOTS: [number, number, number][] = [
  [0, 1.2, 0],
  [0, 1.45, 0.68],
  [0.17, 1.05, 0.62],
  [0.17, 0.58, 0.64],
  [-0.17, 1.05, 0.62],
  [-0.17, 0.58, 0.64],
  [0.17, 1.08, -0.62],
  [0.17, 0.58, -0.68],
  [-0.17, 1.08, -0.62],
  [-0.17, 0.58, -0.68],
  [0, 1.38, -0.95],
];
const HORSE_PARENTS = [-1, 13, 13, 15, 13, 17, 13, 19, 13, 21, 13];

export function makeRig(mounted: boolean): Rig {
  const parent = new Int8Array(BONE_COUNT).fill(-1);
  const pivot = new Float32Array(BONE_COUNT * 3);
  const o = mounted ? RIDER_OFFSET : { x: 0, y: 0, z: 0 };
  for (let b = 0; b < 13; b++) {
    parent[b] = FOOT_PARENTS[b];
    pivot[b * 3] = FOOT_PIVOTS[b][0] + o.x;
    pivot[b * 3 + 1] = FOOT_PIVOTS[b][1] + o.y;
    pivot[b * 3 + 2] = FOOT_PIVOTS[b][2] + o.z;
  }
  for (let i = 0; i < 11; i++) {
    const b = 13 + i;
    parent[b] = HORSE_PARENTS[i];
    pivot[b * 3] = HORSE_PIVOTS[i][0];
    pivot[b * 3 + 1] = HORSE_PIVOTS[i][1];
    pivot[b * 3 + 2] = HORSE_PIVOTS[i][2];
  }
  if (mounted) parent[B.pelvis] = B.hBody;
  return { mounted, parent, pivot };
}

export interface Pose {
  rot: Float32Array; // BONE_COUNT*3 歐拉角
  rootPos: [number, number, number];
  rootRot: [number, number, number];
  rootPivot: [number, number, number];
}

function newPose(): Pose {
  return { rot: new Float32Array(BONE_COUNT * 3), rootPos: [0, 0, 0], rootRot: [0, 0, 0], rootPivot: [0, 0, 0] };
}

const TAU = Math.PI * 2;
const S = Math.sin;
const ease = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const seg = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));

function set(p: Pose, b: number, rx: number, ry = 0, rz = 0): void {
  p.rot[b * 3] = rx;
  p.rot[b * 3 + 1] = ry;
  p.rot[b * 3 + 2] = rz;
}
function add(p: Pose, b: number, rx: number, ry = 0, rz = 0): void {
  p.rot[b * 3] += rx;
  p.rot[b * 3 + 1] += ry;
  p.rot[b * 3 + 2] += rz;
}

/** 依兵器的持械基本姿勢（上半身） */
function carry(p: Pose, w: WeaponKind, mounted: boolean): void {
  switch (w) {
    case 'sword':
      set(p, B.uArmR, -0.3, 0, -0.18);
      set(p, B.fArmR, -0.95);
      set(p, B.weapon, 0.45);
      // 盾在左前方
      set(p, B.uArmL, -0.45, 0, 0.18);
      set(p, B.fArmL, -1.25, 0.35, 0);
      set(p, B.offhand, 0.15, 0, 0);
      break;
    case 'spear':
    case 'lance':
      set(p, B.uArmR, -0.2, 0, -0.12);
      set(p, B.fArmR, -1.3);
      set(p, B.weapon, mounted ? 0.9 : -0.05);
      set(p, B.uArmL, 0.05, 0, 0.12);
      set(p, B.fArmL, -0.35);
      break;
    case 'ji':
    case 'glaive':
      set(p, B.uArmR, -0.25, 0, -0.15);
      set(p, B.fArmR, -1.25);
      set(p, B.weapon, 0.15);
      set(p, B.uArmL, -0.5, 0, 0.1);
      set(p, B.fArmL, -0.9, 0, -0.3);
      break;
    case 'bow':
      set(p, B.uArmL, -0.08, 0, 0.12);
      set(p, B.fArmL, -0.35);
      set(p, B.offhand, -1.15);
      set(p, B.uArmR, 0.05, 0, -0.12);
      set(p, B.fArmR, -0.3);
      break;
    case 'crossbow':
      set(p, B.uArmR, -0.35, 0, -0.1);
      set(p, B.fArmR, -0.9);
      set(p, B.weapon, 1.25);
      set(p, B.uArmL, -0.4, 0, 0.1);
      set(p, B.fArmL, -1.0, 0, -0.35);
      break;
    case 'fan':
      set(p, B.uArmR, -0.25, 0, -0.1);
      set(p, B.fArmR, -1.2);
      set(p, B.weapon, 1.2);
      set(p, B.uArmL, 0.05, 0, 0.1);
      set(p, B.fArmL, -0.4);
      break;
    default:
      set(p, B.uArmR, 0.05, 0, -0.1);
      set(p, B.fArmR, -0.3);
      set(p, B.uArmL, 0.05, 0, 0.1);
      set(p, B.fArmL, -0.3);
  }
}

/** 步行／奔跑的腿部循環 */
function legs(p: Pose, ph: number, amp: number, knee: number): void {
  const a = S(ph * TAU);
  const b = S(ph * TAU + Math.PI);
  set(p, B.thighL, -a * amp);
  set(p, B.thighR, -b * amp);
  set(p, B.shinL, Math.max(0, S(ph * TAU - 1.2)) * knee + 0.08);
  set(p, B.shinR, Math.max(0, S(ph * TAU + Math.PI - 1.2)) * knee + 0.08);
}

/** 騎乘時的腿（跨坐） */
function rideLegs(p: Pose): void {
  set(p, B.thighL, -1.25, 0, 0.38);
  set(p, B.thighR, -1.25, 0, -0.38);
  set(p, B.shinL, 1.35, 0, -0.1);
  set(p, B.shinR, 1.35, 0, 0.1);
}

/** 馬的步態 */
function horseGait(p: Pose, ph: number, kind: 'idle' | 'walk' | 'gallop'): void {
  const t = ph * TAU;
  if (kind === 'idle') {
    set(p, B.hNeck, 0.05 + S(t) * 0.04);
    set(p, B.hTail, 0.35, S(t * 2) * 0.25, 0);
    return;
  }
  if (kind === 'walk') {
    const a = 0.32;
    set(p, B.hFLu, -S(t) * a);
    set(p, B.hFLl, Math.max(0, S(t + 0.9)) * 0.7);
    set(p, B.hFRu, -S(t + Math.PI) * a);
    set(p, B.hFRl, Math.max(0, S(t + Math.PI + 0.9)) * 0.7);
    set(p, B.hBLu, -S(t + Math.PI * 0.5) * a);
    set(p, B.hBLl, -Math.max(0, S(t + Math.PI * 0.5 + 0.9)) * 0.5);
    set(p, B.hBRu, -S(t + Math.PI * 1.5) * a);
    set(p, B.hBRl, -Math.max(0, S(t + Math.PI * 1.5 + 0.9)) * 0.5);
    set(p, B.hNeck, 0.1 + S(t * 2) * 0.06);
    set(p, B.hTail, 0.4, S(t) * 0.15, 0);
    p.rootPos[1] = Math.abs(S(t)) * 0.03;
    return;
  }
  // 襲步（gallop）：前後腿成對、身體起伏
  const a = 0.75;
  set(p, B.hFLu, -S(t) * a - 0.1);
  set(p, B.hFLl, Math.max(0, S(t + 1.2)) * 1.4);
  set(p, B.hFRu, -S(t - 0.5) * a - 0.1);
  set(p, B.hFRl, Math.max(0, S(t - 0.5 + 1.2)) * 1.4);
  set(p, B.hBLu, -S(t + 2.4) * a * 0.85 + 0.1);
  set(p, B.hBLl, -Math.max(0, S(t + 2.4 + 1.0)) * 1.0);
  set(p, B.hBRu, -S(t + 1.9) * a * 0.85 + 0.1);
  set(p, B.hBRl, -Math.max(0, S(t + 1.9 + 1.0)) * 1.0);
  set(p, B.hBody, S(t + 0.6) * 0.09);
  set(p, B.hNeck, 0.25 + S(t + 1.2) * 0.18);
  set(p, B.hTail, 0.9 + S(t) * 0.2, 0, 0);
  p.rootPos[1] = Math.max(0, S(t + 0.3)) * 0.16;
}

/** 計算某兵器在某動作、某相位的姿勢 */
export function poseAt(w: WeaponKind, mounted: boolean, anim: AnimName, ph: number): Pose {
  const p = newPose();
  carry(p, w, mounted);
  if (mounted) rideLegs(p);
  const t = ph * TAU;

  switch (anim) {
    case 'idle': {
      add(p, B.chest, S(t) * 0.025);
      add(p, B.head, S(t + 1) * 0.03, S(t * 0.5) * 0.15);
      add(p, B.uArmR, S(t) * 0.03);
      add(p, B.uArmL, S(t + 0.5) * 0.03);
      if (mounted) horseGait(p, ph, 'idle');
      break;
    }
    case 'brace': {
      if (mounted) {
        horseGait(p, ph, 'idle');
        break;
      }
      // 拒馬：蹲低、長槍斜指前方
      set(p, B.thighL, -0.9);
      set(p, B.shinL, 1.0);
      set(p, B.thighR, 0.35);
      set(p, B.shinR, 0.55);
      p.rootPos[1] = -0.2;
      p.rootPos[2] = -0.05;
      set(p, B.chest, 0.3);
      set(p, B.uArmR, -0.55, 0, -0.1);
      set(p, B.fArmR, -0.35);
      set(p, B.weapon, 0.4);
      set(p, B.uArmL, -0.9, 0, -0.1);
      set(p, B.fArmL, -0.3, 0, -0.2);
      break;
    }
    case 'walk': {
      if (mounted) {
        horseGait(p, ph, 'walk');
        add(p, B.chest, S(t * 2) * 0.03);
        break;
      }
      legs(p, ph, 0.42, 0.7);
      p.rootPos[1] = -Math.abs(S(t)) * 0.035 + 0.01;
      add(p, B.chest, 0.04, S(t) * 0.06);
      add(p, B.pelvis, 0, -S(t) * 0.08);
      if (w === 'none' || w === 'bow') {
        add(p, B.uArmR, S(t) * 0.35);
        add(p, B.uArmL, -S(t) * 0.25);
      } else {
        add(p, B.uArmR, S(t) * 0.06);
        add(p, B.uArmL, -S(t) * 0.06);
      }
      break;
    }
    case 'run':
    case 'flee': {
      if (mounted) {
        horseGait(p, ph, 'gallop');
        add(p, B.chest, 0.15 + S(t + 0.6) * 0.06);
        if (anim === 'flee') {
          add(p, B.head, -0.2, 0.6);
        } else if (w === 'lance' || w === 'spear') {
          // 衝鋒時長矛放平
          set(p, B.uArmR, -0.35, 0, -0.12);
          set(p, B.fArmR, -0.5);
          set(p, B.weapon, 0.82);
        }
        break;
      }
      legs(p, ph, 0.78, 1.5);
      p.rootPos[1] = Math.abs(S(t)) * 0.06 - 0.02;
      add(p, B.chest, 0.28, S(t) * 0.1);
      add(p, B.head, -0.15);
      if (anim === 'flee') {
        // 潰逃：丟下陣型、雙手亂擺、回頭張望
        set(p, B.uArmR, S(t) * 0.9 - 0.2, 0, -0.3);
        set(p, B.fArmR, -0.9);
        set(p, B.uArmL, -S(t) * 0.9 - 0.2, 0, 0.3);
        set(p, B.fArmL, -0.9);
        add(p, B.head, 0, 0.5 * S(t * 0.5));
      } else {
        add(p, B.uArmR, S(t) * 0.3);
        add(p, B.uArmL, -S(t) * 0.3);
      }
      break;
    }
    case 'attack': {
      if (mounted) horseGait(p, ph, 'idle');
      else {
        set(p, B.thighL, -0.35);
        set(p, B.shinL, 0.25);
        set(p, B.thighR, 0.3);
        set(p, B.shinR, 0.2);
        p.rootPos[1] = -0.04;
      }
      const wind = ease(seg(ph, 0.05, 0.4));
      const strike = easeOut(seg(ph, 0.4, 0.55));
      const back = ease(seg(ph, 0.6, 1));
      const k = wind * (1 - strike);
      const s = strike * (1 - back);
      if (w === 'spear' || w === 'ji' || w === 'lance' || w === 'glaive') {
        if (w === 'spear' || w === 'lance') {
          // 突刺：長槍放平、往前刺
          set(p, B.uArmR, -0.45 - s * 0.5 + k * 0.25, 0, -0.1);
          set(p, B.fArmR, -0.45 + s * 0.25);
          set(p, B.weapon, mounted ? 0.95 : 0.85);
          set(p, B.uArmL, -0.75 - s * 0.3, 0, -0.15);
          set(p, B.fArmL, -0.5, 0, -0.3);
          add(p, B.chest, 0.15 + s * 0.2 - k * 0.1, -k * 0.3 + s * 0.15);
          if (!mounted) p.rootPos[2] = s * 0.25 - k * 0.1;
        } else {
          // 劈砍：長柄由上往下
          set(p, B.uArmR, -0.4 - k * 1.9 - s * 0.1, 0, -0.2);
          set(p, B.fArmR, -1.0 + k * 0.5 + s * 0.6);
          set(p, B.weapon, 0.3 + s * 0.8);
          set(p, B.uArmL, -0.6 - k * 1.2, 0, 0.1);
          set(p, B.fArmL, -0.9);
          add(p, B.chest, -k * 0.15 + s * 0.3, -k * 0.35 + s * 0.3);
        }
      } else if (w === 'bow' || w === 'crossbow' || w === 'fan' || w === 'none') {
        // 遠程兵近戰：揮拳／弓身亂打
        set(p, B.uArmR, -0.4 - k * 1.4, 0, -0.2);
        set(p, B.fArmR, -0.9 + s * 0.5);
        add(p, B.chest, s * 0.2, -k * 0.3 + s * 0.3);
      } else {
        // 刀：高舉後斜劈
        set(p, B.uArmR, -0.35 - k * 2.3 + s * 0.6, 0, -0.25 - k * 0.3);
        set(p, B.fArmR, -0.9 + k * 0.4 + s * 0.5);
        set(p, B.weapon, 0.45 + s * 0.8);
        add(p, B.uArmL, -0.15 * s);
        add(p, B.chest, -k * 0.1 + s * 0.3, -k * 0.4 + s * 0.45);
      }
      break;
    }
    case 'shoot': {
      if (mounted) horseGait(p, ph, 'idle');
      else {
        set(p, B.thighL, -0.25);
        set(p, B.thighR, 0.2);
        set(p, B.shinR, 0.1);
      }
      if (w === 'crossbow') {
        // 舉弩瞄準 → 發射後坐 → 蹬弩上弦
        const aim = ease(seg(ph, 0, 0.2)) * (1 - ease(seg(ph, 0.45, 0.6)));
        const recoil = seg(ph, 0.3, 0.36) * (1 - seg(ph, 0.36, 0.5));
        const reload = ease(seg(ph, 0.6, 0.75)) * (1 - ease(seg(ph, 0.9, 1)));
        set(p, B.uArmR, -0.35 - aim * 0.9 - reload * 0.2 + recoil * 0.15, 0, -0.1);
        set(p, B.fArmR, -0.9 - aim * 0.4 + reload * 0.4);
        set(p, B.weapon, 1.25 + aim * 1.3 - reload * 0.9);
        set(p, B.uArmL, -0.4 - aim * 0.8, 0, 0.1);
        set(p, B.fArmL, -1.0 - aim * 0.3, 0, -0.35);
        add(p, B.chest, reload * 0.5, -aim * 0.15);
        add(p, B.head, -aim * 0.1 + reload * 0.3);
      } else {
        // 拋射：舉弓仰角、拉弦、放箭、從箭筒取箭
        const raise = ease(seg(ph, 0.05, 0.3));
        const draw = ease(seg(ph, 0.25, 0.55));
        const release = seg(ph, 0.62, 0.66);
        const lower = ease(seg(ph, 0.7, 0.95));
        const up = raise * (1 - lower);
        const pull = draw * (1 - release);
        set(p, B.uArmL, -0.08 - up * 2.0, 0, 0.12 - up * 0.1);
        set(p, B.fArmL, -0.35 + up * 0.35);
        set(p, B.offhand, -1.15 + up * 1.15);
        set(p, B.uArmR, 0.05 - up * 1.55 - pull * 0.1, 0, -0.12 + up * 0.25);
        set(p, B.fArmR, -0.3 - up * 0.3 - pull * 1.6 + release * 0.3 * (1 - lower));
        add(p, B.chest, -up * 0.12, up * 0.35);
        add(p, B.head, -up * 0.2, -up * 0.3);
        // 取箭：右手往背後
        const fetch = ease(seg(ph, 0.85, 0.95)) * (1 - seg(ph, 0.97, 1));
        add(p, B.uArmR, fetch * 0.6, 0, -fetch * 0.3);
      }
      break;
    }
    case 'cheer': {
      if (mounted) horseGait(p, ph, 'idle');
      const up = 0.5 + 0.5 * S(t);
      set(p, B.uArmR, -2.6 - up * 0.3, 0, -0.25);
      set(p, B.fArmR, -0.3 - up * 0.2);
      set(p, B.weapon, w === 'spear' || w === 'lance' ? -0.3 : 0.3);
      add(p, B.head, -0.25);
      if (!mounted) p.rootPos[1] = up * 0.06;
      break;
    }
    case 'die':
    case 'die2': {
      const fwd = anim === 'die2';
      if (mounted) {
        // 人仰馬翻：馬往側倒
        const f = ease(seg(ph, 0, 0.85));
        p.rootPivot = [0, 0, 0];
        p.rootRot = [0, 0, (fwd ? -1 : 1) * f * 1.45];
        p.rootPos = [0, f * 0.28, 0];
        set(p, B.hFLu, -f * 0.6);
        set(p, B.hBLu, f * 0.5);
        set(p, B.hNeck, -f * 0.5);
        add(p, B.chest, -f * 0.5);
        add(p, B.uArmR, -f * 1.2);
        add(p, B.uArmL, -f * 1.2);
        break;
      }
      const knee = ease(seg(ph, 0, 0.35));
      const fall = ease(seg(ph, 0.15, 0.9));
      p.rootPivot = [0, 0, fwd ? 0.25 : -0.2];
      p.rootRot = [(fwd ? 1 : -1) * fall * 1.5, 0, (fwd ? 0.12 : -0.15) * fall];
      p.rootPos = [0, fall * 0.13 - knee * 0.25 * (1 - fall), 0];
      set(p, B.thighL, -knee * 0.6 * (1 - fall));
      set(p, B.thighR, -knee * 0.3 * (1 - fall) + fall * 0.2);
      set(p, B.shinL, knee * 1.2 * (1 - fall) + fall * 0.4);
      set(p, B.shinR, knee * 0.8 * (1 - fall) + fall * 0.2);
      add(p, B.chest, (fwd ? 0.4 : -0.3) * fall);
      add(p, B.head, (fwd ? -0.5 : -0.4) * fall);
      set(p, B.uArmR, -fall * (fwd ? 2.2 : 1.4) + 0.1, 0, -0.5 * fall);
      set(p, B.fArmR, -0.3);
      set(p, B.uArmL, -fall * (fwd ? 2.0 : 1.6), 0, 0.6 * fall);
      set(p, B.fArmL, -0.4);
      add(p, B.weapon, fall * 0.6);
      break;
    }
  }
  return p;
}
