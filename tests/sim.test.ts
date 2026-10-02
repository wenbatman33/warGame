import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/data/scenario';
import { UNITS } from '../src/data/units';
import { generateHeightfield } from '../src/map/mapgen';
import { NavGrid } from '../src/map/nav';
import { Regiment } from '../src/sim/regiment';
import { World } from '../src/sim/world';

const flat = (extra: Partial<Scenario['map']> = {}): Scenario['map'] => ({ play: 400, seed: 1, noiseAmp: 0.2, ...extra });

function scenario(map: Scenario['map'], a: Scenario['teams'][0]['regiments'], b: Scenario['teams'][1]['regiments'], depots = false): Scenario {
  return {
    id: 't',
    title: 't',
    subtitle: '',
    year: '',
    intro: [],
    goals: [],
    map,
    teams: [
      { faction: 'wei', name: '甲', regiments: a, depots: depots ? [{ x: 0, z: 150, stock: 500 }] : [], hq: { x: 0, z: 170 } },
      { faction: 'yuan', name: '乙', regiments: b, depots: depots ? [{ x: 0, z: -150, stock: 500 }] : [], hq: { x: 0, z: -170 } },
    ],
    stars: [
      { text: '', check: () => true },
      { text: '', check: () => true },
      { text: '', check: () => true },
    ],
  };
}

describe('陣型', () => {
  it('陣位不重疊、以中心對稱', () => {
    const r = new Regiment(0, 0, 'wei', UNITS.sword, 't');
    const n = 120;
    const seen = new Set<string>();
    let sx = 0;
    let sz = 0;
    const p: [number, number] = [0, 0];
    for (let i = 0; i < n; i++) {
      r.slotLocal(i, n, p);
      const k = `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
      sx += p[0];
      sz += p[1];
    }
    expect(Math.abs(sx / n)).toBeLessThan(0.01);
    expect(Math.abs(sz / n)).toBeLessThan(0.01);
    expect(r.frontage(n)).toBeCloseTo(20 * UNITS.sword.spacing[0], 3);
  });
});

describe('尋路', () => {
  it('過河會找淺灘', () => {
    const hf = generateHeightfield(flat({ rivers: [{ pts: [[-250, 0], [250, 0]], w: 24, fords: [{ t: 0.8, w: 24 }] }] }));
    const nav = new NavGrid(hf);
    expect(nav.passable(0, 0)).toBe(false);
    const path = nav.findPath(0, 60, 0, -60);
    const crossing = path.some(([x]) => x > 60);
    expect(crossing).toBe(true);
    const end = path[path.length - 1];
    expect(Math.hypot(end[0], end[1] + 60)).toBeLessThan(6);
  });
});

describe('戰鬥與士氣', () => {
  it('兩軍對撞會有傷亡，弱勢方最終潰逃', () => {
    const sc = scenario(
      flat(),
      [
        { type: 'sword', x: 0, z: 20, facing: 180 },
        { type: 'sword', x: 30, z: 20, facing: 180 },
      ],
      [{ type: 'sword', x: 0, z: -20, facing: 0, count: 60, morale: 50 }],
    );
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    w.commandAttack([0, 1], 2);
    let routed = false;
    for (let k = 0; k < 30 * 120 && !routed; k++) {
      w.step();
      w.events = [];
      routed = w.regs[2].routing || w.regs[2].gone;
    }
    for (let k = 0; k < 31; k++) w.step();
    expect(w.teams[1].dead).toBeGreaterThan(0);
    expect(routed).toBe(true);
    expect(w.over).toBe(true);
    expect(w.winner).toBe(0);
  });

  it('高地有近戰加成', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: 0, z: 0 }], [{ type: 'sword', x: 0, z: -50 }]);
    const w = new World(sc, generateHeightfield(sc.map));
    expect(w.heightMul(10, 0)).toBeCloseTo(1.3, 3);
    expect(w.heightMul(0, 10)).toBeCloseTo(0.75, 3);
    expect(w.heightMul(0, 0)).toBe(1);
  });
});

describe('糧草', () => {
  it('糧倉焚毀 → 全軍士氣重挫、糧況吃緊', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: -100, z: 100 }], [{ type: 'sword', x: 100, z: -100 }], true);
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    const before = w.regs[1].morale;
    const depot = w.teams[1].depots[0];
    w.burnDown(depot);
    expect(w.regs[1].morale).toBeLessThan(before - 20);
    for (let k = 0; k < 31; k++) w.step();
    expect(w.teams[1].supply).not.toBe('ok');
  });

  it('本陣存糧耗盡 → 斷糧', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: -100, z: 100 }], [{ type: 'sword', x: 100, z: -100 }], true);
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    w.teams[1].hq!.stock = 1;
    for (let k = 0; k < 61; k++) w.step();
    expect(w.teams[1].supply).toBe('starving');
  });
});

import { AiCommander } from '../src/ai/commander';
import { CAMPAIGN } from '../src/data/scenarios/index';

describe('劇本', () => {
  for (const e of CAMPAIGN) {
    it(`${e.name}：可以生成並模擬 40 秒`, () => {
      const sc = e.scenario!;
      const w = new World(sc, generateHeightfield(sc.map));
      const ai = sc.teams[1].ai ? new AiCommander(w, 1, { ...sc.teams[1].ai }, 'normal') : null;
      w.started = true;
      w.flags.startT = 0;
      sc.onStart?.(w);
      for (let k = 0; k < 30 * 40; k++) {
        w.step();
        ai?.update();
        w.events = [];
      }
      // 所有軍團都站在可走的地方
      for (const r of w.regs) {
        if (r.gone) continue;
        expect(w.nav.passable(r.mx, r.mz) || w.isWet(r.mx, r.mz)).toBe(true);
      }
      expect(w.regs.filter((r) => r.team === 0).length).toBeGreaterThan(4);
    });
  }
});
