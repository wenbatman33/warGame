// 自訂會戰：依選項程式產生劇本（地形、兵力、勢力、糧倉、時間）
import type { FactionId } from '../data/factions';
import { FACTIONS } from '../data/factions';
import { GENERALS, type GeneralId } from '../data/generals';
import type { RegimentSpec, Scenario } from '../data/scenario';
import type { UnitTypeId } from '../data/units';
import type { MapSpec } from '../map/mapgen';

export interface CustomOptions {
  terrain: 'plain' | 'river' | 'hills' | 'forest';
  player: FactionId;
  enemy: FactionId;
  mySize: number;
  enemySize: number;
  depots: boolean;
  time: 'day' | 'dusk' | 'night';
  difficulty: 'easy' | 'normal' | 'hard';
  weather: 'clear' | 'rain' | 'fog';
}

export const CUSTOM_DEFAULT: CustomOptions = { terrain: 'river', player: 'wei', enemy: 'wu', mySize: 10, enemySize: 10, depots: true, time: 'day', difficulty: 'normal', weather: 'clear' };

const COMPOSITION: UnitTypeId[] = ['sword', 'spear', 'archer', 'sword', 'cav', 'spear', 'archer', 'cav', 'sword', 'archer', 'spear', 'cav', 'spear', 'cav', 'sword', 'archer', 'archer', 'cav', 'sword'];

function generalsOf(f: FactionId): GeneralId[] {
  return (Object.keys(GENERALS) as GeneralId[]).filter((g) => GENERALS[g].faction === f && GENERALS[g].ability);
}

function army(f: FactionId, size: number, side: 1 | -1, rnd: () => number): RegimentSpec[] {
  const gens = generalsOf(f);
  const out: RegimentSpec[] = [];
  const z0 = side * 120;
  const facing = side > 0 ? 180 : 0;
  // 主帥＋一名武將
  if (gens[0]) out.push({ type: 'guard', x: 0, z: z0 + side * 40, general: gens[0], role: 'reserve', facing });
  if (gens[1] && size >= 8) out.push({ type: 'guard', x: side * 120, z: z0 + side * 20, general: gens[1], facing });
  const n = size - out.length;
  const comp = COMPOSITION.slice(0, n);
  const inf = comp.filter((t) => t === 'sword' || t === 'spear');
  const rng = comp.filter((t) => t === 'archer');
  const cav = comp.filter((t) => t === 'cav');
  const spread = (list: UnitTypeId[], z: number, gap: number) =>
    list.forEach((t, k) => out.push({ type: t, x: (k - (list.length - 1) / 2) * gap + (rnd() - 0.5) * 6, z, facing }));
  spread(inf, z0, 30);
  spread(rng, z0 + side * 28, 40);
  cav.forEach((t, k) => out.push({ type: t, x: (k % 2 ? 1 : -1) * (inf.length * 15 + 30 + Math.floor(k / 2) * 30), z: z0 + side * 10, facing }));
  return out;
}

export function buildCustomScenario(o: CustomOptions): Scenario {
  let seed = (Date.now() % 100000) | 0;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed & 0xffff) / 0x10000;
  };
  const map: MapSpec = { play: 540, seed: seed % 9973, hills: [], forests: [], rivers: [], roads: [], clearings: [] };
  const r = (a: number, b: number) => a + rnd() * (b - a);
  map.roads!.push({ pts: [[r(-40, 40), 300], [r(-60, 60), 80], [r(-60, 60), -80], [r(-40, 40), -300]], w: 7 });
  if (o.terrain === 'river') {
    map.rivers!.push({ pts: [[-330, r(-30, 30)], [-120, r(-40, 40)], [80, r(-40, 40)], [330, r(-30, 30)]], w: 24, fords: [{ t: r(0.15, 0.3), w: 26 }, { t: r(0.45, 0.55), w: 32 }, { t: r(0.7, 0.85), w: 26 }] });
  }
  const hillN = o.terrain === 'hills' ? 6 : o.terrain === 'plain' ? 2 : 3;
  for (let k = 0; k < hillN; k++) map.hills!.push({ x: r(-220, 220), z: r(-160, 160), r: r(35, 70), h: r(5, o.terrain === 'hills' ? 14 : 9), plateau: rnd() < 0.5 });
  const forestN = o.terrain === 'forest' ? 8 : o.terrain === 'plain' ? 2 : 4;
  for (let k = 0; k < forestN; k++) map.forests!.push({ x: r(-240, 240), z: r(-200, 200), r: r(30, o.terrain === 'forest' ? 70 : 50), density: r(0.7, 1) });
  map.clearings!.push({ x: 0, z: 220, r: 40 }, { x: 0, z: -220, r: 40 }, { x: -170, z: 245, r: 30 }, { x: 170, z: -245, r: 30 }, { x: 0, z: 130, r: 60 }, { x: 0, z: -130, r: 60 });
  const me = FACTIONS[o.player];
  const en = FACTIONS[o.enemy === o.player ? (o.player === 'wei' ? 'wu' : 'wei') : o.enemy];
  const myArmy = army(o.player, o.mySize, 1, rnd);
  const enArmy = army(en.id, o.depots ? o.enemySize - 1 : o.enemySize, -1, rnd);
  const myGen = myArmy.find((x) => x.general)?.general;
  const enGen = enArmy.find((x) => x.general)?.general;
  return {
    id: 'custom',
    title: '自訂會戰',
    subtitle: `${me.name}軍 對 ${en.name}軍`,
    year: '',
    intro: [],
    goals: ['擊潰敵軍'],
    time: o.time,
    weather: o.weather,
    camera: { x: 0, z: 150, dist: 230 },
    map,
    teams: [
      {
        faction: o.player,
        name: `${me.name}軍`,
        commander: myGen,
        hq: { x: 0, z: 222 },
        depots: o.depots ? [{ x: -170, z: 248, stock: 900, name: '後方糧倉' }] : [],
        deploy: { x: 0, z: 130, w: 460, d: 150 },
        regiments: myArmy,
      },
      {
        faction: en.id,
        name: `${en.name}軍`,
        commander: enGen,
        hq: { x: 0, z: -222 },
        depots: o.depots ? [{ x: 170, z: -248, stock: 1100, main: true, name: '敵軍糧倉' }] : [],
        ai: { plan: 'attack', aggression: 0.7, raid: o.depots, startDelay: 20 },
        regiments: [...enArmy, ...(o.depots ? [{ type: 'spear' as UnitTypeId, x: 150, z: -225, role: 'guard' as const, count: 80, facing: 0 }] : [])],
        consume: 1.3,
      },
    ],
    stars: [
      { text: '擊潰敵軍', check: (w) => w.winner === 0 },
      { text: '傷亡少於四成', check: (w) => w.winner === 0 && w.teams[0].dead + w.teams[0].fled < w.teams[0].initialStrength * 0.4 },
      o.depots ? { text: '焚燒敵軍糧倉', check: (w) => w.teams[1].depotsBurnt > 0 } : { text: '斬殺敵方主帥', check: (w) => w.regs.some((x) => x.team === 1 && x.general && !x.general.alive && !x.general.fled) },
    ],
  };
}
