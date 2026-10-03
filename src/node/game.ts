// 地點地圖玩法的規則核心：部隊沿道路在地點間行軍，交戰依公開公式結算，3D 戰場負責演出
// 伏擊（森林埋伏）、誘敵（依敵將性格上鉤）、火攻（草木地點）、糧道（沿道路連回糧倉）、敵將性格 AI
import { GENERALS } from '../data/generals';
import type { RegimentSpec } from '../data/scenario';
import type { Regiment } from '../sim/regiment';
import type { World } from '../sim/world';
import { CARD_INFO, type CardId, type MapNode, type NodeScenario, type NodeUnitSpec, type Trait } from './types';

/** 部隊在地點範圍內（公尺） */
export const NODE_R = 32;
/** 交戰損兵速率：每秒損失「敵方有效兵力」的 2.2% */
const RATE = 0.022;
/** 每損失 1% 兵力的士氣下降 */
const MORALE_PER_PCT = 1.2;
/** 主帥：兵力低於此比例、或士氣崩潰（低於 BREAK_MORALE）→ 敗走＝全軍敗退 */
const COMMANDER_BREAK = 0.4;
/** 全軍剩下的兵力低於開戰時的此比例 → 全軍潰敗 */
const ARMY_COLLAPSE = 0.35;
/** 士氣低於此值、或兵力低於此比例 → 敗退 */
const BREAK_MORALE = 20;
const BREAK_TROOPS = 0.25;
/** 兵力低於此比例 → 潰散（離開戰場） */
const ROUT_TROOPS = 0.12;
const COUNTER = 1.5;
/** 正面寬度：一支部隊同時最多被「自身兵力 × 2.5」的敵軍有效打到（人多也擠不上去，防守方不會被瞬間圍殲） */
const FRONTAGE = 2.5;
const frontCap = (troops: number) => Math.max(troops, 500) * FRONTAGE;
const LURE_CHANCE: Record<Trait, number> = { rash: 1, normal: 0.6, cautious: 0.2 };
export const TRAIT_NAME: Record<Trait, string> = { rash: '輕敵', normal: '普通', cautious: '謹慎' };

type Mode = 'idle' | 'move' | 'attack' | 'lure' | 'chase' | 'retreat' | 'gone';

export interface NUnit extends NodeUnitSpec {
  maxTroops: number;
  morale: number;
  regId: number;
  mode: Mode;
  path: string[];
  /** 最後停留／目前所在的地點 */
  at: string;
  target: string | null;
  lureTo: string | null;
  lureStage: 'go' | 'back';
  lureT: number;
  chaseUntil: number;
  /** 追擊的終點（誘敵的陷阱點）：追到就停下中計 */
  chaseTo: string | null;
  hidden: boolean;
  idleT: number;
  ambushUntil: number;
  ambushedUntil: number;
  drumsUntil: number;
  burnT: number;
  cutT: number;
  cut: boolean;
  safeUntil: number;
  /** 正在交戰的敵軍 */
  foes: string[];
  /** 已陣亡（以 10 人為單位同步 3D 士兵）的累積誤差 */
  fracLoss: number;
  /** 敵軍 AI 的目的地（畫意圖箭頭） */
  intent: string | null;
  aiT: number;
  /** 從埋伏中殺出的時限（之後沒接戰就現形，45 秒） */
  ambushWindow: number;
  /** 目標跑遠的累積秒數（追不上就放棄） */
  farT: number;
  /** 行軍卡住偵測 */
  stuckT: number;
  lastD: number;
  /** 卡住偵測對應的目標點（換目標就重新計） */
  lastGoal: string;
  /** 中計慌亂（追進陷阱後愣住）到此時間 */
  dazedUntil: number;
  /** 我軍自動救援的檢查計時 */
  guardT: number;
}

export interface Preview {
  win: boolean;
  chance: '高' | '中' | '低';
  myLoss: number;
  foeLoss: number;
  factors: string[];
}

/** 從單位規格產生 3D 軍團（每 10 人一名士兵） */
export function nodeRegiments(sc: NodeScenario, team: number): RegimentSpec[] {
  const byNode = new Map<string, number>();
  return sc.units
    .filter((u) => u.team === team)
    .map((u) => {
      const n = sc.nodes.find((x) => x.id === u.node)!;
      const k = byNode.get(u.node) ?? 0;
      byNode.set(u.node, k + 1);
      const total = sc.units.filter((o) => o.team === team && o.node === u.node).length;
      const [ox, oz] = slotOffset(k, total);
      return { type: u.type, x: n.x + ox, z: n.z + oz, count: Math.round(u.troops / 10), general: u.general, name: u.name, facing: team === 0 ? 180 : 0, morale: u.morale };
    });
}

/** 同一地點多支部隊的站位（左右拉開，名牌才不會疊在一起） */
function slotOffset(k: number, total: number): [number, number] {
  if (total <= 1) return [0, 0];
  if (total === 2) return [k === 0 ? -20 : 20, 0];
  if (total === 3) return ([[-22, 6], [22, 6], [0, -18]] as [number, number][])[k];
  const a = (k / total) * Math.PI * 2 + Math.PI;
  return [Math.cos(a) * 24, Math.sin(a) * 20];
}

export class NodeGame {
  readonly nodes = new Map<string, MapNode>();
  readonly adj = new Map<string, { to: string; len: number }[]>();
  readonly units: NUnit[] = [];
  /** 各隊軍令點 */
  readonly cmd = [0, 0];
  /** 燃燒中的地點 → 熄滅時間、放火的一方（火只燒敵方） */
  readonly burning = new Map<string, number>();
  readonly burnTeam = new Map<string, number>();
  /** 偵察揭露 → 到期時間 */
  revealUntil = new Map<string, number>();
  private acc = 0;
  private capT = [0, 0];
  private byReg = new Map<number, NUnit>();
  over = false;

  constructor(
    readonly w: World,
    readonly sc: NodeScenario,
  ) {
    for (const n of sc.nodes) {
      this.nodes.set(n.id, n);
      this.adj.set(n.id, []);
    }
    for (const [a, b] of sc.edges) {
      const na = this.nodes.get(a)!;
      const nb = this.nodes.get(b)!;
      const len = Math.hypot(na.x - nb.x, na.z - nb.z);
      this.adj.get(a)!.push({ to: b, len });
      this.adj.get(b)!.push({ to: a, len });
    }
    // 單位 ↔ 3D 軍團：劇本依隊伍順序產生，世界也依隊伍順序生成
    let regIdx = 0;
    for (const team of [0, 1]) {
      for (const spec of sc.units.filter((u) => u.team === team)) {
        const reg = w.regs[regIdx++];
        const u: NUnit = {
          ...spec,
          maxTroops: spec.troops,
          morale: spec.morale ?? (spec.general ? 80 : 70),
          regId: reg.id,
          mode: 'idle',
          path: [],
          at: spec.node,
          target: null,
          lureTo: null,
          lureStage: 'go',
          lureT: 0,
          chaseUntil: 0,
          chaseTo: null,
          hidden: false,
          idleT: 0,
          ambushUntil: -99,
          ambushedUntil: -99,
          drumsUntil: -99,
          burnT: -99,
          cutT: 0,
          cut: false,
          safeUntil: 0,
          foes: [],
          fracLoss: 0,
          intent: null,
          aiT: 0,
          ambushWindow: 0,
          farT: 0,
          stuckT: 0,
          lastD: Infinity,
          lastGoal: '',
          dazedUntil: 0,
          guardT: 0,
        };
        this.units.push(u);
        this.byReg.set(reg.id, u);
      }
    }
    this.cmd[0] = this.cmd[1] = sc.startCommand ?? 2;
    // 3D 士兵只跟規則核心判定「正在交戰」的敵軍打（撤退、安全時間內的部隊不會被黏住）
    w.canFight = (a, b) => {
      const ua = this.byReg.get(a);
      const ub = this.byReg.get(b);
      return !ua || !ub || ua.foes.includes(ub.id);
    };
  }

  // ───────────────────────── 查詢 ─────────────────────────

  reg(u: NUnit): Regiment {
    return this.w.regs[u.regId];
  }

  unit(id: string): NUnit | undefined {
    return this.units.find((u) => u.id === id);
  }

  unitOfReg(regId: number): NUnit | undefined {
    return this.byReg.get(regId);
  }

  alive(u: NUnit): boolean {
    return u.mode !== 'gone' && this.reg(u).alive > 0;
  }

  /** 部隊目前所在的地點（不在任何地點範圍內＝在路上，回傳 null） */
  nodeOf(u: NUnit): string | null {
    const r = this.reg(u);
    let best: string | null = null;
    let bd = NODE_R;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - r.mx, n.z - r.mz);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  /** 最近的地點（尋路起點） */
  nearestNode(x: number, z: number): string {
    let best = '';
    let bd = Infinity;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  }

  /** 最短路（Dijkstra）；avoid＝不能經過的地點 */
  path(from: string, to: string, avoid?: (id: string) => boolean): string[] {
    if (from === to) return [];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const open = new Set([from]);
    while (open.size) {
      let cur = '';
      let cd = Infinity;
      for (const id of open) {
        const d = dist.get(id)!;
        if (d < cd) {
          cd = d;
          cur = id;
        }
      }
      open.delete(cur);
      if (cur === to) break;
      for (const e of this.adj.get(cur) ?? []) {
        if (e.to !== to && avoid?.(e.to)) continue;
        const nd = cd + e.len;
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, cur);
          open.add(e.to);
        }
      }
    }
    if (!prev.has(to)) return [];
    const out: string[] = [];
    for (let c = to; c !== from; c = prev.get(c)!) out.unshift(c);
    return out;
  }

  /** 地點之間的步數 */
  hops(a: string, b: string): number {
    return a === b ? 0 : this.path(a, b).length || 99;
  }

  isBurning(id: string): boolean {
    return (this.burning.get(id) ?? 0) > this.w.t;
  }

  /** 對某隊來說，這支部隊看不看得見（埋伏中的看不見，除非被偵察） */
  visibleTo(u: NUnit, team: number): boolean {
    if (u.team === team) return true;
    if (!u.hidden) return true;
    return (this.revealUntil.get(u.id) ?? 0) > this.w.t;
  }

  holding(u: NUnit): boolean {
    return u.mode === 'idle' && u.idleT >= 3;
  }

  inNode(u: NUnit, terrain: MapNode['terrain']): boolean {
    const n = this.nodeOf(u);
    return !!n && this.nodes.get(n)!.terrain === terrain;
  }

  counters(a: NUnit, b: NUnit): boolean {
    return (a.type === 'spear' && b.type === 'cav') || (a.type === 'cav' && b.type === 'archer') || (a.type === 'archer' && b.type === 'spear');
  }

  // ───────────────────────── 戰力公式（公開） ─────────────────────────

  /** a 對 b 的輸出（有效兵力），factors 收集說明文字 */
  output(a: NUnit, b: NUnit, f?: string[], asAttacker = false): number {
    let v = a.troops * (0.6 + a.morale / 125);
    const g = a.general ? GENERALS[a.general] : null;
    if (g) {
      const m = 1 + g.war / 400;
      v *= m;
      f?.push(`武將 ${g.name} ×${m.toFixed(2)}`);
    }
    if (this.counters(a, b)) {
      v *= COUNTER;
      f?.push(`兵種相剋 ×${COUNTER}`);
    } else if (this.counters(b, a)) f?.push(`被對方兵種剋（對方 ×${COUNTER}）`);
    const t = this.w.t;
    if (a.ambushUntil > t || (asAttacker && a.hidden)) {
      v *= 2;
      f?.push('伏擊 ×2');
    }
    if (a.ambushedUntil > t) v *= 0.8;
    if (this.inNode(a, 'ford')) v *= 0.5;
    if (a.burnT > t - 1.5) v *= 0.7;
    if (a.cut) v *= 0.7;
    if (a.drumsUntil > t) v *= 1.15;
    if (!asAttacker && this.holding(a)) v *= 1.15;
    return v;
  }

  /** b 受到傷害的倍率 */
  incoming(b: NUnit, f?: string[], assumeHold = false): number {
    let m = 1;
    const n = this.nodeOf(b);
    const ter = n ? this.nodes.get(n)!.terrain : 'plain';
    if (ter === 'hill' || ter === 'pass' || ter === 'hq') {
      m /= 1.5;
      f?.push(`敵在${ter === 'hill' ? '高地' : ter === 'pass' ? '隘口' : '本陣'}（受傷 −33%）`);
    } else if (ter === 'forest') {
      m /= 1.25;
      f?.push('敵在森林（受傷 −20%）');
    } else if (ter === 'ford') {
      m *= 1.5;
      f?.push('敵在渡口，半渡而擊（受傷 +50%）');
    }
    if (assumeHold || this.holding(b)) {
      m *= 0.75;
      f?.push('敵軍固守（受傷 −25%）');
    }
    const t = this.w.t;
    if (b.ambushedUntil > t) {
      m *= 1.35;
      f?.push('敵軍中伏（受傷 +35%）');
    }
    if (b.burnT > t - 1.5 || (n && this.isBurning(n) && this.burnTeam.get(n) !== b.team)) {
      m *= 1.3;
      f?.push('敵在火中（受傷 +30%）');
    }
    if (b.cut) {
      m *= 1.15;
      f?.push('敵軍斷糧（受傷 +15%）');
    }
    return m;
  }

  /** 進攻預估：簡化成一對一打到一方敗退 */
  preview(a: NUnit, b: NUnit): Preview {
    const factors: string[] = [];
    let ta = a.troops;
    let tb = b.troops;
    let ma = a.morale;
    let mb = b.morale;
    const outA = this.output(a, b, factors, true) / a.troops;
    const inB = this.incoming(b, factors, b.mode === 'idle');
    const outB = this.output(b, a) / Math.max(1, b.troops);
    const inA = this.incoming(a);
    if (a.hidden) mb -= 25;
    // 夾擊：已經在打同一個目標的友軍一起算（敵軍的反擊也分散）
    const allies = this.units.filter((o) => o !== a && o.team === a.team && this.alive(o) && o.mode !== 'retreat' && ((o.mode === 'attack' && o.target === b.id) || o.foes.includes(b.id)));
    const allyOut = allies.reduce((s, o) => s + this.output(o, b), 0);
    if (allies.length) factors.push(`與${allies.map((o) => (o.general ? GENERALS[o.general].name : o.name)).join('、')}夾擊`);
    const share = 1 / (1 + allies.length);
    let win = false;
    for (let k = 0; k < 120; k++) {
      const lb = RATE * 0.5 * Math.min(outA * ta + allyOut, frontCap(tb)) * inB;
      const la = RATE * 0.5 * Math.min(outB * tb * share, frontCap(ta)) * inA;
      tb -= lb;
      ta -= la;
      mb -= (lb / b.maxTroops) * 100 * MORALE_PER_PCT;
      ma -= (la / a.maxTroops) * 100 * MORALE_PER_PCT;
      const bBreak = mb < BREAK_MORALE || tb < b.maxTroops * BREAK_TROOPS;
      const aBreak = ma < BREAK_MORALE || ta < a.maxTroops * BREAK_TROOPS;
      if (bBreak || aBreak) {
        win = bBreak && (!aBreak || tb / b.maxTroops < ta / a.maxTroops);
        break;
      }
    }
    const myLoss = Math.round((a.troops - Math.max(0, ta)) / 10) * 10;
    const foeLoss = Math.round((b.troops - Math.max(0, tb)) / 10) * 10;
    const chance = win ? (myLoss < a.troops * 0.3 ? '高' : '中') : '低';
    return { win, chance, myLoss, foeLoss, factors: [...new Set(factors)] };
  }

  private trapSaidT = -99;
  private holdStage = 0;
  private alarmT = -99;

  lureChance(foe: NUnit): number {
    return LURE_CHANCE[foe.trait ?? 'normal'];
  }

  /** 誘敵對象：一群敵軍裡最容易上鉤的先追出來（手指滑過敵群時用） */
  lureTarget(foe: NUnit): NUnit {
    let best = foe;
    const fr = this.reg(foe);
    for (const o of this.units) {
      if (o.team !== foe.team || !this.alive(o) || o.mode === 'retreat') continue;
      const r = this.reg(o);
      if (Math.hypot(r.mx - fr.mx, r.mz - fr.mz) < 90 && this.lureChance(o) > this.lureChance(best)) best = o;
    }
    return best;
  }

  /** 同一群裡其他可能跟著追的部隊 */
  lureFollowers(foe: NUnit): NUnit[] {
    const fr = this.reg(foe);
    return this.units.filter((o) => o !== foe && o.team === foe.team && this.alive(o) && o.mode !== 'retreat' && Math.hypot(this.reg(o).mx - fr.mx, this.reg(o).mz - fr.mz) < 90);
  }

  // ───────────────────────── 命令（滑動手勢） ─────────────────────────

  private startNode(u: NUnit): string {
    const r = this.reg(u);
    return this.nodeOf(u) ?? this.nearestNode(r.mx, r.mz);
  }

  orderMove(u: NUnit, to: string): boolean {
    if (!this.alive(u) || u.mode === 'retreat') return false;
    const p = this.path(this.startNode(u), to);
    if (!p.length && this.startNode(u) !== to) return false;
    u.mode = 'move';
    u.path = p.length ? p : [to];
    u.target = null;
    this.unhide(u);
    return true;
  }

  orderAttack(u: NUnit, foe: NUnit): boolean {
    if (!this.alive(u) || !this.alive(foe) || u.mode === 'retreat') return false;
    u.mode = 'attack';
    u.target = foe.id;
    u.farT = 0;
    u.path = this.path(this.startNode(u), this.startNode(foe));
    // 從埋伏中殺出：45 秒內（夠殺到相鄰地點）接戰才算伏擊
    if (u.hidden) u.ambushWindow = this.w.t + 45;
    return true;
  }

  orderLure(u: NUnit, foe: NUnit, to: string): boolean {
    if (!this.alive(u) || !this.alive(foe) || u.mode === 'retreat') return false;
    foe = this.lureTarget(foe);
    u.mode = 'lure';
    u.target = foe.id;
    u.lureTo = to;
    u.lureStage = 'go';
    u.lureT = this.w.t;
    u.path = this.path(this.startNode(u), this.startNode(foe));
    this.unhide(u);
    return true;
  }

  /** 計策卡；回傳失敗原因或 null */
  useCard(team: number, card: CardId, nodeId: string): string | null {
    const info = CARD_INFO[card];
    const n = this.nodes.get(nodeId);
    if (!n) return '請拖到地點上';
    if (this.cmd[team] < info.cost) return `軍令不足（需要 ${info.cost}）`;
    const t = this.w.t;
    if (card === 'fire') {
      if (n.terrain !== 'forest' && n.terrain !== 'grass') return '火攻只能用在森林或蘆葦';
      if (this.w.sc.weather === 'rain') return '雨天點不著火';
      this.burning.set(nodeId, t + 20);
      this.burnTeam.set(nodeId, team);
      this.w.addFire(n.x, n.z, 26, team, 20);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        this.w.addFire(n.x + Math.cos(a) * 24, n.z + Math.sin(a) * 24, 18, team, 20);
      }
      this.say(`${n.name}大火！`, team === this.w.player ? 'gold' : 'bad');
      if (team === this.w.player) this.w.flags.burned = true;
    } else if (card === 'drums') {
      const mine = this.units.filter((u) => u.team === team && this.alive(u) && this.near(u, n, NODE_R + 10));
      if (!mine.length) return '擂鼓要拖到我軍所在的地點';
      for (const u of mine) {
        u.morale = Math.min(100, u.morale + 25);
        u.drumsUntil = t + 15;
      }
      this.say('擂鼓助威！士氣大振', 'good');
    } else if (card === 'scout') {
      for (const u of this.units) {
        if (u.team === team || !this.alive(u)) continue;
        const un = this.startNode(u);
        if (this.hops(un, nodeId) <= 1) {
          this.revealUntil.set(u.id, t + 30);
          this.w.regs[u.regId].spottedT = t + 30;
        }
      }
      this.say('斥候回報：附近敵情已查明', 'info');
    }
    this.cmd[team] -= info.cost;
    return null;
  }

  // ───────────────────────── 每步更新 ─────────────────────────

  /** 由戰鬥主迴圈每個模擬步呼叫 */
  update(dt: number): void {
    if (this.over || !this.w.started) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    const step = this.acc;
    this.acc = 0;
    const t = this.w.t;
    for (const team of [0, 1]) this.cmd[team] = Math.min(5, this.cmd[team] + step / 12);
    // 敵軍紮營倒數提示
    const hold = this.sc.enemyHold ?? 0;
    if (hold > 0 && this.holdStage === 0) {
      this.holdStage = 1;
      const boss = this.units.find((u) => u.team !== this.w.player && u.commander);
      const where = boss ? this.nodes.get(boss.at)?.name : '';
      this.say(`斥候：敵軍在${where}紮營，約 ${hold} 秒後南下——趁現在佈陣！`, 'info');
    } else if (hold > 0 && this.holdStage === 1 && t >= hold) {
      this.holdStage = 2;
      if (!this.units.some((u) => u.team !== this.w.player && (u.mode === 'chase' || u.foes.length))) this.say('敵軍拔營，開始進軍！', 'bad');
    }
    for (const u of this.units) {
      if (!this.alive(u)) continue;
      const n = this.nodeOf(u);
      if (n) u.at = n;
      if (u.mode === 'idle') u.idleT += step;
      else u.idleT = 0;
    }
    this.ai(step);
    this.guard(step);
    this.hqAlarm();
    this.moveUnits(step);
    this.combat(step);
    this.fires(step);
    this.hide(step);
    this.supply(step);
    // 主帥士氣崩潰（火燒、中計、中伏不一定有損兵）→ 敗走
    for (const u of this.units) if (u.commander && this.alive(u) && u.mode !== 'retreat' && u.morale < BREAK_MORALE && !this.over) this.breakOff(u);
    this.checkEnd(step);
    // 3D 軍團的士氣條跟著同步
    for (const u of this.units) if (this.alive(u)) this.reg(u).morale = u.morale;
    void t;
  }

  /** 我軍待命部隊自動救援：敵軍闖進自己的地點，或在相鄰地點打我軍 → 上前迎擊（埋伏中的不動，等玩家下令） */
  private guard(dt: number): void {
    const me = this.w.player;
    for (const u of this.units) {
      if (u.team !== me || !this.alive(u) || u.mode !== 'idle' || u.hidden || u.foes.length) continue;
      u.guardT -= dt;
      if (u.guardT > 0) continue;
      u.guardT = 1;
      // 在森林裡的部隊＝埋伏待命，不自動出擊（等玩家下令）
      if (this.inNode(u, 'forest')) continue;
      const here = this.startNode(u);
      let best: NUnit | null = null;
      let bd = Infinity;
      for (const f of this.units) {
        if (f.team === me || !this.alive(f) || f.mode === 'retreat' || !this.visibleTo(f, me)) continue;
        const fn = this.startNode(f);
        const h = this.hops(here, fn);
        // 只救主帥與本陣（其他相鄰的戰鬥交給玩家決定）
        const hitsBoss = f.foes.some((id) => {
          const o = this.unit(id);
          return !!o && o.team === me && (o.commander || this.inNode(o, 'hq'));
        });
        if (!(h === 0 || (h === 1 && hitsBoss))) continue;
        const d = Math.hypot(this.reg(f).mx - this.reg(u).mx, this.reg(f).mz - this.reg(u).mz);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      if (best) {
        this.orderAttack(u, best);
      }
    }
  }

  /** 敵軍逼近我軍本陣／主帥被攻擊：提醒玩家 */
  private hqAlarm(): void {
    const me = this.w.player;
    const t = this.w.t;
    if (t - this.alarmT < 15) return;
    const hq = this.sc.nodes.find((n) => n.terrain === 'hq' && n.team === me);
    const boss = this.units.find((u) => u.team === me && u.commander && this.alive(u));
    if (!hq) return;
    const threat = this.units.find((f) => f.team !== me && this.alive(f) && f.mode !== 'retreat' && this.visibleTo(f, me) && (this.hops(this.startNode(f), hq.id) <= 1 || (boss && f.foes.includes(boss.id))));
    if (threat) {
      this.alarmT = t;
      this.say(`⚠ 敵軍逼近${hq.name}！派兵保護主帥`, 'bad');
    }
  }

  private near(u: NUnit, n: MapNode, r: number): boolean {
    const g = this.reg(u);
    return Math.hypot(g.mx - n.x, g.mz - n.z) < r;
  }

  private say(text: string, tone: 'good' | 'bad' | 'info' | 'gold'): void {
    this.w.events.push({ k: 'msg', text, tone });
  }

  /** 同一地點的站位 */
  private slot(u: NUnit, nodeId: string): [number, number] {
    const n = this.nodes.get(nodeId)!;
    const others = this.units.filter((o) => o !== u && this.alive(o) && o.team === u.team && (o.at === nodeId || o.path[o.path.length - 1] === nodeId));
    const k = others.filter((o) => this.units.indexOf(o) < this.units.indexOf(u)).length;
    const [ox, oz] = slotOffset(k, others.length + 1);
    return [n.x + ox, n.z + oz];
  }

  private go(u: NUnit, x: number, z: number, run = true): void {
    const r = this.reg(u);
    if (r.order.type === 'move' && Math.hypot(r.order.x - x, r.order.z - z) < 6) return;
    const face = Math.atan2(x - r.mx, z - r.mz);
    this.w.commandMove([r.id], x, z, Math.hypot(x - r.mx, z - r.mz) > 4 ? face : r.facing, undefined, run);
  }

  private moveUnits(dt: number): void {
    const t = this.w.t;
    for (const u of this.units) {
      if (!this.alive(u)) continue;
      const r = this.reg(u);
      if (u.mode === 'attack') {
        const foe = u.target ? this.unit(u.target) : undefined;
        if (!foe || !this.alive(foe) || foe.mode === 'retreat' || !this.visibleTo(foe, u.team)) {
          u.mode = 'idle';
          u.target = null;
          this.goHome(u);
          continue;
        }
        const fr = this.reg(foe);
        const d = Math.hypot(fr.mx - r.mx, fr.mz - r.mz);
        if (d < r.radius + fr.radius + 50) {
          if (r.order.type !== 'attack' || r.order.target !== fr.id) this.w.commandAttack([r.id], fr.id, true);
          continue;
        }
        // 目標跑遠（兩個地點以外）超過 6 秒：追不上就放棄
        if (this.hops(this.startNode(u), this.startNode(foe)) > 1) u.farT += dt;
        else u.farT = 0;
        if (u.farT > 6) {
          u.mode = 'idle';
          u.target = null;
          this.goHome(u);
          continue;
        }
        if (Math.floor(t * 2) % 3 === 0) u.path = this.path(this.startNode(u), this.startNode(foe));
        this.follow(u, true);
        continue;
      }
      if (u.mode === 'lure') {
        const foe = u.target ? this.unit(u.target) : undefined;
        if (!foe || !this.alive(foe)) {
          u.mode = 'idle';
          continue;
        }
        if (u.lureStage === 'go') {
          const fr = this.reg(foe);
          if (Math.hypot(fr.mx - r.mx, fr.mz - r.mz) < r.radius + fr.radius + 45) this.provoke(u, foe);
          else {
            if (Math.floor(t * 2) % 3 === 0) u.path = this.path(this.startNode(u), this.startNode(foe));
            this.follow(u, true);
          }
        } else if (!this.follow(u, true)) {
          u.mode = 'idle';
          u.lureTo = null;
          // 功成身退：有追兵就再往本陣退一站，把陷阱留給伏兵與火攻
          const chased = this.units.some((o) => o.mode === 'chase' && o.target === u.id && this.alive(o));
          const hq = this.sc.nodes.find((n) => n.terrain === 'hq' && n.team === u.team);
          if (chased && hq && u.at !== hq.id) {
            const p = this.path(u.at, hq.id, (id) => this.held(id, u.team));
            // 不退進本陣（免得把追兵帶到主帥身邊）
            if (p.length && p[0] !== hq.id) {
              u.mode = 'move';
              u.path = [p[0]];
              u.safeUntil = Math.max(u.safeUntil, t + 4);
            }
          }
        }
        continue;
      }
      if (u.mode === 'chase') {
        const bait = u.target ? this.unit(u.target) : undefined;
        if (t > u.chaseUntil || !bait || !this.alive(bait)) {
          u.mode = 'idle';
          u.target = null;
          continue;
        }
        // 追到陷阱點：停下來、中計慌亂 8 秒（放火、伏兵殺出的好時機）
        if (u.chaseTo && this.nodeOf(u) === u.chaseTo) {
          const trap = this.nodes.get(u.chaseTo)!;
          u.mode = 'idle';
          u.target = null;
          u.chaseTo = null;
          u.aiT = 8;
          u.dazedUntil = t + 8;
          u.morale -= 10;
          if (u.team !== this.w.player && t - this.trapSaidT > 6) {
            this.trapSaidT = t;
            const canBurn = trap.terrain === 'forest' || trap.terrain === 'grass';
            // 相鄰地點有埋伏好的我軍才提示殺出
            const ready = this.units.some((o) => o.team === this.w.player && o.hidden && this.alive(o) && this.hops(this.startNode(o), trap.id) <= 1);
            const tip = canBurn && ready ? '——快放火、伏兵殺出！' : canBurn ? '——快放火！' : ready ? '——伏兵殺出！' : '';
            this.say(`敵軍追進${trap.name}，中計慌亂${tip}`, 'gold');
          }
          continue;
        }
        // 追著誘餌跑（路線經過伏兵與火場也照追）
        if (Math.floor(t * 2) % 3 === 0) u.path = this.path(this.startNode(u), this.startNode(bait));
        const br = this.reg(bait);
        if (!u.chaseTo && Math.hypot(br.mx - r.mx, br.mz - r.mz) < 60 && bait.mode !== 'lure') {
          u.mode = 'attack';
          continue;
        }
        if (!this.follow(u, true) && u.path.length === 0) this.go(u, br.mx, br.mz);
        continue;
      }
      if (u.mode === 'move' || u.mode === 'retreat') {
        if (!this.follow(u, true)) {
          if (u.mode === 'retreat') u.safeUntil = Math.max(u.safeUntil, t + 2);
          u.mode = 'idle';
        }
        continue;
      }
      // 待命：回到站位（沒交戰時）
      if (u.mode === 'idle' && !u.foes.length) {
        const [sx, sz] = this.slot(u, u.at);
        if (Math.hypot(r.mx - sx, r.mz - sz) > 18 && r.order.type !== 'move') this.go(u, sx, sz, false);
      }
    }
    void dt;
  }

  /** 沿路徑前進；回傳是否還在走 */
  private follow(u: NUnit, run: boolean): boolean {
    const r = this.reg(u);
    while (u.path.length) {
      const next = u.path[0];
      const final = u.path.length === 1;
      const n = this.nodes.get(next)!;
      const [x, z] = final ? this.slot(u, next) : [n.x, n.z];
      const d = Math.hypot(r.mx - x, r.mz - z);
      // 到了：接近站位，或已進入地點範圍且停下來了
      const stopped = r.order.type === 'idle' || r.state === 'ready';
      if (d < (final ? 12 : NODE_R * 0.6) || (Math.hypot(r.mx - n.x, r.mz - n.z) < NODE_R && stopped)) {
        u.path.shift();
        u.at = next;
        u.stuckT = 0;
        u.lastD = Infinity;
        continue;
      }
      // 卡住偵測：4 秒沒有前進就當作到了（避免永遠走不到）；換了目標就重新計
      const goal = `${next}:${x.toFixed(0)},${z.toFixed(0)}`;
      if (goal !== u.lastGoal) {
        u.lastGoal = goal;
        u.lastD = Infinity;
        u.stuckT = 0;
      }
      if (d < u.lastD - 1) {
        u.lastD = d;
        u.stuckT = 0;
      } else u.stuckT += 0.25;
      if (u.stuckT > 4) {
        u.path.shift();
        u.at = Math.hypot(r.mx - n.x, r.mz - n.z) < NODE_R * 1.5 ? next : this.nearestNode(r.mx, r.mz);
        u.stuckT = 0;
        u.lastD = Infinity;
        continue;
      }
      this.go(u, x, z, run);
      return true;
    }
    return false;
  }

  private goHome(u: NUnit): void {
    const [x, z] = this.slot(u, u.at);
    this.go(u, x, z, false);
  }

  /** 誘敵：挑釁成功 → 敵軍追過來；誘餌撤到陷阱點 */
  private provoke(u: NUnit, foe: NUnit): void {
    const ok = this.w.rng() < this.lureChance(foe);
    u.lureStage = 'back';
    u.safeUntil = this.w.t + 5;
    u.path = this.path(this.startNode(u), u.lureTo ?? u.at);
    if (!u.path.length) u.path = [u.lureTo ?? u.at];
    const fg = foe.general ? GENERALS[foe.general].name : foe.name;
    if (ok && foe.mode !== 'retreat') {
      const trap = u.lureTo ?? u.at;
      foe.mode = 'chase';
      foe.target = u.id;
      foe.chaseTo = trap;
      foe.chaseUntil = this.w.t + 35;
      foe.path = [];
      // 身邊的部隊各自依性格決定要不要跟著追（謹慎的不容易上鉤）
      for (const o of this.units) {
        if (o === foe || o.team !== foe.team || !this.alive(o) || o.mode === 'retreat' || o.mode === 'chase') continue;
        if (Math.hypot(this.reg(o).mx - this.reg(foe).mx, this.reg(o).mz - this.reg(foe).mz) < 90 && this.w.rng() < this.lureChance(o)) {
          o.mode = 'chase';
          o.target = u.id;
          o.chaseTo = trap;
          o.chaseUntil = this.w.t + 30;
          o.path = [];
        }
      }
      this.w.flags.lured = true;
      this.say(`${fg}中計，追過來了！`, u.team === this.w.player ? 'gold' : 'bad');
    } else this.say(`${fg}${foe.trait === 'cautious' ? '謹慎' : ''}，沒有上鉤`, 'info');
  }

  // ───────────────────────── 交戰 ─────────────────────────

  private combat(dt: number): void {
    const t = this.w.t;
    const live = this.units.filter((u) => this.alive(u) && u.mode !== 'retreat');
    for (const u of this.units) u.foes = [];
    for (const a of live) {
      if (a.team !== 0) continue;
      for (const b of live) {
        if (b.team === 0) continue;
        if (a.safeUntil > t || b.safeUntil > t) continue;
        const ra = this.reg(a);
        const rb = this.reg(b);
        if (Math.hypot(ra.mx - rb.mx, ra.mz - rb.mz) < ra.radius + rb.radius + 8) {
          a.foes.push(b.id);
          b.foes.push(a.id);
        }
      }
    }
    // 伏擊：埋伏中的部隊一交戰就觸發
    for (const u of live) {
      if (!u.hidden || !u.foes.length) continue;
      u.hidden = false;
      this.reg(u).hidden = false;
      u.ambushUntil = t + 5;
      // 每一路伏兵殺出算一次（兩路夾擊同一個敵人＝兩次）
      if (u.team === this.w.player) this.w.flags.ambushes = ((this.w.flags.ambushes as number) ?? 0) + 1;
      for (const id of u.foes) {
        const f = this.unit(id)!;
        if (f.ambushedUntil > t) continue;
        f.ambushedUntil = t + 10;
        f.morale -= 25;
        this.w.events.push({ k: 'ambush', reg: f.regId, by: u.regId });
      }
    }
    // 被夾擊：交戰的敵軍來自兩個以上方向
    const flanked = (b: NUnit) => {
      if (b.foes.length < 2) return false;
      const rb = this.reg(b);
      const angs = b.foes.map((id) => {
        const r = this.reg(this.unit(id)!);
        return Math.atan2(r.mx - rb.mx, r.mz - rb.mz);
      });
      for (let i = 0; i < angs.length; i++)
        for (let j = i + 1; j < angs.length; j++) {
          let d = Math.abs(angs[i] - angs[j]);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d > 1.6) return true;
        }
      return false;
    };
    const loss = new Map<NUnit, number>();
    for (const b of live) {
      if (!b.foes.length) continue;
      let inc = 0;
      for (const id of b.foes) {
        const a = this.unit(id)!;
        inc += this.output(a, b) / a.foes.length;
      }
      let mul = this.incoming(b);
      if (flanked(b)) mul *= 1.3;
      loss.set(b, RATE * Math.min(inc, frontCap(b.troops)) * mul * dt);
    }
    for (const [u, l] of loss) this.applyLoss(u, l);
  }

  private applyLoss(u: NUnit, l: number): void {
    const before = u.troops;
    u.troops = Math.max(0, u.troops - l);
    u.morale -= ((before - u.troops) / u.maxTroops) * 100 * MORALE_PER_PCT;
    this.syncSoldiers(u);
    if (u.commander) {
      if (u.troops < u.maxTroops * COMMANDER_BREAK || u.morale < BREAK_MORALE) this.breakOff(u);
      return;
    }
    if (u.troops < u.maxTroops * ROUT_TROOPS) this.rout(u);
    else if (u.morale < BREAK_MORALE || u.troops < u.maxTroops * BREAK_TROOPS) this.breakOff(u);
  }

  /** 3D 士兵數跟著兵力（每 10 人一名） */
  private syncSoldiers(u: NUnit): void {
    const r = this.reg(u);
    const target = Math.ceil(u.troops / 10);
    const cur = r.members.filter((i) => !this.w.s.general[i]).length;
    if (cur > target) this.w.killSoldiers(r.id, cur - target);
  }

  /** 敗退：撤回最近的己方地點（往本陣方向） */
  private breakOff(u: NUnit): void {
    if (u.mode === 'retreat' || this.over) return;
    const name = u.general ? GENERALS[u.general].name : u.name;
    // 戰果：逼退敵將
    if (u.general) this.w.teams[1 - u.team].generalsBeaten++;
    if (u.commander) {
      this.say(`主帥${name}敗走！`, u.team === this.w.player ? 'bad' : 'gold');
      this.finish(1 - u.team);
      return;
    }
    const hq = this.sc.nodes.find((n) => n.terrain === 'hq' && n.team === u.team);
    const from = this.startNode(u);
    let p = hq ? this.path(from, hq.id, (id) => this.held(id, u.team)) : [];
    if (p.length > 2) p = p.slice(0, 2);
    u.mode = 'retreat';
    u.path = p.length ? p : [from];
    u.target = null;
    u.safeUntil = this.w.t + 6;
    u.morale = Math.max(u.morale, 10);
    this.say(`${name}${u.team === this.w.player ? '' : '（敵）'}敗退！`, u.team === this.w.player ? 'bad' : 'good');
  }

  /** 潰散：離開戰場 */
  private rout(u: NUnit): void {
    if (this.over) return;
    const name = u.general ? GENERALS[u.general].name : u.name;
    if (u.general) this.w.teams[1 - u.team].generalsBeaten++;
    if (u.commander) {
      this.say(`主帥${name}潰敗！`, u.team === this.w.player ? 'bad' : 'gold');
      this.finish(1 - u.team);
      return;
    }
    u.mode = 'gone';
    this.w.withdraw(this.reg(u));
    this.say(`${name}${u.team === this.w.player ? '' : '（敵）'}潰散，退出戰場`, u.team === this.w.player ? 'bad' : 'good');
  }

  // ───────────────────────── 火、埋伏、糧道 ─────────────────────────

  private fires(dt: number): void {
    const t = this.w.t;
    for (const [id, until] of this.burning) {
      if (until <= t) {
        this.burning.delete(id);
        continue;
      }
      const n = this.nodes.get(id)!;
      const owner = this.burnTeam.get(id);
      for (const u of this.units) {
        // 火只燒敵方：放火的一方穿過火場不受傷（伏兵也不會因火光現形）
        if (!this.alive(u) || u.team === owner || !this.near(u, n, NODE_R + 12)) continue;
        u.burnT = t;
        // 火：削弱（士氣、兵力），要配合伏兵殺出才打得垮
        u.morale -= 1.5 * dt;
        this.applyLoss(u, u.troops * 0.01 * dt);
        if (u.team !== this.w.player) this.w.flags.burned = true;
      }
    }
  }

  private hide(dt: number): void {
    // 殺出森林太久還沒接戰：現形
    for (const u of this.units) if (u.hidden && u.mode !== 'idle' && this.w.t > u.ambushWindow && !this.inNode(u, 'forest')) this.unhide(u);
    for (const u of this.units) {
      if (!this.alive(u) || u.hidden || u.mode !== 'idle' || u.foes.length) continue;
      if (!this.inNode(u, 'forest') || this.isBurning(u.at)) continue;
      // 附近 50 m 有敵軍就藏不住
      const r = this.reg(u);
      const seen = this.units.some((o) => o.team !== u.team && this.alive(o) && Math.hypot(this.reg(o).mx - r.mx, this.reg(o).mz - r.mz) < 50);
      if (!seen && u.idleT > 2) {
        u.hidden = true;
        r.hidden = true;
        r.concealedT = this.w.t;
      }
    }
    if (this.w.flags.hiddenMax === undefined || (this.w.flags.hiddenMax as number) < this.units.filter((u) => u.team === this.w.player && u.hidden).length)
      this.w.flags.hiddenMax = this.units.filter((u) => u.team === this.w.player && u.hidden).length;
    void dt;
  }

  private unhide(u: NUnit): void {
    if (!u.hidden) return;
    u.hidden = false;
    this.reg(u).hidden = false;
  }

  /** 地點被敵軍佔住（有敵軍、沒有我軍） */
  held(id: string, team: number): boolean {
    const n = this.nodes.get(id)!;
    let foe = false;
    for (const u of this.units) {
      if (!this.alive(u) || u.mode === 'retreat' || !this.near(u, n, NODE_R)) continue;
      if (u.team === team) return false;
      foe = true;
    }
    return foe;
  }

  /** 糧道：沿著沒被敵軍佔住的地點連回己方糧倉 */
  supplied(team: number): Set<string> {
    const start = this.sc.nodes.filter((n) => n.terrain === 'depot' && n.team === team).map((n) => n.id);
    const ok = new Set<string>();
    const q = start.filter((id) => !this.held(id, team));
    for (const id of q) ok.add(id);
    while (q.length) {
      const c = q.shift()!;
      for (const e of this.adj.get(c) ?? []) {
        if (ok.has(e.to) || this.held(e.to, team)) continue;
        ok.add(e.to);
        q.push(e.to);
      }
    }
    return ok;
  }

  private supply(dt: number): void {
    for (const team of [0, 1]) {
      if (!this.sc.nodes.some((n) => n.terrain === 'depot' && n.team === team)) continue;
      const ok = this.supplied(team);
      for (const u of this.units) {
        if (u.team !== team || !this.alive(u)) continue;
        const n = this.startNode(u);
        if (ok.has(n)) {
          u.cutT = 0;
          if (u.cut) {
            u.cut = false;
            if (team === this.w.player) this.say(`${u.name}糧道恢復`, 'good');
          }
        } else {
          u.cutT += dt;
          if (!u.cut && u.cutT > 6) {
            u.cut = true;
            this.say(team === this.w.player ? `${u.name}糧道被斷！` : `敵軍${u.name}糧道被斷`, team === this.w.player ? 'bad' : 'good');
          }
          if (u.cut) u.morale = Math.max(20, u.morale - 0.5 * dt);
        }
        // 沒交戰時士氣慢慢回復（撤退中也會）
        if (!u.foes.length && !u.cut && u.burnT < this.w.t - 2) u.morale = Math.min(u.general ? 85 : 75, u.morale + (u.mode === 'retreat' ? 2 : 1) * dt);
      }
    }
  }

  // ───────────────────────── 敵軍 AI（依性格） ─────────────────────────

  private ai(dt: number): void {
    for (const u of this.units) {
      if (u.team === this.w.player || !this.alive(u)) continue;
      u.aiT -= dt;
      if (u.aiT > 0) continue;
      u.aiT = 1.5;
      if (u.mode === 'chase' || u.mode === 'retreat' || u.foes.length) continue;
      // 開場紮營：還沒被挑釁、附近沒有友軍交戰 → 原地不動
      if (this.w.t < (this.sc.enemyHold ?? 0) && !this.units.some((o) => o.team === u.team && this.alive(o) && (o.foes.length || o.mode === 'chase'))) continue;
      const trait = u.trait ?? 'normal';
      const from = this.startNode(u);
      // 士氣低落（中計、被火燒、中伏之後）：不再冒進，往自家本陣退一站重整
      if (u.morale < 35) {
        const home = this.sc.nodes.find((n) => n.terrain === 'hq' && n.team === u.team);
        if (home && from !== home.id && u.mode !== 'move') {
          const p = this.path(from, home.id, (id) => this.isBurning(id));
          if (p.length) {
            u.mode = 'move';
            u.path = [p[0]];
            u.target = null;
            u.intent = p[0];
          }
        }
        continue;
      }
      // 主帥：跟著大軍走、不單獨衝鋒；友軍在附近交戰才加入（被誘敵時照樣會追）
      if (u.commander) {
        const fighting = this.units.find((o) => o.team === u.team && o !== u && this.alive(o) && o.foes.length && this.hops(from, this.startNode(o)) <= 1);
        if (fighting) {
          const f = this.unit(fighting.foes[0]);
          if (f && (u.mode !== 'attack' || u.target !== f.id)) this.orderAttack(u, f);
          continue;
        }
        if (u.mode === 'attack' || u.mode === 'move') continue;
        const counts = new Map<string, number>();
        for (const o of this.units) {
          if (o.team !== u.team || o === u || !this.alive(o) || o.mode === 'retreat') continue;
          const n = this.startNode(o);
          if (this.hops(from, n) <= 2) counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        let goal = from;
        let gc = counts.get(from) ?? 0;
        for (const [n, c] of counts) if (c > gc) {
          goal = n;
          gc = c;
        }
        if (goal !== from) {
          const p = this.path(from, goal, (id) => this.isBurning(id));
          if (p.length) {
            u.mode = 'move';
            u.path = [p[0]];
            u.intent = p[0];
          }
        } else u.intent = null;
        continue;
      }
      // 救主帥：主帥被打，兩步以內的部隊一律回援；友軍在相鄰地點交戰也去幫忙
      const boss = this.units.find((o) => o.team === u.team && o.commander && this.alive(o) && o.foes.length && this.hops(from, this.startNode(o)) <= 2);
      const pal = boss ?? this.units.find((o) => o.team === u.team && o !== u && this.alive(o) && o.foes.length && this.hops(from, this.startNode(o)) <= 1);
      if (pal) {
        const f = this.unit(pal.foes[0]);
        if (f && this.alive(f) && (u.mode !== 'attack' || u.target !== f.id)) this.orderAttack(u, f);
        if (f) u.intent = this.startNode(f);
        continue;
      }
      // 看得見的我軍：兩步以內、有把握就打
      let best: NUnit | null = null;
      let bs = -Infinity;
      for (const p of this.units) {
        if (p.team === u.team || !this.alive(p) || !this.visibleTo(p, u.team) || p.mode === 'retreat') continue;
        const h = this.hops(from, this.startNode(p));
        if (h > 2) continue;
        const pv = this.preview(u, p);
        const need = trait === 'rash' ? pv.chance !== '低' || h <= 1 : trait === 'normal' ? pv.chance === '高' : pv.chance === '高' && h <= 1;
        if (!need) continue;
        const s = -h * 10 + (pv.win ? 20 : 0);
        if (s > bs) {
          bs = s;
          best = p;
        }
      }
      if (best) {
        if (u.mode !== 'attack' || u.target !== best.id) this.orderAttack(u, best);
        u.intent = this.startNode(best);
        continue;
      }
      if (u.mode === 'attack' || u.mode === 'move') continue;
      // 謹慎：原地固守（除非友軍在附近交戰）
      if (trait === 'cautious') {
        const ally = this.units.find((o) => o.team === u.team && this.alive(o) && o.foes.length && this.hops(from, this.startNode(o)) <= 1);
        if (ally && ally.foes[0]) {
          const f = this.unit(ally.foes[0]);
          if (f) this.orderAttack(u, f);
        } else u.intent = null;
        continue;
      }
      // 輕敵、普通：往敵方本陣推進一個地點（避開大火）
      const hq = this.sc.nodes.find((n) => n.terrain === 'hq' && n.team === this.w.player);
      if (!hq) continue;
      const p = this.path(from, hq.id, (id) => this.isBurning(id));
      if (p.length) {
        u.mode = 'move';
        u.path = [p[0]];
        u.intent = p[0];
      }
    }
  }

  // ───────────────────────── 勝負 ─────────────────────────

  private checkEnd(dt: number): void {
    // 本陣被佔領：敵軍停在本陣、沒有守軍 8 秒
    for (const team of [0, 1]) {
      const hq = this.sc.nodes.find((n) => n.terrain === 'hq' && n.team === team);
      if (!hq) continue;
      if (this.held(hq.id, team)) {
        this.capT[team] += dt;
        if (this.capT[team] > 8) {
          this.say(`${hq.name}被攻陷！`, team === this.w.player ? 'bad' : 'gold');
          this.finish(1 - team);
          return;
        }
      } else this.capT[team] = 0;
    }
    for (const team of [0, 1]) {
      if (!this.units.some((u) => u.team === team && this.alive(u) && u.mode !== 'retreat')) {
        this.finish(1 - team);
        return;
      }
      // 全軍潰敗：剩下的兵力不到開戰時的 35%
      const all = this.units.filter((u) => u.team === team);
      const now = all.reduce((a, u) => a + (this.alive(u) ? u.troops : 0), 0);
      const start = all.reduce((a, u) => a + u.maxTroops, 0);
      if (now < start * ARMY_COLLAPSE) {
        this.say(`${this.w.teams[team].name}損兵過半，全軍潰敗！`, team === this.w.player ? 'bad' : 'gold');
        this.finish(1 - team);
        return;
      }
    }
  }

  private finish(winner: number): void {
    if (this.over) return;
    this.over = true;
    this.w.finish(winner);
  }
}
