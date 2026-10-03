// 敵軍指揮官 AI（docs/04 §4）：戰略層（進攻／防守／劫糧）＋ 戰術層（各軍團依角色行動）
import { GENERALS } from '../data/generals';
import { RULES } from '../data/rules';
import type { TeamSpec } from '../data/scenario';
import type { Regiment } from '../sim/regiment';
import { distToRoute, type World } from '../sim/world';

type Plan = NonNullable<TeamSpec['ai']>;

const REACT = { easy: 3, normal: 1.5, hard: 0.8 };

export class AiCommander {
  private next = 0;
  private react: number;
  /** 騎兵衝鋒循環：交戰開始時間 */
  private engagedSince = new Map<number, number>();
  private pullback = new Map<number, number>();
  /** 斷糧道部隊的目標點 */
  private raidPt = new Map<number, { x: number; z: number; t: number }>();

  constructor(
    private w: World,
    readonly team: number,
    private plan: Plan,
    private diff: 'easy' | 'normal' | 'hard',
  ) {
    this.react = REACT[diff];
  }

  update(): void {
    const w = this.w;
    if (!w.started || w.over) return;
    if (w.t < this.next) return;
    this.next = w.t + this.react * (0.8 + w.rng() * 0.4);
    const mine = w.regs.filter((r) => r.team === this.team && !r.gone && !r.routing && r.name !== '逃兵');
    const enemies = w.regs.filter((r) => r.team !== this.team && !r.gone && r.name !== '逃兵' && w.isVisibleTo(r, this.team));
    const since = w.t - ((w.flags.startT as number) ?? 0);
    const started = since > (this.plan.startDelay ?? 0);
    if (this.plan.attackAfter !== undefined && this.plan.plan !== 'attack' && since > this.plan.attackAfter) {
      this.plan.plan = 'attack';
      for (const r of mine) if (r.ai.role === 'hold') r.ai.role = r.ranged ? 'ranged' : r.unit.mounted ? 'flank' : 'line';
      w.events.push({ k: 'msg', text: `${w.teams[this.team].name}全軍出擊！`, tone: this.team === w.player ? 'good' : 'bad' });
    }
    if (this.diff !== 'easy' && started) this.stratagems(mine, enemies);
    this.defendHq(mine, enemies);
    this.defendLine(mine, enemies);
    const cid = w.sc.teams[this.team].commander;
    for (const r of mine) {
      this.ability(r, enemies);
      // 主帥重傷：撤回本陣保命（主帥撤退或陣亡＝全軍敗退）
      if (cid && r.general?.alive && r.general.id === cid) {
        const gi = r.general.soldier;
        if (w.s.hp[gi] < w.s.maxHp[gi] * 0.55) {
          if (r.order.type !== 'retreat') w.commandRetreat([r.id]);
          continue;
        }
      }
      switch (r.ai.role) {
        case 'guard':
          this.guard(r, enemies);
          break;
        case 'raider':
          if (started && this.plan.raid && this.diff !== 'easy') this.raider(r, enemies);
          else this.defensive(r, enemies, 90);
          break;
        case 'reserve':
          this.reserve(r, enemies);
          break;
        case 'hold':
          this.defensive(r, enemies, 60);
          break;
        default:
          if (!started || this.plan.plan !== 'attack') this.defensive(r, enemies, this.plan.plan === 'hold' ? 60 : 110);
          else if (r.ranged && !r.unit.mounted) this.ranged(r, enemies, mine);
          else if (r.unit.mounted) this.cavalry(r, enemies);
          else this.line(r, enemies, mine);
      }
    }
  }

  private dist(a: Regiment, b: { mx: number; mz: number }): number {
    return Math.hypot(a.mx - b.mx, a.mz - b.mz);
  }

  private nearest(r: Regiment, list: Regiment[], filter?: (e: Regiment) => boolean): Regiment | null {
    let best: Regiment | null = null;
    let bd = Infinity;
    for (const e of list) {
      if (e.routing || (filter && !filter(e))) continue;
      const d = this.dist(r, e);
      // 半渡而擊：涉水中的敵軍等它走到岸邊再打，不下水追（自己下水就換自己吃虧）
      if (this.w.fording(e) && !this.w.fording(r) && !r.ranged && d - e.radius - r.radius > 10) continue;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private busy(r: Regiment): boolean {
    return r.order.type === 'attack' && r.order.target >= 0 && !this.w.regs[r.order.target].gone && !this.w.regs[r.order.target].routing;
  }

  /** 前線步兵：找最近的敵軍（不太遠就打），否則往敵軍重心推進 */
  private line(r: Regiment, enemies: Regiment[], mine: Regiment[]): void {
    const w = this.w;
    if (r.wavering && r.engagedWith.size > 0 && this.diff === 'hard' && r.morale < 25) {
      w.commandRetreat([r.id]);
      return;
    }
    if (this.busy(r)) return;
    const t = this.nearest(r, enemies, (e) => this.dist(r, e) < 150);
    if (t) {
      w.commandAttack([r.id], t.id);
      return;
    }
    const goal = this.enemyCenter(enemies) ?? this.enemyHq();
    if (!goal) return;
    // 保持橫向位置往前推
    const dx = goal[0] - r.mx;
    const dz = goal[1] - r.mz;
    const d = Math.hypot(dx, dz);
    if (d < 10) return;
    const step = Math.min(70, d);
    const tx = r.mx + (dx / d) * step;
    const tz = r.mz + (dz / d) * step;
    // 別離友軍太遠（等一下落後的）
    const avgZ = mine.filter((m) => !m.unit.mounted && m.ai.role === 'line').reduce((a, m) => a + m.mz, 0) / Math.max(1, mine.filter((m) => !m.unit.mounted && m.ai.role === 'line').length);
    if (Math.abs(r.mz - avgZ) > 50 && Math.sign(dz) === Math.sign(r.mz - avgZ) * -1) return;
    if (r.order.type !== 'move' || Math.hypot(r.order.x - tx, r.order.z - tz) > 25) w.commandMove([r.id], tx, tz, Math.atan2(dx, dz));
  }

  /** 遠程：射程內最近敵軍；被近戰逼近就後撤 */
  private ranged(r: Regiment, enemies: Regiment[], mine: Regiment[]): void {
    const w = this.w;
    const range = r.unit.ranged!.range;
    const threat = this.nearest(r, enemies, (e) => !e.ranged && this.dist(r, e) < 35 && (e.order.target === r.id || this.dist(r, e) < 22));
    if (threat && r.engagedWith.size === 0) {
      const away = Math.atan2(r.mx - threat.mx, r.mz - threat.mz);
      w.commandMove([r.id], r.mx + Math.sin(away) * 45, r.mz + Math.cos(away) * 45, away + Math.PI, undefined, true);
      return;
    }
    const t = this.nearest(r, enemies, (e) => this.dist(r, e) < range * 1.05);
    if (t) {
      if (r.order.target !== t.id) w.commandAttack([r.id], t.id);
      return;
    }
    // 跟在前線後方
    const front = this.nearest(r, mine, (m) => m.ai.role === 'line' && !m.unit.mounted);
    const goal = this.enemyCenter(enemies);
    if (front && goal) {
      const dx = goal[0] - front.mx;
      const dz = goal[1] - front.mz;
      const d = Math.hypot(dx, dz) || 1;
      const tx = front.mx - (dx / d) * 28;
      const tz = front.mz - (dz / d) * 28;
      if (Math.hypot(tx - r.mx, tz - r.mz) > 20) w.commandMove([r.id], tx, tz, Math.atan2(dx, dz));
    }
  }

  /** 騎兵：打弓兵、側擊交戰中的敵軍、追潰兵；避開堅守的槍兵；衝鋒後拉開再衝 */
  private cavalry(r: Regiment, enemies: Regiment[]): void {
    const w = this.w;
    // 衝鋒循環
    if (r.engagedWith.size > 0) {
      const since = this.engagedSince.get(r.id) ?? w.t;
      this.engagedSince.set(r.id, since);
      if (w.t - since > (this.diff === 'easy' ? 30 : 12) && r.unit.charge > 10) {
        const hx = r.ai.homeX;
        const hz = r.ai.homeZ;
        const dx = hx - r.mx;
        const dz = hz - r.mz;
        const d = Math.hypot(dx, dz) || 1;
        w.commandMove([r.id], r.mx + (dx / d) * 60, r.mz + (dz / d) * 60, undefined, undefined, true);
        this.pullback.set(r.id, w.t + 7);
        this.engagedSince.delete(r.id);
      }
      return;
    }
    this.engagedSince.delete(r.id);
    if ((this.pullback.get(r.id) ?? 0) > w.t) return;
    if (this.busy(r) && w.regs[r.order.target].engagedWith.size > 0) return;
    let best: Regiment | null = null;
    let bs = -Infinity;
    for (const e of enemies) {
      const d = this.dist(r, e);
      if (d > 320) continue;
      let score = -d * 0.4;
      if (e.ranged) score += 70;
      if (e.engagedWith.size > 0) score += 55;
      if (e.type === 'spear') score -= e.hold ? 120 : 45;
      if (e.unit.mounted) score -= 15;
      if (score > bs) {
        bs = score;
        best = e;
      }
    }
    if (best) {
      if (r.order.target !== best.id) w.commandAttack([r.id], best.id, true);
    } else this.defensive(r, enemies, 120);
  }

  /** 斷糧道：繞到敵軍糧道上遠離敵軍的位置站住，切斷補給；沒人守的糧倉就直接燒 */
  private raider(r: Regiment, enemies: Regiment[]): void {
    const w = this.w;
    if (r.engagedWith.size > 0) return;
    const foe = w.teams[1 - this.team];
    const sources = w.supplySources(foe).filter((s) => !s.burnt && s.team === s.owner && s.route.length > 1);
    if (!sources.length) {
      r.ai.role = 'flank';
      return;
    }
    // 被大軍攔截：撤回
    const block = this.nearest(r, enemies, (e) => this.dist(r, e) < 40 && !e.ranged);
    if (block && block.alive > r.alive * 1.5) {
      this.raidPt.delete(r.id);
      w.commandMove([r.id], r.ai.homeX, r.ai.homeZ, undefined, undefined, true);
      return;
    }
    // 糧倉沒人守：直接縱火
    const depot = sources.find((s) => s.kind === 'depot' && Math.hypot(s.x - r.mx, s.z - r.mz) < 160 && !enemies.some((e) => Math.hypot(e.mx - s.x, e.mz - s.z) < 60));
    if (depot) {
      if (r.order.struct !== depot.id) w.commandAttackStruct([r.id], depot.id);
      return;
    }
    // 挑糧道上離敵軍最遠、離自己不太遠的點
    let pt = this.raidPt.get(r.id);
    const threatened = pt && enemies.some((e) => Math.hypot(e.mx - pt!.x, e.mz - pt!.z) < 50);
    if (!pt || threatened || w.t - pt.t > 40) {
      let best = -Infinity;
      for (const st of sources) {
        for (let k = 0; k < st.route.length; k += 4) {
          const [x, z] = st.route[k];
          let near = 220;
          for (const e of enemies) near = Math.min(near, Math.hypot(e.mx - x, e.mz - z));
          const score = near - Math.hypot(x - r.mx, z - r.mz) * 0.35;
          if (score > best) {
            best = score;
            pt = { x, z, t: w.t };
          }
        }
      }
      if (pt) this.raidPt.set(r.id, pt);
    }
    if (!pt) return;
    const d = Math.hypot(pt.x - r.mx, pt.z - r.mz);
    if (d > 14) {
      if (r.order.type !== 'move' || Math.hypot(r.order.x - pt.x, r.order.z - pt.z) > 10) w.commandMove([r.id], pt.x, pt.z, undefined, undefined, true);
    } else if (r.order.type === 'move') w.commandHalt([r.id]);
  }

  /** 糧道被敵軍佔住：派最近的空閒部隊去趕走 */
  private defendLine(mine: Regiment[], enemies: Regiment[]): void {
    const w = this.w;
    for (const st of w.supplySources(w.teams[this.team])) {
      if (st.burnt || st.route.length < 2 || (st.cutT <= 0 && !st.cut)) continue;
      const t = enemies.find((e) => distToRoute(st.route, e.mx, e.mz)[0] < RULES.lineCutRadius + e.radius);
      if (!t) continue;
      const free = mine
        .filter((r) => r.engagedWith.size === 0 && !r.ranged && r.ai.role !== 'raider' && r.order.target !== t.id)
        .sort((a, b) => (b.unit.mounted ? 1 : 0) - (a.unit.mounted ? 1 : 0) || this.dist(a, t) - this.dist(b, t))
        .slice(0, t.alive > 80 ? 2 : 1);
      if (mine.some((r) => r.order.target === t.id)) continue;
      for (const r of free) w.commandAttack([r.id], t.id, true);
    }
  }

  /** 守倉：敵軍靠近就出擊，追太遠就回來 */
  private guard(r: Regiment, enemies: Regiment[]): void {
    const w = this.w;
    const home = { mx: r.ai.homeX, mz: r.ai.homeZ };
    const far = this.dist(r, home) > 120;
    const t = this.nearest(r, enemies, (e) => Math.hypot(e.mx - home.mx, e.mz - home.mz) < 110);
    if (t && !far) {
      if (r.order.target !== t.id) w.commandAttack([r.id], t.id);
    } else if (far || (!t && this.dist(r, home) > 25 && r.order.type !== 'move')) {
      w.commandMove([r.id], home.mx, home.mz);
    }
  }

  /** 預備隊（含主帥）：守本陣附近，敵軍逼近才出擊 */
  private reserve(r: Regiment, enemies: Regiment[]): void {
    const hq = this.w.teams[this.team].hq;
    const base = hq ? { mx: hq.x, mz: hq.z + (this.team === 0 ? -40 : 40) } : { mx: r.ai.homeX, mz: r.ai.homeZ };
    const t = this.nearest(r, enemies, (e) => Math.hypot(e.mx - base.mx, e.mz - base.mz) < 160);
    if (t) {
      if (r.order.target !== t.id) this.w.commandAttack([r.id], t.id);
    } else if (this.dist(r, base) > 40 && r.order.type !== 'move') this.w.commandMove([r.id], base.mx, base.mz);
  }

  /** 防守：原地待命，敵軍進入半徑才迎擊 */
  private defensive(r: Regiment, enemies: Regiment[], radius: number): void {
    if (this.busy(r)) return;
    const t = this.nearest(r, enemies, (e) => this.dist(r, e) < radius + (r.ranged ? r.unit.ranged!.range * 0.5 : 0));
    if (t) this.w.commandAttack([r.id], t.id);
    else if (this.dist(r, { mx: r.ai.homeX, mz: r.ai.homeZ }) > 60 && r.order.type === 'idle') this.w.commandMove([r.id], r.ai.homeX, r.ai.homeZ);
  }

  private ability(r: Regiment, enemies: Regiment[]): void {
    const w = this.w;
    if (!r.general?.alive || r.general.cd > w.t) return;
    const ab = GENERALS[r.general.id].ability;
    if (!ab) return;
    const near = (rad: number) => enemies.filter((e) => this.dist(r, e) < rad).length;
    let use = false;
    switch (ab) {
      case 'rally':
        use = w.regs.some((o) => o.team === this.team && !o.gone && (o.state === 'routing' || o.morale < 30) && this.dist(r, o) < 120);
        break;
      case 'terror':
      case 'peerless':
      case 'roar':
      case 'cleave':
        use = near(35) > 0;
        break;
      case 'berserk':
      case 'fury':
      case 'unstoppable':
      case 'steady':
      case 'fortify':
        use = r.engagedWith.size > 0 || near(40) > 1;
        break;
      case 'swift':
      case 'raid':
        use = r.state === 'moving' && r.order.type === 'attack';
        break;
      case 'firestorm': {
        const t = this.nearest(r, enemies, (e) => this.dist(r, e) < 160);
        if (t) {
          w.useAbility(r.id, t.mx, t.mz);
          return;
        }
        break;
      }
    }
    if (use) w.useAbility(r.id);
  }

  /** 敵軍逼近本陣 90 m 內：派最近的兩團（未交戰）回防 */
  private defendHq(mine: Regiment[], enemies: Regiment[]): void {
    const hq = this.w.teams[this.team].hq;
    if (!hq || hq.burnt) return;
    const threats = enemies.filter((e) => !e.routing && Math.hypot(e.mx - hq.x, e.mz - hq.z) < 90);
    if (!threats.length) return;
    const t = threats[0];
    const free = mine
      .filter((r) => r.engagedWith.size === 0 && !r.ranged && r.order.target !== t.id)
      .sort((a, b) => Math.hypot(a.mx - hq.x, a.mz - hq.z) - Math.hypot(b.mx - hq.x, b.mz - hq.z))
      .slice(0, threats.length > 1 ? 3 : 2);
    for (const r of free) if (Math.hypot(r.mx - hq.x, r.mz - hq.z) < 260) this.w.commandAttack([r.id], t.id, true);
  }

  private stratT = 0;
  /** 計策：擂鼓穩住動搖的戰線、火矢打密集敵陣或燒敵營 */
  private stratagems(mine: Regiment[], enemies: Regiment[]): void {
    const w = this.w;
    if (w.t < this.stratT) return;
    this.stratT = w.t + (this.diff === 'hard' ? 6 : 12);
    const cmd = w.teams[this.team].command;
    // 擂鼓：交戰中且動搖的己方軍團
    const shaky = mine.find((r) => r.engagedWith.size > 0 && r.morale < 45);
    if (shaky && cmd >= 3) {
      w.useStratagem(this.team, 'drums', shaky.mx, shaky.mz);
      return;
    }
    // 火矢：敵方營寨（有糧的）或正在跟我軍肉搏以外的密集敵陣
    if (cmd >= 4 && w.sc.weather !== 'rain') {
      const since = w.t - ((w.flags.startT as number) ?? 0);
      const st = since < 90 ? undefined : w.structs.find((s) => s.team !== this.team && !s.burnt && s.kind !== 'water' && s.kind !== 'hq' && s.fire === 0 && mine.some((r) => Math.hypot(r.mx - s.x, r.mz - s.z) < 130));
      if (st) {
        w.useStratagem(this.team, 'firearrows', st.x, st.z);
        return;
      }
      // 射敵陣時，火箭雨範圍不能波及敵方建築（開戰前 90 秒不燒營、本陣永遠不直接燒）
      const nearStruct = (e: Regiment) => w.structs.some((s) => s.team !== this.team && !s.burnt && s.kind !== 'water' && (since < 90 || s.kind === 'hq') && Math.hypot(s.x - e.mx, s.z - e.mz) < 25 + s.radius + 5);
      const tgt = enemies.find((e) => !e.routing && e.engagedWith.size === 0 && e.alive > 60 && !nearStruct(e) && mine.some((r) => Math.hypot(r.mx - e.mx, r.mz - e.mz) < 140));
      if (tgt && cmd >= 6) w.useStratagem(this.team, 'firearrows', tgt.mx, tgt.mz);
    }
  }

  private enemyCenter(enemies: Regiment[]): [number, number] | null {
    const live = enemies.filter((e) => !e.routing);
    if (!live.length) return null;
    let x = 0;
    let z = 0;
    let n = 0;
    for (const e of live) {
      x += e.mx * e.alive;
      z += e.mz * e.alive;
      n += e.alive;
    }
    return [x / n, z / n];
  }

  private enemyHq(): [number, number] | null {
    const hq = this.w.teams[1 - this.team].hq;
    return hq ? [hq.x, hq.z] : null;
  }
}
