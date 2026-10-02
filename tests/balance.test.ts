// 平衡測試（BALANCE=1 npx vitest run tests/balance.test.ts）：量測各種對戰的潰逃時間與傷亡
import { describe, it } from 'vitest';
import type { RegimentSpec, Scenario } from '../src/data/scenario';
import { generateHeightfield } from '../src/map/mapgen';
import { World } from '../src/sim/world';
import { AiCommander } from '../src/ai/commander';
import { GUANDU } from '../src/data/scenarios/guandu';

const RUN = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.BALANCE;

function fight(name: string, a: RegimentSpec[], b: RegimentSpec[], orders: (w: World) => void, maxT = 300): void {
  const sc: Scenario = {
    id: 'b',
    title: '',
    subtitle: '',
    year: '',
    intro: [],
    goals: [],
    map: { play: 500, seed: 3, noiseAmp: 0.1 },
    teams: [
      { faction: 'wei', name: '甲', regiments: a, depots: [] },
      { faction: 'yuan', name: '乙', regiments: b, depots: [] },
    ],
    stars: [
      { text: '', check: () => true },
      { text: '', check: () => true },
      { text: '', check: () => true },
    ],
  };
  const w = new World(sc, generateHeightfield(sc.map));
  w.started = true;
  orders(w);
  const firstRout: string[] = [];
  let contact = -1;
  for (let k = 0; k < maxT * 30 && !w.over; k++) {
    w.step();
    for (const ev of w.events) if (ev.k === 'rout' && firstRout.length < 3) firstRout.push(`${w.regs[ev.reg].team}:${w.regs[ev.reg].name}@${w.t.toFixed(0)}`);
    w.events = [];
    if (contact < 0 && w.regs.some((r) => r.engagedWith.size > 0)) contact = w.t;
  }
  const lossA = w.teams[0].dead;
  const lossB = w.teams[1].dead;
  console.log(`${name}: 接戰 ${contact.toFixed(0)}s 結束 ${w.t.toFixed(0)}s 勝方 ${w.winner} 甲陣亡 ${lossA}/${w.teams[0].initialStrength} 乙陣亡 ${lossB}/${w.teams[1].initialStrength} 首潰 ${firstRout.join(' ')}`);
}

describe.runIf(RUN)('平衡', () => {
  it('刀盾 vs 刀盾（同兵力）', () => {
    fight('刀盾對刀盾', [{ type: 'sword', x: 0, z: 30 }], [{ type: 'sword', x: 0, z: -30 }], (w) => w.commandAttack([0], 1));
  });
  it('刀盾 vs 長槍', () => {
    fight('刀盾對長槍', [{ type: 'sword', x: 0, z: 30 }], [{ type: 'spear', x: 0, z: -30 }], (w) => w.commandAttack([0], 1));
  });
  it('重騎正面衝 長槍（堅守）', () => {
    fight('重騎衝堅守長槍', [{ type: 'heavycav', x: 0, z: 120 }], [{ type: 'spear', x: 0, z: -10, hold: true }], (w) => w.commandAttack([0], 1));
  });
  it('重騎正面衝 刀盾', () => {
    fight('重騎衝刀盾', [{ type: 'heavycav', x: 0, z: 120 }], [{ type: 'sword', x: 0, z: -10 }], (w) => w.commandAttack([0], 1));
  });
  it('刀盾交戰中，重騎背襲', () => {
    fight(
      '夾擊',
      [
        { type: 'sword', x: 0, z: 25 },
        { type: 'heavycav', x: 0, z: -150, facing: 180 },
      ],
      [{ type: 'sword', x: 0, z: -25 }],
      (w) => {
        w.commandAttack([0], 2);
        w.commandAttack([1], 2);
      },
    );
  });
  it('弓兵射擊刀盾（不接近）', () => {
    fight('弓射刀盾', [{ type: 'archer', x: 0, z: 60 }], [{ type: 'sword', x: 0, z: -60, hold: true }], (w) => w.commandAttack([0], 1), 120);
  });
  it('弓兵射擊長槍', () => {
    fight('弓射長槍', [{ type: 'archer', x: 0, z: 60 }], [{ type: 'spear', x: 0, z: -60, hold: true }], (w) => w.commandAttack([0], 1), 120);
  });
  it('3 團 vs 3 團混合', () => {
    fight(
      '三對三',
      [
        { type: 'sword', x: -30, z: 40 },
        { type: 'spear', x: 30, z: 40 },
        { type: 'archer', x: 0, z: 70 },
      ],
      [
        { type: 'sword', x: -30, z: -40 },
        { type: 'sword', x: 30, z: -40 },
        { type: 'archer', x: 0, z: -70 },
      ],
      (w) => {
        w.commandAttack([0], 3);
        w.commandAttack([1], 4);
        w.commandAttack([3], 0);
        w.commandAttack([4], 1);
      },
    );
  });
  it('官渡：守河岸＋輕騎燒烏巢', () => {
    const sc = GUANDU;
    const w = new World(sc, generateHeightfield(sc.map));
    const ai = new AiCommander(w, 1, sc.teams[1].ai!, 'normal');
    w.started = true;
    w.flags.startT = 0;
    const raid = w.regs.filter((r) => r.team === 0 && (r.name.startsWith('輕騎') || r.name === '許褚虎衛')).map((r) => r.id);
    const xs = [-150, -90, -30, 30, 90, -60, 60, -120, 0];
    w.regs.filter((r) => r.team === 0 && !raid.includes(r.id) && !r.general).forEach((r, k) => {
      w.commandMove([r.id], xs[k % xs.length], r.ranged ? 45 : 22, Math.PI);
      r.hold = !r.ranged;
    });
    const wu = w.structs.find((s) => s.name === '烏巢')!;
    const step = (sec: number) => {
      for (let k = 0; k < sec * 30; k++) {
        w.step();
        ai.update();
        w.events = [];
      }
    };
    w.commandMove(raid, 285, 70, undefined, undefined, true);
    step(30);
    w.commandMove(raid, 280, -60, undefined, undefined, true);
    step(30);
    w.commandAttackStruct(raid, wu.id);
    const log: string[] = [];
    for (let k = 0; k < 20 && !w.over; k++) {
      step(15);
      log.push(`t=${w.t.toFixed(0)} 烏巢=${wu.burnt ? '焚毀' : wu.fire.toFixed(2)} 袁糧=${w.teams[1].supply} 士氣 曹${w.armyMorale(0).toFixed(0)} 袁${w.armyMorale(1).toFixed(0)} 陣亡 ${w.teams[0].dead}/${w.teams[1].dead}`);
    }
    console.log(log.join('\n'));
  });
});
