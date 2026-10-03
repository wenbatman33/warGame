import { describe, expect, it } from 'vitest';
import type { Scenario } from '../src/data/scenario';
import { UNITS } from '../src/data/units';
import { generateHeightfield } from '../src/map/mapgen';
import { NavGrid } from '../src/map/nav';
import { Regiment } from '../src/sim/regiment';
import { World } from '../src/sim/world';
import { PlayerTactics } from '../src/game/tactics';

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
    expect(r.frontage(n)).toBeCloseTo(UNITS.sword.width * UNITS.sword.spacing[0], 3);
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
  it('兩軍對撞會有傷亡，弱勢方被殲滅', () => {
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

  it('士兵不會潰逃：士氣歸零也照樣作戰', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: 0, z: 20, facing: 180 }], [{ type: 'sword', x: 0, z: -20, facing: 0 }]);
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    w.commandAttack([0], 1);
    for (let k = 0; k < 30 * 20; k++) {
      w.regs[1].morale = 0;
      w.step();
      w.events = [];
    }
    expect(w.regs[1].routing).toBe(false);
    expect(w.regs[1].alive).toBeGreaterThan(0);
    // 士氣瓦解：受到傷害 ×1.2
    expect(w.takenMul(w.regs[1])).toBeCloseTo(1.2, 3);
  });

  it('高地有近戰加成', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: 0, z: 0 }], [{ type: 'sword', x: 0, z: -50 }]);
    const w = new World(sc, generateHeightfield(sc.map));
    expect(w.heightMul(10, 0)).toBeCloseTo(1.35, 3);
    expect(w.heightMul(0, 10)).toBeCloseTo(0.65, 3);
    expect(w.heightMul(0, 0)).toBe(1);
  });
});

describe('武將', () => {
  it('主帥重傷撤退＝全軍敗退；士兵留下', () => {
    const sc = scenario(flat(), [{ type: 'guard', x: 0, z: 60, general: 'guanyu' }], [{ type: 'guard', x: 0, z: -60, general: 'yanliang' }]);
    sc.teams[1].commander = 'yanliang';
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    const r = w.regs[1];
    const gi = r.general!.soldier;
    const before = r.alive;
    // 親衛還在時武將受傷減半：打掉八成血需要 1.6 倍傷害
    w.damage(gi, w.s.maxHp[gi] * 1.6, -1);
    expect(r.general!.alive).toBe(false);
    expect(r.general!.fled).toBe(true);
    expect(r.alive).toBe(before - 1);
    expect(w.over).toBe(true);
    expect(w.winner).toBe(0);
  });

  it('史實單挑：劇本指定的兩位武將相遇才會單挑', () => {
    const sc = scenario(flat(), [{ type: 'guard', x: 0, z: 4, general: 'guanyu', facing: 180 }], [{ type: 'guard', x: 0, z: -4, general: 'yanliang', facing: 0 }]);
    const w = new World(sc, generateHeightfield(sc.map));
    w.duelFate = (a, b) => (a === 'guanyu' || b === 'guanyu' ? { winner: 'guanyu', killed: true } : null);
    w.started = true;
    // 兩位武將直接放到 3 m 內
    const ga = w.regs[0].general!.soldier;
    const gb = w.regs[1].general!.soldier;
    w.s.x[ga] = 0;
    w.s.z[ga] = 1.5;
    w.s.x[gb] = 0;
    w.s.z[gb] = -1.5;
    let duel: { winner: string } | null = null;
    for (let k = 0; k < 31 && !duel; k++) {
      w.step();
      for (const e of w.events) if (e.k === 'duel') duel = e;
      w.events = [];
    }
    expect(duel).not.toBeNull();
    expect(duel!.winner).toBe('關羽');
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

  it('糧道暢通時本陣會補糧，不會斷糧', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: -150, z: 100 }], [{ type: 'sword', x: 150, z: -100 }], true);
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    w.teams[1].hq!.stock = 1;
    for (let k = 0; k < 61; k++) w.step();
    expect(w.teams[1].supply).toBe('ok');
    expect(w.teams[1].hq!.stock).toBeGreaterThan(1);
  });

  it('敵軍站上糧道 8 秒 → 切斷 → 存糧耗盡斷糧；趕走後恢復', () => {
    // 糧倉 (160,-60) → 本陣 (0,-170)：佔住路線中段
    const sc = scenario(flat(), [{ type: 'sword', x: 80, z: -115, count: 40 }], [{ type: 'sword', x: 150, z: 100 }], true);
    sc.teams[1].depots = [{ x: 160, z: -60, stock: 500 }];
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    const depot = w.teams[1].depots[0];
    expect(depot.route.length).toBeGreaterThan(2);
    for (let k = 0; k < 30 * 10; k++) {
      w.step();
      w.events = [];
    }
    expect(depot.cut).toBe(true);
    expect(w.teams[1].lineOk).toBe(false);
    w.teams[1].hq!.stock = 1;
    for (let k = 0; k < 61; k++) w.step();
    expect(w.teams[1].supply).toBe('starving');
    // 斷糧：受到傷害 ×1.35
    expect(w.takenMul(w.regs[1])).toBeGreaterThanOrEqual(1.35);
    // 佔糧道的部隊離開 → 恢復
    for (const i of w.regs[0].members) w.s.x[i] += 200;
    w.regs[0].cx += 200;
    w.commandHalt([0]);
    for (let k = 0; k < 61; k++) w.step();
    expect(depot.cut).toBe(false);
    // 糧食要沿路線重新送到本陣（運糧時間依路線長度）
    expect(w.teams[1].supply).not.toBe('ok');
    for (let k = 0; k < Math.ceil(depot.transit + 2) * 30; k++) w.step();
    expect(w.teams[1].supply).toBe('ok');
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
      // 軍團幾乎都站在可走的地方（質心偶爾會落在柵欄格上，容許少數）
      const bad = w.regs.filter((r) => !r.gone && !w.nav.passable(r.mx, r.mz) && !w.isWet(r.mx, r.mz)).length;
      expect(bad).toBeLessThanOrEqual(2);
      expect(w.regs.filter((r) => r.team === 0).length).toBeGreaterThan(4);
    }, 30000);
  }
});

describe('戰線指令', () => {
  it('自動分組：螢幕左右分翼、騎兵當奇兵', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: -40, z: 80 }, { type: 'sword', x: 40, z: 80 }, { type: 'archer', x: 0, z: 110 }, { type: 'cav', x: 90, z: 100 }], [{ type: 'sword', x: 0, z: -80 }]);
    const w = new World(sc, generateHeightfield(sc.map));
    const tac = new PlayerTactics(w, 0);
    tac.assignGroups();
    expect(w.regs.slice(0, 4).map((r) => r.group)).toEqual(['left', 'right', 'center', 'strike']);
  });

  it('包抄：騎兵繞到敵軍背後', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: 0, z: 25 }, { type: 'cav', x: 120, z: 60 }], [{ type: 'sword', x: 0, z: -25 }]);
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    const tac = new PlayerTactics(w, 0);
    w.commandAttack([0], 2);
    tac.setStance([1], 'flank');
    let rear = 0;
    for (let k = 0; k < 30 * 45 && !w.over; k++) {
      w.step();
      tac.update();
      if (w.tick % 30 === 29) rear += w.regs[2].rearHits;
      w.events = [];
    }
    expect(rear).toBeGreaterThan(20);
  }, 30000);

  it('固守：被側擊會轉向迎敵', () => {
    const sc = scenario(flat(), [{ type: 'sword', x: 0, z: 0, facing: 180 }], [{ type: 'sword', x: 120, z: 0, facing: 270 }]);
    const w = new World(sc, generateHeightfield(sc.map));
    w.started = true;
    const tac = new PlayerTactics(w, 0);
    tac.setStance([0], 'hold');
    w.commandAttack([1], 0);
    for (let k = 0; k < 30 * 60 && !w.over; k++) {
      w.step();
      tac.update();
      w.events = [];
    }
    // 敵軍從 +x 方向來：朝向轉到約 90°
    const deg = (((w.regs[0].facing * 180) / Math.PI) % 360 + 360) % 360;
    expect(Math.abs(deg - 90)).toBeLessThan(40);
  }, 30000);
});
