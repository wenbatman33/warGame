// 平衡測試（BALANCE=1 npx vitest run tests/balance.test.ts）：量測各種對戰的消耗速度與傷亡（沒有潰逃）
import { describe, it } from 'vitest';
import type { RegimentSpec, Scenario } from '../src/data/scenario';
import { generateHeightfield } from '../src/map/mapgen';
import { World } from '../src/sim/world';
import { AiCommander } from '../src/ai/commander';
import { GUANDU } from '../src/data/scenarios/guandu';
import { CAMPAIGN } from '../src/data/scenarios/index';
import { PlayerTactics } from '../src/game/tactics';

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
  let contact = -1;
  let at60 = '';
  for (let k = 0; k < maxT * 30 && !w.over; k++) {
    w.step();
    w.events = [];
    if (contact < 0 && w.regs.some((r) => r.engagedWith.size > 0)) contact = w.t;
    if (contact >= 0 && !at60 && w.t - contact >= 60) at60 = `接戰 60 秒：甲 −${pct(w, 0)}% 乙 −${pct(w, 1)}%`;
  }
  console.log(`${name}: 接戰 ${contact.toFixed(0)}s 結束 ${w.t.toFixed(0)}s 勝方 ${w.winner}｜${at60}｜最終 甲 −${pct(w, 0)}% 乙 −${pct(w, 1)}%`);
}

function pct(w: World, t: number): string {
  return ((w.teams[t].dead / w.teams[t].initialStrength) * 100).toFixed(0);
}

describe.runIf(RUN)('平衡', () => {
  it('刀盾 vs 刀盾（同兵力）', () => {
    fight('刀盾對刀盾', [{ type: 'sword', x: 0, z: 30 }], [{ type: 'sword', x: 0, z: -30 }], (w) => w.commandAttack([0], 1));
  });
  it('刀盾 vs 長槍', () => {
    fight('刀盾對長槍', [{ type: 'sword', x: 0, z: 30 }], [{ type: 'spear', x: 0, z: -30 }], (w) => w.commandAttack([0], 1));
  });
  it('騎兵正面衝 長槍（堅守）', () => {
    fight('騎兵衝堅守長槍', [{ type: 'cav', x: 0, z: 120 }], [{ type: 'spear', x: 0, z: -10, hold: true }], (w) => w.commandAttack([0], 1));
  });
  it('騎兵正面衝 刀盾', () => {
    fight('騎兵正面衝刀盾', [{ type: 'cav', x: 0, z: 120 }], [{ type: 'sword', x: 0, z: -10 }], (w) => w.commandAttack([0], 1));
  });
  it('刀盾交戰中，騎兵背襲', () => {
    fight(
      '夾擊',
      [
        { type: 'sword', x: 0, z: 25 },
        { type: 'cav', x: 0, z: -150, facing: 180 },
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
  it('兵種相剋：長槍 vs 騎兵', () => {
    fight('長槍對騎兵', [{ type: 'spear', x: 0, z: 30, count: 60 }], [{ type: 'cav', x: 0, z: -30 }], (w) => w.commandAttack([1], 0), 180);
  });
  it('兵種相剋：騎兵 vs 弓兵（近身）', () => {
    fight('騎兵對弓兵', [{ type: 'cav', x: 0, z: 30 }], [{ type: 'archer', x: 0, z: -30, count: 60 }], (w) => w.commandAttack([0], 1), 180);
  });
  it('側擊：刀盾＋刀盾側翼 vs 刀盾', () => {
    fight(
      '側擊',
      [
        { type: 'sword', x: 0, z: 25 },
        { type: 'sword', x: 80, z: -25, facing: 270 },
      ],
      [{ type: 'sword', x: 0, z: -25 }],
      (w) => {
        w.commandAttack([0], 2);
        w.commandAttack([1], 2);
      },
    );
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
  it('官渡：守河岸＋騎兵燒烏巢', () => {
    const sc = { ...GUANDU, teams: GUANDU.teams.map((t) => ({ ...t, ai: t.ai ? { ...t.ai } : undefined })) as Scenario['teams'] };
    const w = new World(sc, generateHeightfield(sc.map));
    w.setDifficulty('normal');
    const ai = new AiCommander(w, 1, sc.teams[1].ai!, 'normal');
    // 前線：玩家的戰線指令「固守」；奇兵：照劇本燒烏巢
    const tac = new PlayerTactics(w, 0);
    w.started = true;
    w.flags.startT = 0;
    const raid = w.regs.filter((r) => r.team === 0 && (r.name.startsWith('輕騎') || r.name === '許褚虎衛')).map((r) => r.id);
    const wu = w.structs.find((s) => s.name === '烏巢')!;
    for (const id of raid) {
      w.regs[id].ai.role = 'hold';
      w.regs[id].ai.homeX = wu.x;
      w.regs[id].ai.homeZ = wu.z;
    }
    // 防線貼著南岸水邊（中央淺灘的水邊約在 z≈−5～0）
    const spots: Record<string, [number, number]> = { 青州兵: [-14, 6], 中軍刀盾: [22, 2], 長槍營: [-50, 10], 右翼長槍: [58, -2], 弓手營: [-20, 30], 強弓營: [24, 28], 弩營: [2, 44], 虎豹騎: [-110, 60] };
    for (const r of w.regs.filter((x) => x.team === 0 && !raid.includes(x.id) && !x.general)) {
      const p = spots[r.name];
      if (!p) continue;
      w.commandMove([r.id], p[0], p[1], Math.PI);
    }
    let held = false;
    const step = (sec: number) => {
      for (let k = 0; k < sec * 30 && !w.over; k++) {
        w.step();
        ai.update();
        tac.update();
        // 就位後全線固守
        if (!held && w.t > 25) {
          held = true;
          tac.setStance(w.regs.filter((x) => x.team === 0 && !raid.includes(x.id) && !x.general && !x.gone).map((x) => x.id), 'hold');
        }
        w.events = [];
      }
    };
    w.commandMove(raid, 285, 70, undefined, undefined, true);
    step(30);
    w.commandMove(raid, 280, -60, undefined, undefined, true);
    step(30);
    const log: string[] = [];
    for (let k = 0; k < 40 && !w.over; k++) {
      // 奇兵附近沒有敵軍就去縱火
      const near = w.regs.some((e) => e.team === 1 && !e.gone && raid.some((id) => Math.hypot(e.mx - w.regs[id].mx, e.mz - w.regs[id].mz) < 35));
      if (!wu.burnt && !near) w.commandAttackStruct(raid, wu.id);
      step(15);
      const rs = raid.map((id) => w.regs[id]).map((r) => `${r.name.slice(0, 2)}${r.alive}`).join(' ');
      const guard = w.regs.filter((r) => r.team === 1 && r.ai.role === 'guard').map((r) => `${r.name.slice(0, 3)}${r.alive}`).join(' ');
      log.push(`t=${w.t.toFixed(0)} 奇兵[${rs}] 守軍[${guard}] 烏巢=${wu.burnt ? '焚毀' : `火${wu.fire.toFixed(2)}點${wu.ignite.toFixed(2)}`} 袁糧=${w.teams[1].supply} 存糧${((w.teams[1].hq?.frac ?? 0) * 100).toFixed(0)}% 士氣 曹${w.armyMorale(0).toFixed(0)} 袁${w.armyMorale(1).toFixed(0)} 傷亡 曹${pct(w, 0)}% 袁${pct(w, 1)}%${w.over ? ` 結束 勝=${w.winner}` : ''}`);
    }
    console.log(log.join('\n'));
  });
  for (const e of CAMPAIGN) {
    it(`AI 對 AI：${e.name}`, () => {
      const sc = { ...e.scenario!, teams: e.scenario!.teams.map((t) => ({ ...t, ai: t.ai ? { ...t.ai } : undefined })) as Scenario['teams'] };
      const w = new World(sc, generateHeightfield(sc.map));
      const ais = [new AiCommander(w, 0, { plan: 'attack', raid: true, startDelay: 0 }, 'normal'), new AiCommander(w, 1, sc.teams[1].ai ?? { plan: 'attack' }, 'normal')];
      w.started = true;
      w.flags.startT = 0;
      sc.onStart?.(w);
      for (let k = 0; k < 30 * 600 && !w.over; k++) {
        w.step();
        for (const a of ais) a.update();
        w.events = [];
      }
      const burnt = w.structs.filter((s) => s.burnt).map((s) => s.name).join(',');
      console.log(`${e.name}: t=${w.t.toFixed(0)} 勝方=${w.winner} 陣亡 ${w.teams[0].dead}/${w.teams[0].initialStrength} 對 ${w.teams[1].dead}/${w.teams[1].initialStrength} 士氣 ${w.armyMorale(0).toFixed(0)}/${w.armyMorale(1).toFixed(0)} 焚毀[${burnt}] 糧況 ${w.teams[0].supply}/${w.teams[1].supply}`);
    });
  }
});
