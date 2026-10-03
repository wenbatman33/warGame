// 地點地圖玩法：博望坡「照史實」打得贏、正面硬拚打不贏
import { describe, expect, it } from 'vitest';
import { generateHeightfield } from '../src/map/mapgen';
import { World, TICK } from '../src/sim/world';
import { NodeGame } from '../src/node/game';
import { BOWANG } from '../src/data/scenarios/bowang';

function setup() {
  const w = new World(BOWANG, generateHeightfield(BOWANG.map));
  w.presentation = true;
  w.speedMul = 1.6;
  const g = new NodeGame(w, BOWANG.nodes!);
  w.ext.nodeGame = g;
  w.started = true;
  w.flags.startT = 0;
  return { w, g };
}
function run(w: World, g: NodeGame, sec: number, each?: () => void) {
  for (let k = 0; k < sec / TICK && !w.over; k++) {
    w.step();
    g.update(TICK);
    each?.();
    w.events = [];
  }
}

describe('博望坡（地點地圖）', () => {
  it('照史實：伏兵、誘敵、火攻 → 擊退夏侯惇', () => {
    const { w, g } = setup();
    const u = (id: string) => g.unit(id)!;
    g.orderMove(u('gy'), 'lwood');
    g.orderMove(u('zf'), 'rwood');
    g.orderLure(u('zy'), u('xhd'), 'south');
    let fired = false;
    let struck = false;
    const log: string[] = [];
    run(w, g, 300, () => {
      const at = (n: string) => g.units.filter((x) => x.team === 1 && g.alive(x) && x.mode !== 'retreat' && g.nodeOf(x) === n);
      if (!fired && at('valley').length >= 2 && g.cmd[0] >= 2) {
        fired = !g.useCard(0, 'fire', 'valley');
        log.push(`火攻@${w.t.toFixed(0)} 谷中${at('valley').map((x) => x.name).join(',')}`);
      }
      // 伏兵藏好後，殺向谷中或南谷口的敵軍
      const ready = u('gy').hidden && u('zf').hidden;
      const pick = [...at('valley'), ...at('south')].sort((a, b) => (b.commander ? 1e5 : 0) + b.troops - ((a.commander ? 1e5 : 0) + a.troops));
      const tgt = pick[0];
      if (!struck && ready && tgt) {
        g.orderAttack(u('gy'), tgt);
        g.orderAttack(u('zf'), tgt);
        struck = true;
        log.push(`伏兵殺出@${w.t.toFixed(0)} → ${tgt.name}`);
      }
      // 之後持續追打最近的敵軍
      if (struck && w.tick % 60 === 0) {
        for (const id of ['gy', 'zf', 'lb']) {
          const me = u(id);
          if (me.mode === 'idle' && g.alive(me)) {
            const foe = g.units.filter((x) => x.team === 1 && g.alive(x) && x.mode !== 'retreat' && g.visibleTo(x, 0)).sort((a, b) => g.hops(g.nodeOf(me) ?? me.at, g.nodeOf(a) ?? a.at) - g.hops(g.nodeOf(me) ?? me.at, g.nodeOf(b) ?? b.at))[0];
            if (foe && g.hops(g.nodeOf(me) ?? me.at, g.nodeOf(foe) ?? foe.at) <= 1) g.orderAttack(me, foe);
          }
        }
      }
      if (w.tick % 300 === 0) log.push(`t=${w.t.toFixed(0)} ` + g.units.map((x) => `${x.name}:${Math.round(x.troops)}/${Math.round(x.morale)}${x.hidden ? '伏' : ''}@${g.nodeOf(x) ?? '路'}(${x.mode})`).join(' '));
    });
    console.log(log.join('\n'), `\n結束 t=${w.t.toFixed(0)} 勝=${w.winner} 伏擊=${w.flags.ambushes} 誘敵=${w.flags.lured}`);
    expect(w.winner).toBe(0);
  }, 120000);

  it('照作戰步驟（小朋友玩法）：誘回博望坡 → 敵軍慌亂 → 放火＋伏兵殺出 → 勝', () => {
    const { w, g } = setup();
    const u = (id: string) => g.unit(id)!;
    g.orderMove(u('gy'), 'lwood');
    g.orderMove(u('zf'), 'rwood');
    let lured = false;
    let fired = false;
    let struck = false;
    const log: string[] = [];
    run(w, g, 300, () => {
      // 步驟 2：兩路伏兵都埋伏好了才誘敵（滑過敵群任一支 → 自動挑最容易上鉤的）
      if (!lured && u('gy').hidden && u('zf').hidden) lured = g.orderLure(u('zy'), u('bb'), 'valley');
      const dazed = g.units.filter((x) => x.team === 1 && g.alive(x) && x.dazedUntil > w.t && g.nodeOf(x) === 'valley');
      if (!fired && dazed.length && g.cmd[0] >= 2) {
        fired = !g.useCard(0, 'fire', 'valley');
        log.push(`火攻@${w.t.toFixed(0)}`);
      }
      if (fired && !struck && dazed.length) {
        const tgt = dazed.find((x) => x.commander) ?? dazed[0];
        g.orderAttack(u('gy'), tgt);
        g.orderAttack(u('zf'), tgt);
        struck = true;
        log.push(`伏兵殺出@${w.t.toFixed(0)} → ${tgt.name}`);
      }
      if (w.tick % 300 === 0) log.push(`t=${w.t.toFixed(0)} ` + g.units.map((x) => `${x.name}:${Math.round(x.troops)}@${g.nodeOf(x) ?? '路'}(${x.mode})`).join(' '));
    });
    console.log(log.join('\n'), `\n結束 t=${w.t.toFixed(0)} 勝=${w.winner} 伏擊=${w.flags.ambushes}`);
    expect(w.flags.lured).toBe(true);
    expect(w.winner).toBe(0);
    // 照步驟打＝漂亮的勝利：一分半內、幾乎無損
    expect(w.t).toBeLessThan(90);
    expect(w.teams[0].dead).toBeLessThan(w.teams[0].initialStrength * 0.3);
  }, 120000);

  it('放火太晚、之後不管：主帥被圍也至少撐 20 秒（有時間反應）', () => {
    const { w, g } = setup();
    const u = (id: string) => g.unit(id)!;
    g.orderMove(u('gy'), 'lwood');
    g.orderMove(u('zf'), 'rwood');
    g.orderLure(u('zy'), u('xhd'), 'south');
    run(w, g, 44);
    g.useCard(0, 'fire', 'valley');
    g.orderAttack(u('gy'), u('xhd'));
    g.orderAttack(u('zf'), u('xhd'));
    let hitT = -1;
    run(w, g, 120, () => {
      if (hitT < 0 && u('zgl').foes.length) hitT = w.t;
    });
    console.log(`放火太晚：t=${w.t.toFixed(0)} 勝=${w.winner} 主帥被圍@${hitT.toFixed(0)}`, g.units.map((x) => `${x.name}:${Math.round(x.troops)}@${g.nodeOf(x) ?? '路'}(${x.mode})`).join(' '));
    if (w.winner === 1 && hitT >= 0) expect(w.t - hitT).toBeGreaterThan(20);
  }, 120000);

  it('正面硬拚：全軍直接進攻夏侯惇 → 打不贏', () => {
    const { w, g } = setup();
    for (const x of g.units.filter((x) => x.team === 0 && !x.commander)) g.orderAttack(x, g.unit('xhd')!);
    run(w, g, 240);
    console.log(`硬拚：t=${w.t.toFixed(0)} 勝=${w.winner}`, g.units.map((x) => `${x.name}:${Math.round(x.troops)}`).join(' '));
    expect(w.winner).not.toBe(0);
  }, 120000);

  it('進攻預估：夏侯惇 3000 騎兵對趙雲 1000 騎兵＝勝算高', () => {
    const { g } = setup();
    expect(g.preview(g.unit('xhd')!, g.unit('zy')!).chance).not.toBe('低');
    expect(g.preview(g.unit('zy')!, g.unit('xhd')!).chance).toBe('低');
  });
});
