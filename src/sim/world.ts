// 戰場模擬總管：固定 30 Hz；士兵移動、陣型、近戰、箭矢、士氣、糧草、視野、勝負
import { FACTIONS } from '../data/factions';
import { ABILITIES, GENERALS } from '../data/generals';
import { RULES, SUPPLY_EFFECTS, SUPPLY_RANK, WEATHER, type SupplyState } from '../data/rules';
import { STRATAGEMS, type StratagemId } from '../data/stratagems';
import type { RegimentSpec, Scenario } from '../data/scenario';
import { UNITS, type UnitDef } from '../data/units';
import type { Heightfield } from '../map/heightfield';
import { WATER_LEVEL } from '../map/heightfield';
import { NavGrid } from '../map/nav';
import { ANIMS } from '../models/rig';
import { MODEL_KEYS, type ModelKey } from '../models/soldier';
import { makeRng } from '../util/rng';
import { Projectiles } from './projectiles';
import { Regiment, type Formation } from './regiment';
import { SpatialHash, Soldiers, SState } from './soldiers';
import { Structure, Wagon } from './structures';

export const TICK = 1 / 30;

export type GameEvent =
  | { k: 'corpse'; i: number }
  | { k: 'arrow'; p: number }
  | { k: 'impact'; x: number; z: number; hit: number; fire: boolean }
  | { k: 'clash'; x: number; z: number }
  | { k: 'charge'; reg: number; x: number; z: number }
  | { k: 'rout'; reg: number }
  | { k: 'rally'; reg: number }
  | { k: 'shattered'; reg: number }
  | { k: 'generalDown'; reg: number; name: string }
  | { k: 'generalRetreat'; reg: number; name: string }
  | { k: 'lineCut'; team: number; x: number; z: number; burnt: boolean }
  | { k: 'lineRestored'; team: number }
  | { k: 'ignite'; s: number }
  | { k: 'burnt'; s: number }
  | { k: 'wagonLost'; team: number }
  | { k: 'supply'; team: number; state: SupplyState }
  | { k: 'ability'; reg: number; name: string }
  | { k: 'msg'; text: string; tone: 'good' | 'bad' | 'info' | 'gold' }
  | { k: 'defect'; reg: number }
  | { k: 'panic'; team: number }
  | { k: 'chargeStart'; reg: number }
  | { k: 'duel'; a: string; b: string; winner: string; loser: string; winTeam: number; killed: boolean; x: number; z: number }
  | { k: 'stratagem'; team: number; id: StratagemId; x: number; z: number }
  | { k: 'end'; winner: number };

export interface TeamState {
  index: number;
  name: string;
  faction: string;
  color: string;
  supply: SupplyState;
  hq: Structure | null;
  depots: Structure[];
  initialStrength: number;
  fled: number;
  dead: number;
  command: number;
  consume: number;
  depotsBurnt: number;
  wagonsLost: number;
  /** 軍心大亂（主糧倉被焚）持續到此時間 */
  panicUntil: number;
  /** 糧道是否暢通（至少一條補給路線沒被切斷） */
  lineOk: boolean;
  /** 被逼退或陣亡的敵將數（戰報用） */
  generalsBeaten: number;
}

const _slot: [number, number] = [0, 0];

export class World {
  readonly sc: Scenario;
  readonly hf: Heightfield;
  readonly nav: NavGrid;
  readonly s: Soldiers;
  readonly hash: SpatialHash;
  readonly proj = new Projectiles(4000);
  readonly regs: Regiment[] = [];
  readonly structs: Structure[] = [];
  readonly wagons: Wagon[] = [];
  readonly teams: TeamState[] = [];
  events: GameEvent[] = [];
  t = 0;
  tick = 0;
  over = false;
  winner = -1;
  /** 開戰（部署階段結束） */
  started = false;
  rng: () => number;
  /** 視角隊伍（玩家） */
  readonly player = 0;
  /** 劇本自訂旗標 */
  flags: Record<string, number | boolean> = {};
  private triggered = new Set<number>();
  bridges: { x: number; z: number; angle: number; length: number }[] = [];
  /** 天氣效果 */
  get wx() {
    return WEATHER[this.sc.weather ?? 'clear'];
  }

  /** 難度：各隊攻擊倍率 */
  teamAtk = [1, 1];
  /** 各隊士氣流失倍率（玩家在簡單／普通難度較堅韌） */
  teamGrit = [1, 1];
  /** 各隊「後方」方向（單位向量，由戰場中心指向己方本陣） */
  homeDir: [number, number][] = [];

  /** 套用難度（敵軍攻擊與士氣） */
  setDifficulty(d: 'easy' | 'normal' | 'hard'): void {
    const atk = d === 'easy' ? 0.75 : d === 'hard' ? 1.12 : 0.92;
    const mor = d === 'easy' ? -12 : d === 'hard' ? 6 : -3;
    for (let t = 0; t < this.teams.length; t++) if (t !== this.player) this.teamAtk[t] = atk;
    // 玩家是主帥：簡單／普通難度下我軍士氣流失較慢
    this.teamGrit[this.player] = d === 'easy' ? 0.6 : d === 'hard' ? 1 : 0.75;
    for (const r of this.regs) {
      if (r.team === this.player) continue;
      r.baseMorale = Math.max(30, Math.min(95, r.baseMorale + mor));
      r.morale = r.baseMorale;
    }
  }
  /** 可遊玩區的地面高度中位數（判斷「高地」用） */
  baseHeight = 3;

  constructor(sc: Scenario, hf: Heightfield, cap = 9000) {
    this.sc = sc;
    this.hf = hf;
    this.nav = new NavGrid(hf);
    this.s = new Soldiers(cap);
    this.hash = new SpatialHash(hf.play + 40, cap);
    this.rng = makeRng(sc.map.seed * 31 + 7);
    this.bridges = sc.bridges ?? [];
    for (const b of this.bridges) this.nav.openBridge(b.x, b.z, b.angle, b.length);
    sc.teams.forEach((ts, ti) => {
      const f = FACTIONS[ts.faction];
      const team: TeamState = {
        index: ti,
        name: ts.name,
        faction: ts.faction,
        color: f.color,
        supply: 'ok',
        hq: null,
        depots: [],
        initialStrength: 0,
        fled: 0,
        dead: 0,
        command: RULES.commandStart,
        consume: ts.consume ?? 1,
        depotsBurnt: 0,
        wagonsLost: 0,
        panicUntil: -1,
        lineOk: true,
        generalsBeaten: 0,
      };
      this.teams.push(team);
      if (ts.hq) {
        const hq = new Structure(this.structs.length, 'hq', ti, ts.hq.x, ts.hq.z, ts.hq.stock ?? 400, false, ts.hq.name ?? `${ts.name}本陣`);
        this.structs.push(hq);
        team.hq = hq;
        this.nav.block(hq.x, hq.z, 9);
      }
      for (const d of ts.depots) {
        const st = new Structure(this.structs.length, d.kind ?? 'depot', ti, d.x, d.z, d.stock ?? 1000, !!d.main, d.name ?? '糧倉');
        this.structs.push(st);
        team.depots.push(st);
        this.nav.block(st.x, st.z, st.kind === 'water' ? 4 : 6);
      }
      for (const rs of ts.regiments) this.spawnRegiment(ti, rs);
    });
    // 營門朝向：本陣朝戰場中央、糧倉與營寨朝自家本陣；柵欄圈阻擋通行
    for (const st of this.structs) {
      const hq = this.teams[st.team].hq;
      const [tx, tz] = st.kind === 'hq' || !hq ? [0, 0] : [hq.x, hq.z];
      st.gate = Math.atan2(tx - st.x, tz - st.z);
      if (st.kind === 'water') continue;
      const palR = st.kind === 'hq' ? 21.6 : st.kind === 'camp' ? 10.6 : st.radius - 1.4;
      const gap = st.kind === 'hq' ? 3.25 : st.kind === 'camp' ? 2.6 : st.main ? 3.6 : 3.0;
      this.nav.blockRing(st.x, st.z, palR, st.gate, gap);
    }
    for (const team of this.teams) team.initialStrength = this.regs.filter((r) => r.team === team.index).reduce((a, r) => a + r.alive, 0);
    // 糧道：每個補給點沿道路到本陣的路線
    for (const st of this.structs) {
      const hq = this.teams[st.team].hq;
      if (!hq || st === hq) continue;
      const raw = [[st.x, st.z] as [number, number], ...this.nav.findPath(st.x, st.z, hq.x, hq.z), [hq.x, hq.z] as [number, number]];
      st.route = densify(raw, 6);
    }
    // 後方方向：己方本陣（沒有就用初始兵力重心）相對雙方重心的中點
    const centroid = (t: number): [number, number] => {
      const hq = this.teams[t].hq;
      if (hq) return [hq.x, hq.z];
      const rs = this.regs.filter((r) => r.team === t);
      return [rs.reduce((a, r) => a + r.cx, 0) / Math.max(1, rs.length), rs.reduce((a, r) => a + r.cz, 0) / Math.max(1, rs.length)];
    };
    const homes = this.teams.map((t) => centroid(t.index));
    const mid: [number, number] = [(homes[0][0] + homes[1][0]) / 2, (homes[0][1] + homes[1][1]) / 2];
    this.homeDir = homes.map(([x, z]) => {
      const dx = x - mid[0];
      const dz = z - mid[1];
      const l = Math.hypot(dx, dz) || 1;
      return [dx / l, dz / l] as [number, number];
    });
    const hs: number[] = [];
    for (let z = -hf.play / 2; z < hf.play / 2; z += 16) for (let x = -hf.play / 2; x < hf.play / 2; x += 16) hs.push(hf.height(x, z));
    hs.sort((a, b) => a - b);
    this.baseHeight = hs[hs.length >> 1];
    this.hash.rebuild(this.s);
  }

  // ───────────────────────── 地形優勢（docs/02 §6） ─────────────────────────

  /** 涉水中（淺灘、河裡） */
  isWet(x: number, z: number): boolean {
    return this.hf.height(x, z) < WATER_LEVEL + 0.05 && this.groundY(x, z) < WATER_LEVEL + 0.5;
  }

  /** 在己方營寨範圍內 */
  inOwnCamp(x: number, z: number, team: number): boolean {
    for (const st of this.structs) if (st.team === team && !st.burnt && (st.kind === 'hq' || st.kind === 'camp') && Math.hypot(st.x - x, st.z - z) < st.radius + 18) return true;
    return false;
  }

  /** 軍團目前所處地形（HUD 顯示與規則判斷） */
  updateTerrain(r: Regiment): void {
    const h = this.hf.height(r.mx, r.mz);
    const tr = r.terrain;
    tr.height = h - this.baseHeight;
    tr.forest = this.nav.forestAt(r.mx, r.mz) > 0.45;
    // 涉水：三成以上的士兵在水裡
    let wet = 0;
    const step = Math.max(1, Math.floor(r.members.length / 12));
    let n = 0;
    for (let k = 0; k < r.members.length; k += step) {
      const i = r.members[k];
      if (this.isWet(this.s.x[i], this.s.z[i])) wet++;
      n++;
    }
    tr.wet = n > 0 && wet / n > 0.3;
    tr.camp = this.inOwnCamp(r.mx, r.mz, r.team);
    tr.road = this.hf.roadAt(r.mx, r.mz) > 0.5;
    // 相對最近敵軍的高低差
    let best = Infinity;
    let rel = 0;
    for (const id of r.nearEnemies) {
      const e = this.regs[id];
      const d = Math.hypot(e.mx - r.mx, e.mz - r.mz);
      if (d < best) {
        best = d;
        rel = h - this.hf.height(e.mx, e.mz);
      }
    }
    tr.relHeight = best < Infinity ? rel : 0;
    tr.high = tr.relHeight > 2 || (best === Infinity && tr.height > 4);
  }

  /** 高低差造成的近戰倍率 */
  heightMul(hAtt: number, hDef: number): number {
    const d = (hAtt - hDef) * RULES.heightPerMeter;
    return 1 + Math.max(RULES.heightMin, Math.min(RULES.heightMax, d));
  }

  // ───────────────────────── 生成 ─────────────────────────

  spawnRegiment(team: number, rs: RegimentSpec): Regiment {
    const unit = UNITS[rs.type];
    const ts = this.sc.teams[team];
    const gdef = rs.general ? GENERALS[rs.general] : null;
    const name = rs.name ?? (gdef ? `${gdef.name}隊` : unit.name);
    const r = new Regiment(this.regs.length, team, ts.faction, unit, name);
    this.regs.push(r);
    r.cx = rs.x;
    r.cz = rs.z;
    r.facing = ((rs.facing ?? (team === 0 ? 180 : 0)) * Math.PI) / 180;
    r.order.facing = r.facing;
    r.width = rs.width ?? unit.width;
    r.formation = rs.formation ?? 'line';
    r.hold = !!rs.hold;
    r.hidden = !!rs.hidden;
    r.fixed = !!rs.fixed;
    if (rs.morale) r.baseMorale = r.morale = rs.morale;
    if (rs.role) r.ai.role = rs.role;
    else r.ai.role = unit.ranged ? 'ranged' : unit.mounted ? 'flank' : 'line';
    r.ai.homeX = rs.x;
    r.ai.homeZ = rs.z;
    const n = rs.count ?? unit.count;
    const modelIdx = MODEL_KEYS.indexOf(unit.model);
    const s = this.s;
    for (let k = 0; k < n; k++) {
      const i = s.add();
      r.slotWorld(k, n, _slot);
      s.x[i] = s.px[i] = _slot[0] + (this.rng() - 0.5) * 0.4;
      s.z[i] = s.pz[i] = _slot[1] + (this.rng() - 0.5) * 0.4;
      s.yaw[i] = s.pyaw[i] = r.facing;
      s.hp[i] = s.maxHp[i] = unit.hp;
      s.reg[i] = r.id;
      s.slot[i] = k;
      s.team[i] = team;
      s.state[i] = SState.Alive;
      s.model[i] = modelIdx;
      s.tint[i] = this.rng();
      s.ammo[i] = unit.ranged ? unit.ranged.ammo : 0;
      s.reload[i] = this.rng() * 2;
      s.setAnim(i, 'idle', 0);
      r.members.push(i);
    }
    if (gdef) {
      // 武將本人：放在第一排中央
      const i = s.add();
      r.slotWorld(0, n, _slot);
      s.x[i] = s.px[i] = r.cx + Math.sin(r.facing) * (r.depth(n) / 2 + 1.5);
      s.z[i] = s.pz[i] = r.cz + Math.cos(r.facing) * (r.depth(n) / 2 + 1.5);
      s.yaw[i] = s.pyaw[i] = r.facing;
      const hp = 1400 + gdef.war * 12;
      s.hp[i] = s.maxHp[i] = hp;
      s.reg[i] = r.id;
      s.slot[i] = -1;
      s.team[i] = team;
      s.state[i] = SState.Alive;
      s.model[i] = MODEL_KEYS.indexOf(gdef.model);
      s.general[i] = 1;
      s.tint[i] = 0.5;
      s.setAnim(i, 'idle', 0);
      r.members.push(i);
      r.general = { id: gdef.id, name: gdef.name, soldier: i, alive: true, cd: 10 };
      if (!rs.morale) r.baseMorale = r.morale = Math.max(r.morale, 80);
    }
    r.initial = r.members.length;
    r.mx = r.cx;
    r.mz = r.cz;
    r.radius = Math.max(r.frontage(), r.depth()) / 2 + 2;
    return r;
  }

  // ───────────────────────── 指令 ─────────────────────────

  commandMove(ids: number[], x: number, z: number, facing?: number, width?: number, run?: boolean): void {
    for (const id of ids) {
      const r = this.regs[id];
      if (!r || r.gone || r.routing) continue;
      if (width) r.width = Math.max(2, Math.min(60, Math.round(width)));
      const f = facing ?? Math.atan2(x - r.cx, z - r.cz);
      r.order = { type: 'move', x, z, facing: f, target: -1, struct: -1 };
      if (run !== undefined) r.run = run;
      this.planPath(r, x, z);
    }
  }

  commandAttack(ids: number[], target: number, run?: boolean): void {
    const tr = this.regs[target];
    if (!tr) return;
    for (const id of ids) {
      const r = this.regs[id];
      if (!r || r.gone || r.routing || r.team === tr.team) continue;
      r.order = { type: 'attack', x: tr.mx, z: tr.mz, facing: r.facing, target, struct: -1 };
      if (run !== undefined) r.run = run;
      r.repathT = 0;
      if (r.ranged) r.fireTarget = target;
    }
  }

  commandAttackStruct(ids: number[], sid: number): void {
    const st = this.structs[sid];
    if (!st) return;
    for (const id of ids) {
      const r = this.regs[id];
      if (!r || r.gone || r.routing) continue;
      r.order = { type: 'attack', x: st.x, z: st.z, facing: r.facing, target: -1, struct: sid };
      r.run = true;
      this.planPath(r, st.x, st.z);
    }
  }

  commandHalt(ids: number[]): void {
    for (const id of ids) {
      const r = this.regs[id];
      if (!r || r.gone || r.routing) continue;
      r.order = { type: 'idle', x: r.cx, z: r.cz, facing: r.facing, target: -1, struct: -1 };
      r.path = [];
      r.fireTarget = -1;
    }
  }

  commandRetreat(ids: number[]): void {
    for (const id of ids) {
      const r = this.regs[id];
      if (!r || r.gone || r.routing) continue;
      const hq = this.teams[r.team].hq;
      const [hx, hz] = this.homeDir[r.team] ?? [0, 1];
      // 撤到本陣前方 35 m（朝敵方那一側），沒有本陣就往後撤 80 m
      const side = (this.rng() - 0.5) * 40;
      const tx = hq ? hq.x - hx * 35 + hz * side : r.mx + hx * 80;
      const tz = hq ? hq.z - hz * 35 - hx * side : r.mz + hz * 80;
      r.order = { type: 'retreat', x: tx, z: tz, facing: Math.atan2(-hx, -hz), target: -1, struct: -1 };
      r.run = true;
      this.planPath(r, tx, tz);
      for (const i of r.members) this.s.target[i] = -1;
    }
  }

  setFormation(ids: number[], f: Formation): void {
    for (const id of ids) {
      const r = this.regs[id];
      if (!r || r.gone) continue;
      r.formation = f;
      this.reslot(r);
    }
  }

  private planPath(r: Regiment, x: number, z: number): void {
    r.path = this.nav.findPath(r.cx, r.cz, x, z);
    r.pathI = 0;
    r.state = 'moving';
  }

  /** 潰逃方向：沿己方「後方」逃到地圖邊緣外 */
  retreatPoint(r: Regiment): [number, number] {
    const [dx, dz] = this.homeDir[r.team] ?? [0, r.team === 0 ? 1 : -1];
    const p = this.hf.play / 2 + 10;
    // 從目前位置沿後方方向延伸到邊界
    const tx = dx > 0 ? (p - r.mx) / dx : dx < 0 ? (-p - r.mx) / dx : Infinity;
    const tz = dz > 0 ? (p - r.mz) / dz : dz < 0 ? (-p - r.mz) / dz : Infinity;
    const t = Math.max(0, Math.min(tx, tz));
    return [r.mx + dx * t, r.mz + dz * t];
  }

  /** 面向最近的敵軍（沒有就面向敵方方向） */
  faceEnemy(r: Regiment): number {
    let best: Regiment | null = null;
    let bd = Infinity;
    for (const e of this.regs) {
      if (e.team === r.team || e.gone || e.routing) continue;
      const d = Math.hypot(e.mx - r.mx, e.mz - r.mz);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best) return Math.atan2(best.mx - r.mx, best.mz - r.mz);
    const [dx, dz] = this.homeDir[r.team] ?? [0, 1];
    return Math.atan2(-dx, -dz);
  }

  // ───────────────────────── 主迴圈 ─────────────────────────

  step(): void {
    if (this.over && this.t - (this.flags.endT as number) > 30) return;
    const dt = TICK;
    this.t += dt;
    this.tick++;
    const s = this.s;
    s.px.set(s.x.subarray(0, s.count));
    s.pz.set(s.z.subarray(0, s.count));
    s.pyaw.set(s.yaw.subarray(0, s.count));
    this.hash.rebuild(s);
    if (this.tick % 15 === 0) {
      this.updateNearEnemies();
      for (const r of this.regs) if (!r.gone) this.updateTerrain(r);
    }
    if (this.tick % 20 === 0) {
      for (const r of this.regs) {
        if (r.needReslot && !r.gone && !r.routing) this.reslot(r);
        r.needReslot = false;
      }
    }
    for (const r of this.regs) this.stepRegiment(r, dt);
    this.stepSoldiers(dt);
    this.separate();
    this.stepProjectiles();
    this.updateDying();
    if (this.tick % 3 === 0) this.stepMorale(dt * 3);
    if (this.tick % 30 === 0) {
      this.stepSupply(1);
      this.stepResupply();
      if (this.started) {
        this.stepStructures(1);
        this.stepCommand(1);
      }
      this.checkEnd();
      this.runTriggers();
      this.checkDuels();
      for (const r of this.regs) {
        r.engagedWith.clear();
        r.flankHits = 0;
        r.rearHits = 0;
      }
    }
    if (this.tick % 15 === 7) this.stepVision();
    this.stepWagons(dt);
  }

  // ───────────────────────── 軍團層 ─────────────────────────

  private updateNearEnemies(): void {
    for (const r of this.regs) {
      r.nearEnemies.length = 0;
      if (r.gone) continue;
      for (const e of this.regs) {
        if (e.team === r.team || e.gone || e.members.length === 0) continue;
        const d = Math.hypot(e.mx - r.mx, e.mz - r.mz);
        if (d < r.radius + e.radius + 30) r.nearEnemies.push(e.id);
      }
    }
  }

  speedOf(r: Regiment, run: boolean): number {
    const u = r.unit;
    let sp = run ? (r.stamina > 10 ? u.run : u.walk + (u.run - u.walk) * 0.5) : u.walk;
    sp *= SUPPLY_EFFECTS[this.supplyOf(r)].speed;
    if (r.stamina < 30) sp *= 0.8;
    if (r.formation === 'square') sp *= 0.85;
    sp *= r.buffMul('speed', this.t) * this.wx.speed;
    return sp;
  }

  private stepRegiment(r: Regiment, dt: number): void {
    if (r.gone) {
      if (r.state !== 'shattered' && r.state !== 'destroyed' && r.members.length === 0) r.state = 'destroyed';
      return;
    }
    const s = this.s;
    // 質心
    let mx = 0;
    let mz = 0;
    for (const i of r.members) {
      mx += s.x[i];
      mz += s.z[i];
    }
    r.mx = mx / r.members.length;
    r.mz = mz / r.members.length;
    r.radius = Math.max(r.frontage(), r.depth()) / 2 + 2;

    if (r.routing) {
      r.routT += dt;
      // 潰逃路線推進
      if (r.pathI < r.path.length && Math.hypot(r.path[r.pathI][0] - r.mx, r.path[r.pathI][1] - r.mz) < 14) r.pathI++;
      return;
    }
    if (!this.started) return;

    const o = r.order;
    let moving = false;
    let wantRun = r.run;
    let charging = false;
    if (o.type === 'attack' && o.target >= 0) {
      const tr = this.regs[o.target];
      // 目標消滅、或潰逃（只有騎兵會追擊潰兵）就停下
      if (!tr || tr.gone || (tr.routing && !r.unit.mounted)) {
        this.commandHalt([r.id]);
        return;
      }
      const d = Math.hypot(tr.mx - r.cx, tr.mz - r.cz);
      const face = Math.atan2(tr.mx - r.cx, tr.mz - r.cz);
      if (r.ranged && !r.unit.mounted) {
        r.fireTarget = tr.id;
        if (d > r.unit.ranged!.range * 0.9 * this.wx.range) moving = this.moveAnchorToward(r, tr.mx, tr.mz, dt, wantRun, 1.5);
        else r.path = [];
        this.turnToward(r, face, dt);
      } else {
        const contact = r.depth() / 2 + tr.depth() / 2 + (r.unit.mounted ? -2 : 1.2);
        if (r.unit.mounted && d < 80) {
          wantRun = r.run = true; // 衝鋒
          charging = true;
          if (this.t - r.chargeCallT > 20 && r.engagedWith.size === 0) {
            r.chargeCallT = this.t;
            this.events.push({ k: 'chargeStart', reg: r.id });
          }
        }
        if (d > contact) {
          moving = this.moveAnchorToward(r, tr.mx - Math.sin(face) * contact * 0.5, tr.mz - Math.cos(face) * contact * 0.5, dt, wantRun, 1.0);
          if (d < 40) this.turnToward(r, face, dt);
        } else {
          r.path = [];
          this.turnToward(r, face, dt * 0.5);
        }
        if (r.unit.ranged) r.fireTarget = tr.id;
      }
    } else if (o.type === 'attack' && o.struct >= 0) {
      const st = this.structs[o.struct];
      if (!st || st.burnt) {
        this.commandHalt([r.id]);
        return;
      }
      const d = Math.hypot(st.x - r.cx, st.z - r.cz);
      if (r.ranged) {
        // 弓弩：進入射程後原地射火矢
        if (d > r.unit.ranged!.range * 0.85) moving = this.moveAnchorToward(r, st.x, st.z, dt, wantRun, 2);
        else {
          r.path = [];
          this.turnToward(r, Math.atan2(st.x - r.cx, st.z - r.cz), dt);
        }
      } else if (d > st.radius * 0.6) moving = this.followPath(r, dt, true);
      else r.path = [];
    } else if (o.type === 'move' || o.type === 'retreat') {
      moving = this.followPath(r, dt, wantRun);
      if (!moving) {
        this.turnToward(r, o.facing, dt);
        if (Math.abs(angDiff(r.facing, o.facing)) < 0.05) {
          r.order = { type: 'idle', x: r.cx, z: r.cz, facing: r.facing, target: -1, struct: -1 };
          r.run = false;
        }
      }
    } else {
      // 待命：自動反應
      if (this.tick % 15 === r.id % 15) this.autoEngage(r);
    }
    // 遠程自由射擊
    if (r.ranged && r.fireAtWill && (o.type !== 'attack' || o.target < 0) && this.tick % 15 === (r.id + 5) % 15) {
      r.fireTarget = this.nearestEnemyInRange(r, r.unit.ranged!.range);
    }
    r.state = r.engagedWith.size > 0 ? 'engaged' : moving ? 'moving' : 'ready';
    // 體力
    const tireless = r.hasBuff('tireless', this.t);
    let ds = 0;
    if (r.engagedWith.size > 0) ds -= RULES.staminaFight;
    else if (moving) ds -= wantRun ? (r.unit.mounted ? (charging ? RULES.staminaCharge : RULES.staminaRunCav) : RULES.staminaRun) : RULES.staminaWalk;
    else ds += RULES.staminaRest * SUPPLY_EFFECTS[this.teams[r.team].supply].stamina * (r.inSupply ? 1.5 : 1);
    if (tireless && ds < 0) ds = 0;
    r.stamina = Math.max(0, Math.min(100, r.stamina + ds * dt));
  }

  private autoEngage(r: Regiment): void {
    if (r.hold && !r.ranged) {
      // 堅守：只打衝進來的
      return;
    }
    if (r.ranged) return;
    let best = -1;
    let bd = r.unit.mounted ? 0 : 28;
    for (const id of r.nearEnemies) {
      const e = this.regs[id];
      if (!this.isVisibleTo(e, r.team)) continue;
      const d = Math.hypot(e.mx - r.mx, e.mz - r.mz) - e.radius - r.radius;
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    // 被攻擊時一定反擊
    if (best < 0 && r.engagedWith.size > 0) best = [...r.engagedWith][0];
    if (best >= 0) this.commandAttack([r.id], best);
  }

  nearestEnemyInRange(r: Regiment, range: number): number {
    let best = -1;
    let bd = range;
    for (const e of this.regs) {
      if (e.team === r.team || e.gone || !this.isVisibleTo(e, r.team)) continue;
      const d = Math.hypot(e.mx - r.mx, e.mz - r.mz) - e.radius * 0.5;
      // 優先射沒在肉搏的
      const pen = e.engagedWith.size > 0 ? 25 : 0;
      if (d + pen < bd) {
        bd = d + pen;
        best = e.id;
      }
    }
    return best;
  }

  private turnToward(r: Regiment, f: number, dt: number): void {
    const rate = r.unit.mounted ? 1.4 : 0.9;
    const d = angDiff(r.facing, f);
    r.facing += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  private moveAnchorToward(r: Regiment, x: number, z: number, dt: number, run: boolean, repath: number): boolean {
    r.repathT -= dt;
    if (r.repathT <= 0 || Math.hypot(r.pathGoalX - x, r.pathGoalZ - z) > 12) {
      r.path = this.nav.findPath(r.cx, r.cz, x, z);
      r.pathI = 0;
      r.repathT = repath;
      r.pathGoalX = x;
      r.pathGoalZ = z;
    }
    return this.followPath(r, dt, run);
  }

  private followPath(r: Regiment, dt: number, run: boolean): boolean {
    if (r.pathI >= r.path.length) return false;
    const [tx, tz] = r.path[r.pathI];
    const dx = tx - r.cx;
    const dz = tz - r.cz;
    const d = Math.hypot(dx, dz);
    // 陣型凝聚度：士兵跟不上就放慢
    let sp = this.speedOf(r, run) * this.nav.speedAt(r.cx, r.cz);
    sp *= r.cohesion < 0.5 ? 0.35 : r.cohesion < 0.8 ? 0.7 : 1;
    const step = sp * dt;
    if (d <= step || d < 0.5) {
      r.cx = tx;
      r.cz = tz;
      r.pathI++;
      return r.pathI < r.path.length;
    }
    r.cx += (dx / d) * step;
    r.cz += (dz / d) * step;
    // 長距離移動：陣型轉向行進方向
    const remain = this.pathRemain(r);
    const heading = Math.atan2(dx, dz);
    const goalF = r.order.type === 'move' || r.order.type === 'retreat' ? r.order.facing : heading;
    this.turnToward(r, remain > 25 ? heading : goalF, dt);
    return true;
  }

  private pathRemain(r: Regiment): number {
    let d = 0;
    let px = r.cx;
    let pz = r.cz;
    for (let k = r.pathI; k < r.path.length; k++) {
      d += Math.hypot(r.path[k][0] - px, r.path[k][1] - pz);
      px = r.path[k][0];
      pz = r.path[k][1];
    }
    return d;
  }

  /** 依目前位置重新分配陣位（傷亡後補位） */
  reslot(r: Regiment): void {
    const s = this.s;
    const ids = r.members.filter((i) => !s.general[i]);
    const c = Math.cos(r.facing);
    const sn = Math.sin(r.facing);
    // 區域座標：前方 lz、側向 lx
    const local = ids.map((i) => {
      const dx = s.x[i] - r.cx;
      const dz = s.z[i] - r.cz;
      return { i, lx: dx * c - dz * sn, lz: dx * sn + dz * c };
    });
    const n = ids.length;
    const slots = Array.from({ length: n }, (_, k) => {
      r.slotLocal(k, n, _slot);
      return { k, lx: _slot[0], lz: _slot[1] };
    });
    // 依前後排序，同排依左右排序（近似最小移動）
    const w = Math.max(1, Math.min(r.width, n));
    local.sort((a, b) => b.lz - a.lz);
    slots.sort((a, b) => b.lz - a.lz || a.lx - b.lx);
    for (let row = 0; row < n; row += w) {
      const sl = slots.slice(row, row + w).sort((a, b) => a.lx - b.lx);
      const lo = local.slice(row, row + w).sort((a, b) => a.lx - b.lx);
      for (let k = 0; k < lo.length; k++) s.slot[lo[k].i] = sl[k].k;
    }
  }

  // ───────────────────────── 士兵層 ─────────────────────────

  private cohSum = new Float32Array(0);
  private cohN = new Int32Array(0);

  private stepSoldiers(dt: number): void {
    const s = this.s;
    if (this.cohSum.length < this.regs.length) {
      this.cohSum = new Float32Array(this.regs.length + 16);
      this.cohN = new Int32Array(this.regs.length + 16);
    }
    const cohesionSum = this.cohSum;
    const cohesionN = this.cohN;
    cohesionSum.fill(0);
    cohesionN.fill(0);
    for (let i = 0; i < s.count; i++) {
      if (s.state[i] !== SState.Alive) continue;
      const r = this.regs[s.reg[i]];
      const u = r.unit;
      const gen = s.general[i] === 1;
      if (s.stun[i] > 0) {
        s.stun[i] -= dt;
        s.vx[i] *= 0.8;
        s.vz[i] *= 0.8;
        continue;
      }
      s.cd[i] -= dt;
      s.chargeCd[i] -= dt;
      s.fighting[i] = 0;
      let tx: number;
      let tz: number;
      let maxSp = this.speedOf(r, r.run);
      let faceTo = r.facing;
      let wantFace = false;

      if (r.routing) {
        // 潰逃：沿逃跑路線（各自散開一點），走完就往地圖外跑
        if (r.retreatHome) {
          // 撤退的武將：單騎沿路線回本陣，到了就離場
          while (r.pathI < r.path.length && Math.hypot(r.path[r.pathI][0] - s.x[i], r.path[r.pathI][1] - s.z[i]) < 5) r.pathI++;
          if (r.pathI >= r.path.length) {
            this.soldierGone(i);
            continue;
          }
          tx = r.path[r.pathI][0];
          tz = r.path[r.pathI][1];
        } else if (r.pathI < r.path.length) {
          const [wx, wz] = r.path[r.pathI];
          tx = wx + (s.tint[i] - 0.5) * 16;
          tz = wz + (((s.tint[i] * 7.7) % 1) - 0.5) * 16;
        } else {
          const [fx, fz] = this.retreatPoint(r);
          tx = fx + (s.tint[i] - 0.5) * 40;
          tz = fz + (((s.tint[i] * 7.7) % 1) - 0.5) * 40;
        }
        maxSp = u.run * 0.95 * (0.85 + s.tint[i] * 0.3);
        if (!this.hf.inPlay(s.x[i], s.z[i], 8)) {
          this.soldierGone(i);
          continue;
        }
      } else {
        // 陣位
        const n = r.members.length - (r.general?.alive ? 1 : 0);
        if (gen) {
          tx = r.cx + Math.sin(r.facing) * (r.depth(n) / 2 * 0.2);
          tz = r.cz + Math.cos(r.facing) * (r.depth(n) / 2 * 0.2);
        } else {
          r.slotWorld(Math.min(s.slot[i], n - 1), n, _slot);
          // 站位微偏移（±0.18 m），陣形不再像棋盤一樣死板
          const jx = (s.tint[i] - 0.5) * 0.36;
          const jz = (((s.tint[i] * 13.7) % 1) - 0.5) * 0.36;
          tx = _slot[0] + jx;
          tz = _slot[1] + jz;
        }
        // 陣位落在河裡、懸崖等不可走處：往軍團中心收攏（過淺灘、橋時自動變縱隊）
        if (!this.nav.passable(tx, tz)) {
          let ok = false;
          for (const k of [0.6, 0.35, 0.15]) {
            const qx = r.cx + (tx - r.cx) * k;
            const qz = r.cz + (tz - r.cz) * k;
            if (this.nav.passable(qx, qz)) {
              tx = qx;
              tz = qz;
              ok = true;
              break;
            }
          }
          if (!ok) {
            tx = r.cx;
            tz = r.cz;
          }
        }
        const slotX = tx;
        const slotZ = tz;
        const sd = Math.hypot(s.x[i] - slotX, s.z[i] - slotZ);
        cohesionSum[r.id] += sd;
        cohesionN[r.id]++;
        // 近戰目標（部署階段不打）
        const tgt = this.started ? this.meleeTarget(i, r, slotX, slotZ) : -1;
        if (tgt >= 0) {
          const ex = s.x[tgt];
          const ez = s.z[tgt];
          const d = Math.hypot(ex - s.x[i], ez - s.z[i]);
          faceTo = Math.atan2(ex - s.x[i], ez - s.z[i]);
          wantFace = true;
          const reach = u.reach + (s.general[tgt] ? 0.6 : 0) + (UNITS[this.regs[s.reg[tgt]].type].mounted ? 0.5 : 0);
          if (d > reach * 0.9) {
            tx = ex;
            tz = ez;
            // 騎兵：遠處全速衝，貼近後減速纏鬥（不會一直繞圈、讓步兵砍不到）
            maxSp = u.mounted && r.run && d > 6 ? this.speedOf(r, true) : u.mounted ? u.walk * 1.2 : u.run * 0.8;
          } else {
            tx = s.x[i];
            tz = s.z[i];
            s.fighting[i] = 1;
            this.meleeStrike(i, tgt, r);
          }
        } else if (sd > 4) {
          maxSp = Math.max(maxSp, this.speedOf(r, true) * 0.95);
        }
        // 遠程射擊
        if (u.ranged && tgt < 0) this.rangedStep(i, r, dt);
      }

      // 轉向與移動
      let dx = tx - s.x[i];
      let dz = tz - s.z[i];
      const d = Math.hypot(dx, dz);
      let dvx = 0;
      let dvz = 0;
      if (d > 0.15) {
        // 騎兵衝鋒中朝敵人全速撞上去（不做到達減速）
        const charging = u.mounted && r.run && r.order.type === 'attack' && s.target[i] >= 0 && d > 6;
        const sp = charging ? maxSp : Math.min(maxSp, d * (u.mounted ? 1.2 : 2.5));
        dvx = (dx / d) * sp;
        dvz = (dz / d) * sp;
      }
      const acc = (u.mounted ? 3.5 : 8) * dt;
      s.vx[i] += (dvx - s.vx[i]) * Math.min(1, acc);
      s.vz[i] += (dvz - s.vz[i]) * Math.min(1, acc);
      const terr = this.nav.speedAt(s.x[i], s.z[i]);
      let nx = s.x[i] + s.vx[i] * dt * terr;
      let nz = s.z[i] + s.vz[i] * dt * terr;
      if (!this.nav.passable(nx, nz) && this.nav.passable(s.x[i], s.z[i])) {
        if (this.nav.passable(nx, s.z[i])) nz = s.z[i];
        else if (this.nav.passable(s.x[i], nz)) nx = s.x[i];
        else {
          nx = s.x[i];
          nz = s.z[i];
          s.vx[i] *= 0.3;
          s.vz[i] *= 0.3;
        }
      }
      s.x[i] = nx;
      s.z[i] = nz;
      const speed = Math.hypot(s.vx[i], s.vz[i]);
      // 衝鋒撞擊
      if (u.mounted && speed > RULES.chargeMinSpeed && s.chargeCd[i] <= 0 && !r.routing) this.chargeImpact(i, r, speed);
      // 朝向
      if (!wantFace && speed > 0.5) faceTo = Math.atan2(s.vx[i], s.vz[i]);
      const turn = (u.mounted ? 3 : 7) * dt;
      s.yaw[i] += Math.max(-turn, Math.min(turn, angDiff(s.yaw[i], faceTo)));
      // 動作
      this.pickAnim(i, r, speed);
      void dx;
      void dz;
      dx = dz = 0;
    }
    for (const r of this.regs) {
      if (cohesionN[r.id] > 0) {
        const avg = cohesionSum[r.id] / cohesionN[r.id];
        r.cohesion = avg < 2 ? 1 : avg < 5 ? 0.75 : avg < 10 ? 0.45 : 0.25;
      }
    }
  }

  private pickAnim(i: number, r: Regiment, speed: number): void {
    const s = this.s;
    const t = this.t;
    const u = r.unit;
    const slow = this.supplyOf(r) === 'starving' ? 0.85 : 1;
    if (r.routing) return s.setAnim(i, 'flee', t, 1);
    if (s.fighting[i]) return; // 攻擊動作在出手時設定
    if (s.anim[i] === 4 && t - s.animStart[i] < ANIMS.shoot.dur / Math.max(0.1, s.animSpeed[i])) return; // 射擊中
    if (s.anim[i] === 3 && t - s.animStart[i] < ANIMS.attack.dur / Math.max(0.1, s.animSpeed[i])) return; // 揮砍中
    // 勝利：停著的士兵舉兵器歡呼
    if (this.over && r.team === this.winner && speed < 0.35) return s.setAnim(i, 'cheer', t, 0.8 + s.tint[i] * 0.4);
    if (speed > u.walk * 1.25) s.setAnim(i, 'run', t, (speed / u.run) * slow);
    else if (speed > 0.35) s.setAnim(i, 'walk', t, Math.max(0.5, speed / u.walk) * slow);
    else if (r.hold && r.type === 'spear' && !r.routing) s.setAnim(i, 'brace', t, 1);
    else s.setAnim(i, 'idle', t, slow);
  }

  /** 為士兵挑選近戰目標（每 0.3 秒左右重找一次） */
  private meleeTarget(i: number, r: Regiment, slotX: number, slotZ: number): number {
    const s = this.s;
    let tg = s.target[i];
    if (tg >= 0) {
      const ok = s.state[tg] === SState.Alive && s.team[tg] !== s.team[i] && Math.hypot(s.x[tg] - slotX, s.z[tg] - slotZ) < RULES.tether + (r.unit.mounted ? 6 : 0);
      if (!ok) tg = s.target[i] = -1;
    }
    if (r.nearEnemies.length === 0 || r.order.type === 'retreat') {
      s.target[i] = -1;
      return -1;
    }
    if (tg >= 0 && (this.tick + i) % 20 !== 0) return tg;
    // 重找：攻擊命令時範圍較大；移動中只自衛。步兵只有前兩排主動出擊，後排只打貼身的敵人（戰線才像戰線）
    const attacking = r.order.type === 'attack' || r.order.type === 'idle';
    const row = r.formation === 'wedge' || r.unit.mounted || s.general[i] ? 0 : Math.floor(Math.max(0, s.slot[i]) / Math.max(1, r.width));
    const front = row < 2 || r.formation === 'loose';
    const rad = attacking && front ? RULES.engageRadius + (r.unit.mounted ? 3 : 0) : 2.2;
    const n = this.hash.near(s.x[i], s.z[i], rad);
    let best = -1;
    let bd = rad * rad;
    const team = s.team[i];
    const res = this.hash.res;
    const prefer = r.order.type === 'attack' ? r.order.target : -1;
    for (let k = 0; k < n; k++) {
      const j = res[k];
      if (s.team[j] === team || s.state[j] !== SState.Alive) continue;
      const dx = s.x[j] - s.x[i];
      const dz = s.z[j] - s.z[i];
      let d2 = dx * dx + dz * dz;
      if (prefer >= 0 && s.reg[j] !== prefer) d2 *= 1.6;
      if (d2 < bd) {
        bd = d2;
        best = j;
      }
    }
    s.target[i] = best;
    return best;
  }

  private meleeStrike(i: number, j: number, r: Regiment): void {
    const s = this.s;
    if (s.cd[i] > 0) return;
    const u = r.unit;
    const er = this.regs[s.reg[j]];
    const eu = er.unit;
    const t = this.t;
    s.cd[i] = u.rate * (0.85 + this.rng() * 0.3) / (r.stamina < 30 ? 0.85 : 1);
    // 揮砍動作：讓出手瞬間對齊動作的打擊點
    const dur = s.cd[i];
    s.setAnim(i, 'attack', t, ANIMS.attack.dur / dur, true, t - 0.45 * dur);
    r.lastCombatT = er.lastCombatT = t;
    r.engagedWith.add(er.id);
    er.engagedWith.add(r.id);
    // 方位：攻擊者在防守軍團陣形的哪一面（區域座標：前方 +lz、側向 lx）
    const fc = Math.cos(er.facing);
    const fs = Math.sin(er.facing);
    const ox = s.x[i] - er.mx;
    const oz = s.z[i] - er.mz;
    const lx = ox * fc - oz * fs;
    const lz = ox * fs + oz * fc;
    const halfW = er.frontage() / 2;
    const halfD = er.depth() / 2;
    const rearHit = lz < -halfD * 0.4 && !er.unit.mounted;
    const flankHit = !rearHit && Math.abs(lx) > halfW + 0.5 && lz < halfD * 0.4 && !er.unit.mounted;
    const rel = rearHit ? 3 : flankHit ? 1.5 : 0;
    const side = er.formation === 'square' ? 0.5 : 1;
    // 方向防禦：正面有盾牌與兵器擋著（各兵種 front），側面 ×1.4、背後 ×2
    let dirMul = eu.front;
    if (rearHit) {
      dirMul = 1 + (RULES.rearMul - 1) * side;
      er.rearHits++;
    } else if (flankHit && !er.hasBuff('steady', t) && !er.buffs.some((b) => b.id === 'swift' && b.until > t)) {
      dirMul = 1 + (RULES.flankMul - 1) * side;
      er.flankHits++;
    }
    // 武將本人（撤退中的武將已離開原軍團，用一般數值）
    const atk = (s.general[i] && r.general ? 10 + (GENERALS[r.general.id].war - 50) * 0.5 : u.atk) * r.buffMul('atk', t);
    const def = (s.general[j] && er.general ? 14 + (GENERALS[er.general.id].war - 50) * 0.3 : eu.def) * er.buffMul('def', t) * (er.formation === 'loose' ? 0.8 : 1);
    let hit = RULES.hitBase + (atk - def) * RULES.hitPerPoint;
    // 森林：步兵防守有樹木掩護
    if (er.terrain.forest && !eu.mounted) hit -= RULES.forestDef;
    if (s.stun[j] > 0) hit += 0.3;
    if (rel > 2.2) hit += 0.15;
    hit = Math.max(0.1, Math.min(0.92, hit));
    if (this.rng() > hit) {
      if (this.rng() < 0.15) this.events.push({ k: 'clash', x: s.x[j], z: s.z[j] });
      return;
    }
    let dmg = atk * RULES.meleeDmg * (0.8 + this.rng() * 0.4) * dirMul;
    const cm = counterMul(u, eu);
    if (cm > 1.05) {
      er.counterHitT = r.counterDealT = t;
      er.counterHitMul = r.counterDealMul = cm;
    }
    dmg *= cm;
    dmg *= this.moraleAtkMul(r) * SUPPLY_EFFECTS[this.supplyOf(r)].atk;
    if (this.teams[r.team].panicUntil > t) dmg *= RULES.panicAtk;
    dmg *= this.teamAtk[r.team];
    if (r.stamina < 30) dmg *= 0.85;
    // 地形：高低差、涉水（半渡而擊）、森林中的騎兵、己方營寨
    dmg *= this.heightMul(this.hf.height(s.x[i], s.z[i]), this.hf.height(s.x[j], s.z[j]));
    if (this.isWet(s.x[j], s.z[j])) dmg *= 1 + RULES.fordDef;
    if (this.isWet(s.x[i], s.z[i])) dmg *= RULES.fordAtk;
    if (u.mounted && r.terrain.forest) dmg *= RULES.forestCavAtk;
    if (er.terrain.camp) dmg *= 1 - RULES.campDef;
    if (this.rng() < 0.25) this.events.push({ k: 'clash', x: s.x[j], z: s.z[j] });
    this.damage(j, dmg, i);
  }

  /** 士氣 → 攻擊倍率（士氣不會讓部隊潰逃，只影響戰力） */
  moraleAtkMul(r: Regiment): number {
    if (r.morale >= RULES.highThreshold) return 1.1;
    if (r.morale < RULES.brokenThreshold) return 0.9;
    if (r.morale < RULES.lowThreshold) return 0.95;
    return 1;
  }

  /** 士氣 → 受到傷害倍率 */
  moraleTakenMul(r: Regiment): number {
    if (r.morale < RULES.brokenThreshold) return 1.2;
    if (r.morale < RULES.lowThreshold) return 1.1;
    return 1;
  }

  /** 受到傷害總倍率：士氣＋糧況 */
  takenMul(r: Regiment): number {
    return this.moraleTakenMul(r) * SUPPLY_EFFECTS[this.supplyOf(r)].taken;
  }

  private chargeImpact(i: number, r: Regiment, speed: number): void {
    const s = this.s;
    const fx = Math.sin(s.yaw[i]);
    const fz = Math.cos(s.yaw[i]);
    const n = this.hash.near(s.x[i] + fx * 1.4, s.z[i] + fz * 1.4, 1.6);
    const res = this.hash.res;
    const team = s.team[i];
    const t = this.t;
    for (let k = 0; k < n; k++) {
      const j = res[k];
      if (s.team[j] === team || s.state[j] !== SState.Alive) continue;
      const dx = s.x[j] - s.x[i];
      const dz = s.z[j] - s.z[i];
      const d = Math.hypot(dx, dz);
      if (d > 2.2 || (dx * fx + dz * fz) / (d || 1) < 0.3) continue;
      const er = this.regs[s.reg[j]];
      s.chargeCd[i] = RULES.chargeRecharge;
      // 拒馬：堅守的長槍兵正面
      const front = Math.abs(angDiff(s.yaw[j], Math.atan2(-dx, -dz))) < 1.1;
      if (er.type === 'spear' && er.hold && front) {
        this.damage(i, r.unit.charge * RULES.braceReflect * (speed / r.unit.run), j);
        s.vx[i] *= 0.1;
        s.vz[i] *= 0.1;
        s.stun[i] = 0.8;
        if (t - er.chargeShockT > 3) {
          er.chargeShockT = t;
          r.morale -= 6;
          this.events.push({ k: 'charge', reg: er.id, x: s.x[j], z: s.z[j] });
        }
        return;
      }
      // 坡度：下坡衝鋒更猛、上坡衝鋒乏力；森林、涉水中衝不起來
      const grade = (this.hf.height(s.x[i] + fx * 6, s.z[i] + fz * 6) - this.hf.height(s.x[i], s.z[i])) / 6;
      const slopeMul = grade < 0 ? 1 + Math.min(RULES.chargeDownhill, -grade * 3) : 1 - Math.min(RULES.chargeUphill, grade * 3);
      const terrMul = slopeMul * (this.nav.forestAt(s.x[i], s.z[i]) > 0.45 ? RULES.forestCharge : 1) * (this.isWet(s.x[i], s.z[i]) ? 0.5 : 1);
      const mul = (r.formation === 'wedge' ? 1.3 : 1) * r.buffMul('atk', t) * (speed / r.unit.run) * terrMul;
      let dmg = r.unit.charge * 2.2 * mul * (0.8 + this.rng() * 0.4) * this.teamAtk[r.team];
      if (er.unit.mounted) dmg *= 0.6;
      // 騎兵衝進弓弩陣：相剋
      if (er.unit.cls === 'missile') {
        dmg *= RULES.chargeVsMissile;
        er.counterHitT = r.counterDealT = t;
        er.counterHitMul = r.counterDealMul = RULES.cavVsMissile;
      }
      // 正面迎擊的步兵陣列：衝擊力被分散（側面、背後衝鋒仍是全力）
      const frontMul = front && !er.unit.mounted && er.unit.cls !== 'missile' ? RULES.chargeFrontMul : 1;
      dmg *= frontMul;
      if (s.general[j]) dmg *= 0.4;
      this.damage(j, dmg, i);
      if (s.state[j] === SState.Alive && !s.general[j]) s.stun[j] = frontMul < 1 ? 0.3 + this.rng() * 0.3 : 0.8 + this.rng() * 0.6;
      // 推開
      if (this.nav.passable(s.x[j] + fx * 0.8, s.z[j] + fz * 0.8)) {
        s.x[j] += fx * 0.8;
        s.z[j] += fz * 0.8;
      }
      s.vx[i] *= 0.6;
      s.vz[i] *= 0.6;
      r.engagedWith.add(er.id);
      er.engagedWith.add(r.id);
      r.lastCombatT = er.lastCombatT = t;
      if (t - er.chargeShockT > 4) {
        er.chargeShockT = t;
        if (!er.hasBuff('steady', t)) er.morale -= RULES.chargeShock * (er.formation === 'square' ? 0.5 : 1) * this.teamGrit[er.team] * (frontMul < 1 ? 0.7 : 1);
        this.events.push({ k: 'charge', reg: er.id, x: s.x[j], z: s.z[j] });
      }
      return;
    }
  }

  private rangedStep(i: number, r: Regiment, dt: number): void {
    if (!this.started) return;
    const s = this.s;
    const rd = r.unit.ranged!;
    s.reload[i] -= dt * (r.stamina < 30 ? 0.8 : 1);
    if (s.reload[i] > 0 || s.ammo[i] <= 0) return;
    // 射建築（火矢）
    if (r.order.type === 'attack' && r.order.struct >= 0) {
      const st = this.structs[r.order.struct];
      const dist0 = Math.hypot(st.x - s.x[i], st.z - s.z[i]);
      if (!st.burnt && dist0 < rd.range * 1.05 * this.wx.range && Math.hypot(s.vx[i], s.vz[i]) < 0.6) {
        const a = this.rng() * Math.PI * 2;
        const rr = Math.sqrt(this.rng()) * st.radius * 0.7;
        const ax = st.x + Math.cos(a) * rr;
        const az = st.z + Math.sin(a) * rr;
        const dur = rd.arc === 'flat' ? 0.12 + dist0 / 85 : 0.9 + dist0 / 48;
        const p = this.proj.spawn(s.x[i], this.groundY(s.x[i], s.z[i]) + 1.5, s.z[i], ax, this.groundY(ax, az) + 2, az, this.t, dur, rd.arc === 'flat' ? 2 : 8 + dist0 * 0.22, s.team[i], rd.dmg, rd.ap, this.sc.weather !== 'rain', r.id);
        if (p >= 0) this.events.push({ k: 'arrow', p });
        s.ammo[i]--;
        s.reload[i] = rd.reload * (0.85 + this.rng() * 0.3);
        s.yaw[i] = Math.atan2(st.x - s.x[i], st.z - s.z[i]);
        const animDur = Math.min(s.reload[i], ANIMS.shoot.dur * 1.2);
        s.setAnim(i, 'shoot', this.t, ANIMS.shoot.dur / animDur, true, this.t - 0.63 * animDur);
        r.lastFireT = this.t;
      }
      return;
    }
    if (r.fireTarget < 0) return;
    const moving = Math.hypot(s.vx[i], s.vz[i]) > 0.6;
    if (moving && !r.unit.mounted) return;
    const tr = this.regs[r.fireTarget];
    if (!tr || tr.gone) {
      r.fireTarget = -1;
      return;
    }
    // 挑目標軍團的隨機一名
    const j = tr.members[(this.rng() * tr.members.length) | 0];
    const dx = s.x[j] - s.x[i];
    const dz = s.z[j] - s.z[i];
    const dist = Math.hypot(dx, dz);
    // 居高臨下：射程最多 +25%（仰射則縮短）
    const dh = this.hf.height(s.x[i], s.z[i]) - this.hf.height(s.x[j], s.z[j]);
    const hiBonus = 1 + Math.max(-0.15, Math.min(RULES.rangeMax, dh * RULES.rangePerMeter));
    if (dist > rd.range * hiBonus * this.wx.range) return;
    const flat = rd.arc === 'flat';
    const dur = flat ? 0.12 + dist / 85 : 0.9 + dist / 48;
    // 前置量＋散布
    const spread = dist * (flat ? 0.03 : 0.06) * (r.stamina < 30 ? 1.3 : 1) * this.wx.scatter;
    const ax = s.x[j] + s.vx[j] * dur + this.gauss() * spread;
    const az = s.z[j] + s.vz[j] * dur + this.gauss() * spread;
    const sy = this.groundY(s.x[i], s.z[i]) + 1.5;
    const ty = this.groundY(ax, az) + 0.9;
    const p = this.proj.spawn(s.x[i], sy, s.z[i], ax, ty, az, this.t, dur, flat ? Math.max(0.5, dist * 0.02) : 8 + dist * 0.22, s.team[i], rd.dmg * r.buffMul('atk', this.t) * SUPPLY_EFFECTS[this.supplyOf(r)].atk * this.moraleAtkMul(r) * this.teamAtk[r.team] * this.wx.rangedDmg, rd.ap, r.fireArrows && this.sc.weather !== 'rain', r.id);
    if (p >= 0) this.events.push({ k: 'arrow', p });
    s.ammo[i]--;
    s.reload[i] = rd.reload * (0.85 + this.rng() * 0.3);
    s.yaw[i] = Math.atan2(dx, dz);
    // 射擊動作：放箭時刻對齊
    const animDur = Math.min(s.reload[i], ANIMS.shoot.dur * 1.2);
    s.setAnim(i, 'shoot', this.t, ANIMS.shoot.dur / animDur, true, this.t - 0.63 * animDur);
    r.lastFireT = this.t;
  }

  private gauss(): number {
    return (this.rng() + this.rng() + this.rng() - 1.5) * 1.15;
  }

  private stepProjectiles(): void {
    const p = this.proj;
    const s = this.s;
    for (let k = 0; k < p.cap; k++) {
      if (!p.active[k]) continue;
      if (this.t < p.t0[k] + p.dur[k]) continue;
      p.active[k] = 0;
      const x = p.tx[k];
      const z = p.tz[k];
      // 落點命中
      const n = this.hash.near(x, z, 1.2);
      const res = this.hash.res;
      let best = -1;
      let bd = 0.85 * 0.85;
      for (let q = 0; q < n; q++) {
        const j = res[q];
        if (s.state[j] !== SState.Alive) continue;
        const r2 = (s.x[j] - x) ** 2 + (s.z[j] - z) ** 2;
        const rr = UNITS[this.regs[s.reg[j]].type].mounted ? 1.6 : 0.85;
        if (r2 < Math.max(bd, rr * rr) && r2 < rr * rr) {
          bd = r2;
          best = j;
        }
      }
      let hit = 0;
      if (best >= 0) {
        const er = this.regs[s.reg[best]];
        const eu = er.unit;
        // 箭傷兩極：兩成是致命傷（×5），其餘輕傷（×0.5）
        let dmg = p.dmg[k] * (this.rng() < 0.2 ? 5 : 0.5) * RULES.rangedMul;
        const armor = (s.general[best] ? 15 : eu.def) * (1 - p.ap[k]);
        dmg *= 1 - Math.min(0.6, armor * 0.03);
        // 盾牌正面擋箭：機率整支擋下（弩箭破甲較能穿盾）
        const fromA = Math.atan2(p.sx[k] - x, p.sz[k] - z);
        const front = Math.abs(angDiff(s.yaw[best], fromA)) < 1.0;
        let shielded = false;
        if (front && eu.shield > 0 && !s.fighting[best] && this.rng() < eu.shield * (1 - p.ap[k] * 0.5)) {
          dmg = 0;
          shielded = true;
        }
        if (er.formation === 'loose') dmg *= 0.6;
        // 射剋槍：長槍兵沒有盾、陣形密集
        if (eu.cls === 'pole' && p.team[k] !== s.team[best]) {
          dmg *= RULES.missileVsPole;
          er.counterHitT = this.t;
          er.counterHitMul = RULES.missileVsPole;
          const shooter = this.regs[p.reg[k]];
          if (shooter) {
            shooter.counterDealT = this.t;
            shooter.counterDealMul = RULES.missileVsPole;
          }
        }
        if (this.nav.forestAt(x, z) > 0.4) dmg *= 1 - RULES.forestArrow;
        if (s.team[best] === p.team[k]) dmg *= RULES.friendlyFireMul;
        er.arrowsTaken++;
        hit = shielded ? 2 : 1;
        if (dmg > 0) this.damage(best, dmg, -1, p.reg[k]);
      }
      if (p.fire[k]) this.fireArrowLand(x, z, p.team[k]);
      this.events.push({ k: 'impact', x, z, hit, fire: !!p.fire[k] });
    }
  }

  /** 傷害：可能致死 */
  /** 傷害：可能致死（byReg：箭矢等遠程來源的軍團，用來記戰功） */
  damage(j: number, dmg: number, by: number, byReg = -1): void {
    const s = this.s;
    if (s.state[j] !== SState.Alive) return;
    const reg = this.regs[s.reg[j]];
    // 戰鬥傷害：士氣低落、斷糧時受傷更重
    if (by >= 0 || byReg >= 0) dmg *= this.takenMul(reg);
    // 親衛護主：武將身邊還有親衛時，受到的傷害減半
    if (s.general[j] && reg.general && reg.alive > 3) dmg *= 0.5;
    s.hp[j] -= dmg;
    if (s.hp[j] > 0) {
      // 武將重傷 → 撤退（不是陣亡）
      if (s.general[j] && reg.general?.alive && !reg.unbreakable && s.hp[j] < s.maxHp[j] * RULES.generalRetreatHp) this.retreatGeneral(reg);
      return;
    }
    // 戰功
    const killer = by >= 0 ? s.reg[by] : byReg;
    if (killer >= 0 && this.regs[killer] && this.regs[killer].team !== s.team[j]) this.regs[killer].kills++;
    // 死亡
    s.state[j] = SState.Dying;
    s.deathT[j] = this.t;
    s.vx[j] = s.vz[j] = 0;
    if (by >= 0) s.yaw[j] = Math.atan2(s.x[by] - s.x[j], s.z[by] - s.z[j]);
    s.setAnim(j, this.rng() < 0.5 ? 'die' : 'die2', this.t, 0.85 + this.rng() * 0.3, true, this.t);
    const r = this.regs[s.reg[j]];
    const idx = r.members.indexOf(j);
    if (idx >= 0) r.members.splice(idx, 1);
    r.lostThisTick++;
    r.losses.push(this.t);
    this.teams[r.team].dead++;
    if (s.general[j] && r.general) {
      r.general.alive = false;
      this.onGeneralDown(r);
    }
    if (r.members.length === 0) r.state = 'destroyed';
    else r.needReslot = true;
  }

  private soldierGone(i: number): void {
    const s = this.s;
    s.state[i] = SState.Gone;
    const r = this.regs[s.reg[i]];
    const idx = r.members.indexOf(i);
    if (idx >= 0) r.members.splice(idx, 1);
    r.fled++;
    this.teams[r.team].fled++;
    if (s.general[i] && r.general) {
      r.general.alive = false;
      r.general.fled = true;
    }
    if (r.members.length === 0) r.state = r.state === 'shattered' || r.routing ? 'shattered' : 'destroyed';
  }

  private updateDying(): void {
    const s = this.s;
    for (let i = 0; i < s.count; i++) {
      if (s.state[i] === SState.Dying && this.t - s.deathT[i] > 1.6) {
        s.state[i] = SState.Dead;
        this.events.push({ k: 'corpse', i });
      }
    }
  }

  private separate(): void {
    const s = this.s;
    const res = this.hash.res;
    for (let i = 0; i < s.count; i++) {
      if (s.state[i] !== SState.Alive) continue;
      const mi = this.regs[s.reg[i]].unit.mounted;
      const ri = mi ? 0.95 : 0.4;
      const n = this.hash.near(s.x[i], s.z[i], 2.2);
      let pushX = 0;
      let pushZ = 0;
      for (let k = 0; k < n; k++) {
        const j = res[k];
        if (j === i || s.state[j] !== SState.Alive) continue;
        const mj = this.regs[s.reg[j]].unit.mounted;
        const min = ri + (mj ? 0.95 : 0.4);
        const dx = s.x[i] - s.x[j];
        const dz = s.z[i] - s.z[j];
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        // 騎兵質量大，被推得少
        const w = mi && !mj ? 0.25 : !mi && mj ? 0.75 : 0.5;
        const push = ((min - d) / d) * w * 0.6;
        pushX += dx * push;
        pushZ += dz * push;
      }
      if (pushX || pushZ) {
        const nx = s.x[i] + pushX;
        const nz = s.z[i] + pushZ;
        if (this.nav.passable(nx, nz)) {
          s.x[i] = nx;
          s.z[i] = nz;
        }
      }
    }
  }

  // ───────────────────────── 士氣 ─────────────────────────

  private stepMorale(dt: number): void {
    const t = this.t;
    for (const r of this.regs) {
      if (r.gone) continue;
      const team = this.teams[r.team];
      const eff = SUPPLY_EFFECTS[this.supplyOf(r)];
      const steady = r.hasBuff('steady', t);
      let dm = 0;
      // 傷亡
      if (r.lostThisTick > 0) {
        const pct = (r.lostThisTick / r.initial) * 100;
        dm -= pct * RULES.moralePerLossPct;
        r.lostThisTick = 0;
      }
      while (r.losses.length && r.losses[0] < t - 10) r.losses.shift();
      if (r.losses.length > r.initial * RULES.heavyLossPct && !r.flagsHeavy) {
        dm -= RULES.heavyLossShock;
        r.flagsHeavy = true;
      } else if (r.losses.length < r.initial * 0.05) r.flagsHeavy = false;
      // 側擊、背襲
      if (r.flankHits > 0) dm -= RULES.flankDrain * dt * Math.min(1, r.flankHits / 6);
      if (r.rearHits > 0) dm -= RULES.rearDrain * dt * Math.min(1, r.rearHits / 6);
      // 箭雨
      if (r.arrowsTaken > 0) {
        dm -= Math.min(2, r.arrowsTaken * 0.06) * RULES.arrowMoraleHit;
        r.arrowsTaken = 0;
      }
      // 肉搏壓力＋局部劣勢
      if (r.engagedWith.size > 0) {
        let enemy = 0;
        for (const id of r.engagedWith) enemy += this.regs[id].alive;
        const ratio = enemy / Math.max(1, r.alive);
        dm -= RULES.meleeDrain * Math.min(2.5, Math.max(0.4, ratio)) * dt;
        if (enemy > r.alive * 2) dm -= RULES.outnumberDrain * dt;
      }
      // 武將光環：回復到「基礎＋10」為止
      const aura = this.generalAura(r);
      const panic = team.panicUntil > t;
      if (aura > 0 && r.morale < r.baseMorale + 10 && !panic) dm += RULES.generalAuraRegen * aura * dt;
      // 高於基礎太多會慢慢回落（勝勢的亢奮不會永久）
      if (r.morale > r.baseMorale + 15) dm -= 0.4 * dt;
      // 火
      if (this.fireNear(r.mx, r.mz, 25)) dm -= RULES.fireDrain * dt;
      // 糧況：持續流失（到該階段的下限為止）
      if (r.morale > eff.moraleMin) dm -= eff.moraleDrain * dt;
      // 軍心大亂：持續流失、不回復
      if (panic) dm -= RULES.panicDrain * dt;
      // 平靜回復
      const calm = t - r.lastCombatT > 6 && t - (r.chargeShockT ?? 0) > 6;
      if (calm && !panic) {
        const target = Math.min(r.baseMorale + (aura > 0 ? 10 : 0), eff.moraleCap);
        if (r.morale < target) dm += RULES.idleRegen * dt;
      }
      // 地形：高地回復、涉水交戰恐慌（半渡而擊）、仰攻、己方營寨安心
      if (r.terrain.high) dm += 0.3 * dt;
      if (r.terrain.wet && r.engagedWith.size > 0) dm -= RULES.fordMorale * dt;
      if (r.engagedWith.size > 0 && r.terrain.relHeight < -5) dm -= RULES.uphillMorale * dt;
      if (r.terrain.camp) dm += RULES.campMorale * dt;
      if (dm < 0) dm *= this.teamGrit[r.team];
      if (steady && dm < 0) dm = 0;
      if (r.general?.alive && r.hasBuff('steady', t)) dm = Math.max(0, dm);
      const cap = panic ? Math.min(eff.moraleCap, RULES.panicCap) : eff.moraleCap + (aura > 0 ? 10 : 0);
      r.morale = Math.max(0, Math.min(cap, r.morale + dm, 100));
    }
  }

  private generalAura(r: Regiment): number {
    const s = this.s;
    let best = 0;
    for (const g of this.regs) {
      if (g.team !== r.team || !g.general?.alive) continue;
      const gi = g.general.soldier;
      const d = Math.hypot(s.x[gi] - r.mx, s.z[gi] - r.mz);
      const rad = RULES.generalAuraRadius * (0.8 + GENERALS[g.general.id].lead / 250);
      if (d < rad) best = Math.max(best, GENERALS[g.general.id].lead / 70);
    }
    return best;
  }

  /** 戰鬥結束：敗方撤離戰場（沿路線退到己方地圖邊緣） */
  withdraw(r: Regiment): void {
    const [px, pz] = this.retreatPoint(r);
    const lim = this.hf.play / 2 - 10;
    r.path = this.nav.findPath(r.mx, r.mz, Math.max(-lim, Math.min(lim, px)), Math.max(-lim, Math.min(lim, pz)));
    r.pathI = 0;
    r.fireTarget = -1;
    for (const i of r.members) this.s.target[i] = -1;
    r.state = 'routing';
  }

  /** 是否為會決定勝負的主帥（劇本可用 commanderLoss: false 關掉，例如教學關） */
  isCommander(team: number, id: string): boolean {
    const ts = this.sc.teams[team];
    return ts.commander === id && ts.commanderLoss !== false;
  }

  /** 武將撤退：武將單騎回本陣離場，士兵留下繼續戰鬥；主帥撤退＝全軍敗退 */
  retreatGeneral(r: Regiment): void {
    const g = r.general;
    if (!g || !g.alive) return;
    const s = this.s;
    const gi = g.soldier;
    const idx = r.members.indexOf(gi);
    if (idx >= 0) r.members.splice(idx, 1);
    g.alive = false;
    g.fled = true;
    const pool = new Regiment(this.regs.length, r.team, r.faction, r.unit, `${g.name}（撤退）`);
    pool.state = 'shattered';
    pool.retreatHome = true;
    this.regs.push(pool);
    pool.members.push(gi);
    s.reg[gi] = pool.id;
    s.target[gi] = -1;
    s.stun[gi] = 0;
    const hq = this.teams[r.team].hq;
    const [tx, tz] = hq && !hq.burnt ? [hq.x, hq.z] : this.retreatPoint(r);
    pool.path = this.nav.findPath(s.x[gi], s.z[gi], tx, tz);
    pool.pathI = 0;
    pool.mx = s.x[gi];
    pool.mz = s.z[gi];
    if (r.members.length === 0) r.state = 'destroyed';
    else r.needReslot = true;
    this.teams[1 - r.team].generalsBeaten++;
    this.events.push({ k: 'generalRetreat', reg: r.id, name: g.name });
    for (const o of this.regs) {
      if (o.gone) continue;
      if (o.team === r.team) o.morale -= (o === r ? RULES.generalDeathOwn : RULES.generalDeathArmy) * this.teamGrit[o.team];
      else o.morale = Math.min(100, o.morale + 5);
    }
    if (this.isCommander(r.team, g.id)) {
      this.events.push({ k: 'msg', text: `主帥${g.name}撤退！${this.teams[r.team].name}全軍敗退`, tone: r.team === this.player ? 'bad' : 'gold' });
      this.finish(1 - r.team);
    }
  }

  private onGeneralDown(r: Regiment): void {
    const name = r.general!.name;
    this.events.push({ k: 'generalDown', reg: r.id, name });
    this.teams[1 - r.team].generalsBeaten++;
    for (const o of this.regs) {
      if (o.gone) continue;
      if (o.team === r.team) o.morale -= (o === r ? RULES.generalDeathOwn : RULES.generalDeathArmy) * this.teamGrit[o.team];
      else o.morale = Math.min(100, o.morale + 10);
    }
    // 主帥陣亡＝全軍敗退
    if (this.isCommander(r.team, r.general!.id)) {
      this.events.push({ k: 'msg', text: `主帥${name}陣亡！${this.teams[r.team].name}全軍敗退`, tone: r.team === this.player ? 'bad' : 'gold' });
      this.finish(1 - r.team);
    }
  }

  // ───────────────────────── 糧草與建築（docs/03） ─────────────────────────

  /** 補給來源：糧倉與水源（沒有的話用營寨）；都沒有＝這場不打糧草戰 */
  supplySources(team: TeamState): Structure[] {
    const main = team.depots.filter((d) => d.kind === 'depot' || d.kind === 'water');
    return main.length ? main : team.depots.filter((d) => d.kind === 'camp');
  }

  /** 糧道：偵測敵軍佔住糧道（附近沒有我軍）→ 持續 8 秒切斷；敵軍離開立刻恢復 */
  private stepLines(dt: number): void {
    for (const team of this.teams) {
      if (!team.hq) continue;
      for (const st of this.supplySources(team)) {
        if (st.route.length < 2 || st.burnt || st.team !== st.owner) continue;
        let found = false;
        for (const e of this.regs) {
          if (e.team === st.owner || e.gone || e.alive < 5) continue;
          const [d, px, pz] = distToRoute(st.route, e.mx, e.mz);
          if (d > RULES.lineCutRadius + e.radius * 0.5) continue;
          // 附近有我軍：爭奪中，還沒斷
          const guarded = this.regs.some((f) => f.team === st.owner && !f.gone && f.alive > 0 && Math.hypot(f.mx - e.mx, f.mz - e.mz) < RULES.lineGuardRadius + f.radius * 0.5);
          if (guarded) continue;
          found = true;
          if (!st.cut) {
            st.cutX = px;
            st.cutZ = pz;
          }
          break;
        }
        if (found) {
          st.cutT += dt;
          if (st.cutT >= RULES.lineCutTime) st.cut = true;
        } else {
          st.cutT = 0;
          st.cut = false;
        }
      }
    }
  }

  /** 軍團是否在補給範圍內：己方半場、糧道沿線、己方營寨附近 */
  inSupplyArea(r: Regiment): boolean {
    const team = this.teams[r.team];
    const hq = team.hq;
    if (!hq) return true;
    const ehq = this.teams[1 - r.team]?.hq;
    const dOwn = Math.hypot(r.mx - hq.x, r.mz - hq.z);
    if (!ehq || dOwn <= Math.hypot(r.mx - ehq.x, r.mz - ehq.z) + 40) return true;
    for (const st of team.depots) {
      if (st.burnt || st.team !== r.team) continue;
      if (st.kind === 'camp' && Math.hypot(r.mx - st.x, r.mz - st.z) < RULES.campSupplyRadius) return true;
      if (st.route.length > 1 && !st.cut && distToRoute(st.route, r.mx, r.mz)[0] < RULES.lineSupplyWidth) return true;
    }
    return false;
  }

  /** 軍團實際的糧況：全軍糧況與「深入敵境太久」取較差者 */
  supplyOf(r: Regiment): SupplyState {
    const ts = this.teams[r.team].supply;
    const own: SupplyState = r.outT > RULES.outStarveSec ? 'starving' : r.outT > RULES.outLowSec ? 'low' : 'ok';
    return SUPPLY_RANK[own] > SUPPLY_RANK[ts] ? own : ts;
  }

  private stepSupply(dt: number): void {
    if (this.started) this.stepLines(dt);
    for (const team of this.teams) {
      const hq = team.hq;
      if (!hq) continue;
      const sources = this.supplySources(team);
      // 沒有任何補給點：這場不打糧草戰
      if (!sources.length) continue;
      // 主糧倉（例：烏巢）被焚＝命脈斷絕；否則至少一條糧道暢通即可
      const mainLost = sources.some((d) => d.main && d.burnt);
      const lineOk = !mainLost && !hq.burnt && sources.some((d) => !d.burnt && d.team === d.owner && !d.cut);
      const use = (hq.maxStock / RULES.reserveSec) * team.consume * dt;
      if (this.started && !hq.burnt) hq.stock = lineOk ? Math.min(hq.maxStock, hq.stock + use * (RULES.lineFlow - 1)) : Math.max(0, hq.stock - use);
      const f = hq.burnt ? 0 : hq.frac;
      const state: SupplyState = lineOk ? 'ok' : f > RULES.lowFrac ? 'cut' : f > 0.02 ? 'low' : 'starving';
      if (lineOk !== team.lineOk) {
        team.lineOk = lineOk;
        if (!lineOk) {
          const src = sources.find((d) => d.cut) ?? sources.find((d) => d.burnt || d.team !== d.owner) ?? sources[0];
          const burnt = !src.cut;
          this.events.push({ k: 'lineCut', team: team.index, x: burnt ? src.x : src.cutX, z: burnt ? src.z : src.cutZ, burnt });
          for (const r of this.regs) if (r.team === team.index && !r.gone) r.morale -= RULES.lineCutShock * this.teamGrit[r.team];
        } else this.events.push({ k: 'lineRestored', team: team.index });
      }
      if (state !== team.supply) {
        const worse = SUPPLY_RANK[state] > SUPPLY_RANK[team.supply];
        team.supply = state;
        if (state !== 'cut' && state !== 'ok') this.events.push({ k: 'supply', team: team.index, state });
        if (worse && state === 'starving') {
          for (const r of this.regs) if (r.team === team.index && !r.gone) r.morale -= 8 * this.teamGrit[r.team];
        }
      }
    }
    // 深入敵境、遠離己方糧道：遠征的部隊慢慢斷糧
    for (const r of this.regs) {
      if (r.gone || !this.started) continue;
      if (!this.supplySources(this.teams[r.team]).length) continue;
      r.outT = this.inSupplyArea(r) ? Math.max(0, r.outT - 2 * dt) : r.outT + dt;
    }
    // 斷糧減員：每 10 秒 1%（士兵悄悄離隊）
    if (this.tick % 300 === 0) {
      for (const r of this.regs) {
        if (r.gone || r.alive < 10 || this.supplyOf(r) !== 'starving') continue;
        const n = Math.max(1, Math.floor(r.alive * 0.01));
        for (let k = 0, p = r.members.length - 1; k < n && p >= 0 && r.members.length > 1; p--) {
          const i = r.members[p];
          if (this.s.general[i]) continue;
          this.desert(i);
          k++;
        }
      }
    }
  }

  /** 本陣補給範圍：補箭（每秒約三成士兵補一輪）、體力回復 ×1.5；斷糧時不補 */
  private stepResupply(): void {
    for (const r of this.regs) {
      r.inSupply = false;
      if (r.gone) continue;
      const hq = this.teams[r.team].hq;
      if (!hq || hq.burnt || this.supplyOf(r) === 'starving') continue;
      if (Math.hypot(r.mx - hq.x, r.mz - hq.z) > RULES.supplyRadius) continue;
      r.inSupply = true;
      const rd = r.unit.ranged;
      if (!rd || r.engagedWith.size > 0) continue;
      for (const i of r.members) if (this.s.ammo[i] < rd.ammo && this.rng() < 0.3) this.s.ammo[i]++;
    }
  }

  /** 逃兵：離開軍團、自己往後方走 */
  private desert(i: number): void {
    const s = this.s;
    const r = this.regs[s.reg[i]];
    const idx = r.members.indexOf(i);
    if (idx >= 0) r.members.splice(idx, 1);
    // 放進一個隱形的「逃兵」群：直接當作潰兵逃走
    let pool = this.regs.find((x) => x.team === r.team && x.name === '逃兵' && x.state === 'shattered');
    if (!pool) {
      pool = new Regiment(this.regs.length, r.team, r.faction, r.unit, '逃兵');
      pool.state = 'shattered';
      pool.routs = 9;
      this.regs.push(pool);
    }
    pool.members.push(i);
    s.reg[i] = pool.id;
    s.target[i] = -1;
  }

  private stepStructures(dt: number): void {
    const s = this.s;
    for (const st of this.structs) {
      if (st.burnt) continue;
      // 附近敵我兵力
      let enemies = 0;
      let friends = 0;
      let raidMul = 1;
      // 守軍判定：營寨外圍 25 m 內都算（站在柵欄外守著也算有人防守）
      const defR = st.radius + RULES.depotDefendRadius;
      const n = this.hash.near(st.x, st.z, defR + 4);
      const res = this.hash.res;
      for (let k = 0; k < n; k++) {
        const j = res[k];
        if (s.state[j] !== SState.Alive) continue;
        const d = Math.hypot(s.x[j] - st.x, s.z[j] - st.z);
        const r = this.regs[s.reg[j]];
        if (r.routing) continue;
        if (s.team[j] === st.team) {
          if (d < defR) friends++;
        } else if (d < st.radius + RULES.depotIgniteRadius * 0.5) {
          enemies++;
          if (r.type === 'cav') raidMul = Math.max(raidMul, 3);
          if (r.buffs.some((b) => b.id === 'raid' && b.until > this.t)) raidMul = Math.max(raidMul, 6);
        }
      }
      if (st.kind === 'water') {
        // 水源：敵軍控制（無守軍）一段時間 → 易主
        if (enemies > 5 && friends === 0) {
          st.capture = Math.min(1, st.capture + dt / 20);
          if (st.capture >= 1) {
            const old = st.team;
            st.team = 1 - st.team;
            st.capture = 0;
            if (old === st.owner) {
              // 原主失去水源：斷水
              this.events.push({ k: 'msg', text: `${this.teams[st.team].name}控制了${st.name}！${this.teams[old].name}斷水`, tone: st.team === this.player ? 'good' : 'bad' });
              const ohq = this.teams[old].hq;
              if (ohq) ohq.stock = Math.min(ohq.stock, ohq.maxStock * 0.22);
              for (const r of this.regs) if (r.team === old && !r.gone) r.morale -= 12;
              if (typeof this.flags.waterT !== 'number') this.flags.waterT = this.t - ((this.flags.startT as number) ?? 0);
            } else {
              this.events.push({ k: 'msg', text: `${this.teams[st.team].name}奪回了${st.name}`, tone: st.team === this.player ? 'good' : 'bad' });
            }
          }
        } else st.capture = Math.max(0, st.capture - dt / 30);
        continue;
      }
      // 縱火：敵兵壓過守軍兩倍以上（守軍只剩零星殘兵也擋不住）
      if (enemies > 0 && enemies > friends * 2) {
        st.attackedT = this.t;
        const before = st.ignite;
        st.ignite = Math.min(1, st.ignite + (dt / 12) * raidMul * Math.min(3, 0.5 + enemies / 10));
        if (before < 1 && st.ignite >= 1 && st.fire === 0) {
          st.fire = 0.15;
          this.events.push({ k: 'ignite', s: st.id });
        }
      } else if (friends > 0 && enemies === 0) {
        st.ignite = Math.max(0, st.ignite - dt / 8);
        // 守軍救火：45 人以上能壓過火勢（每秒最多 −0.09，火勢成長 +0.05）；起風時救火效率減半、大火（>0.7）難以撲滅
        const windMul = this.sc.wind ? 0.5 : 1;
        const bigMul = st.fire > 0.7 ? 0.4 : 1;
        st.fire = Math.max(0, st.fire - dt * 0.03 * Math.min(3, friends / 15) * windMul * bigMul);
      }
      // 營寨火勢延燒：燃燒中的營寨點燃附近營寨（順風更快）
      if (st.kind === 'camp' && st.fire === 0) {
        for (const o of this.structs) {
          if (o === st || o.kind !== 'camp' || (o.fire < 0.3 && !o.burnt) || o.team !== st.team) continue;
          const dx = st.x - o.x;
          const dz = st.z - o.z;
          const d = Math.hypot(dx, dz);
          if (d > 95) continue;
          const wind = this.sc.wind ? 1 + 1.5 * Math.max(0, (dx * this.sc.wind.x + dz * this.sc.wind.z) / d) : 1;
          st.ignite = Math.min(1, st.ignite + dt * 0.022 * (o.burnt ? 0.5 : o.fire) * wind * (1 - d / 120));
        }
        if (st.ignite >= 1) {
          st.fire = 0.2;
          this.events.push({ k: 'ignite', s: st.id });
        }
      }
      if (st.fire > 0) {
        st.fire = Math.min(1, st.fire + dt * 0.05 * this.wx.fire);
        st.stock = Math.max(0, st.stock - st.maxStock * RULES.depotBurnRate * st.fire * dt * (st.kind === 'hq' ? 0.6 : 1));
        if (st.stock <= 0) this.burnDown(st);
      }
      // 本陣佔領
      // 本陣佔領：至少 30 名敵兵、周圍沒有守軍，持續 30 秒
      if (st.kind === 'hq' && enemies > 30 && friends === 0) {
        st.capture += dt / 30;
        if (st.capture >= 1) {
          this.events.push({ k: 'msg', text: `${st.name}被攻陷！`, tone: st.team === this.player ? 'bad' : 'good' });
          this.burnDown(st);
          this.finish(1 - st.team);
        }
      } else if (st.kind === 'hq') st.capture = Math.max(0, st.capture - dt / 30);
    }
  }

  burnDown(st: Structure): void {
    if (st.burnt) return;
    st.burnt = true;
    st.stock = 0;
    st.fire = 1;
    const team = this.teams[st.team];
    team.depotsBurnt++;
    this.events.push({ k: 'burnt', s: st.id });
    const shock = st.kind === 'hq' ? 20 : st.main ? RULES.depotMainShock : st.kind === 'camp' ? 6 : RULES.depotBurntShock;
    for (const r of this.regs) {
      if (r.gone) continue;
      if (r.team === st.team) r.morale -= shock;
      else r.morale = Math.min(100, r.morale + 5);
    }
    // 主糧倉／本陣被焚：軍心大亂 90 秒、前線存糧減半
    if (st.main || st.kind === 'hq') {
      team.panicUntil = this.t + RULES.panicTime;
      if (team.hq && team.hq !== st) team.hq.stock *= 0.5;
      this.events.push({ k: 'panic', team: st.team });
    }
    const anyLeft = team.depots.some((d) => d.kind !== 'water' && !d.burnt);
    if (!anyLeft && team.depots.some((d) => d.kind !== 'water')) {
      for (const r of this.regs) if (r.team === st.team && !r.gone) r.morale -= RULES.allDepotsShock;
    }
    // 營寨：火勢延燒鄰近營寨
    if (st.kind === 'camp') {
      for (const o of this.structs) {
        if (o.kind === 'camp' && !o.burnt && o.fire === 0 && Math.hypot(o.x - st.x, o.z - st.z) < 70) o.ignite = Math.max(o.ignite, 0.6);
      }
    }
  }

  /** 火矢落地：點燃附近建築 */
  private fireArrowLand(x: number, z: number, team: number): void {
    for (const st of this.structs) {
      if (st.burnt || st.team === team || st.kind === 'water') continue;
      if (Math.hypot(st.x - x, st.z - z) < st.radius) {
        st.ignite = Math.min(1, st.ignite + 0.012);
        if (st.ignite >= 1 && st.fire === 0) {
          st.fire = 0.15;
          this.events.push({ k: 'ignite', s: st.id });
        }
      }
    }
  }

  fireNear(x: number, z: number, r: number): boolean {
    for (const st of this.structs) if (st.fire > 0.3 && !st.burnt && Math.hypot(st.x - x, st.z - z) < r + st.radius) return true;
    return false;
  }

  // ───────────────────────── 輜重車 ─────────────────────────

  private stepWagons(dt: number): void {
    if (!this.started) return;
    if (this.tick % 30 === 0) {
      for (const team of this.teams) {
        if (!team.hq || team.hq.burnt) continue;
        for (const d of team.depots) {
          // 糧倉與營寨都會派輜重車（營寨存糧少、間隔長一點）
          if (d.burnt || d.cut || (d.kind !== 'depot' && d.kind !== 'camp') || d.stock < RULES.wagonLoad || d.route.length < 2) continue;
          d.wagonT -= 1;
          if (d.wagonT > 0) continue;
          d.wagonT = RULES.wagonInterval * (d.kind === 'camp' ? 1.6 : 1) * (0.8 + this.rng() * 0.4);
          d.stock -= RULES.wagonLoad;
          this.wagons.push(new Wagon(this.wagons.length, team.index, d.id, d.route[0][0], d.route[0][1], d.route.slice(1), RULES.wagonLoad));
        }
      }
    }
    const s = this.s;
    for (const w of this.wagons) {
      if (!w.alive || w.arrived) continue;
      w.px = w.x;
      w.pz = w.z;
      if (w.pathI >= w.path.length) {
        w.arrived = true;
        continue;
      }
      const [tx, tz] = w.path[w.pathI];
      const dx = tx - w.x;
      const dz = tz - w.z;
      const d = Math.hypot(dx, dz);
      const step = RULES.wagonSpeed * dt * this.nav.speedAt(w.x, w.z);
      if (d < step) {
        w.x = tx;
        w.z = tz;
        w.pathI++;
      } else {
        w.x += (dx / d) * step;
        w.z += (dz / d) * step;
        w.yaw = Math.atan2(dx, dz);
      }
      // 被敵兵攻擊
      if (this.tick % 10 === 0) {
        const n = this.hash.near(w.x, w.z, 4);
        const res = this.hash.res;
        let hits = 0;
        for (let k = 0; k < n; k++) {
          const j = res[k];
          if (s.state[j] !== SState.Alive || s.team[j] === w.team) continue;
          if (Math.hypot(s.x[j] - w.x, s.z[j] - w.z) < 3.5) hits += this.regs[s.reg[j]].unit.mounted ? 2 : 1;
        }
        if (hits > 0) {
          w.hp -= hits * 12;
          if (w.hp <= 0) {
            w.alive = false;
            this.teams[w.team].wagonsLost++;
            const hq = this.teams[w.team].hq;
            if (hq && !hq.burnt) hq.stock = Math.max(0, hq.stock - w.load * 0.5);
            for (const r of this.regs) if (r.team === w.team && !r.gone) r.morale -= 3;
            this.events.push({ k: 'wagonLost', team: w.team });
          }
        }
      }
    }
  }

  // ───────────────────────── 軍令點 ─────────────────────────

  private stepCommand(dt: number): void {
    for (const team of this.teams) team.command = Math.min(RULES.commandMax, team.command + dt / RULES.commandRegen);
  }

  // ───────────────────────── 視野 ─────────────────────────

  stepVision(): void {
    // 每個軍團是否被對方看見（森林中需 50 m 內）
    for (const r of this.regs) {
      if (r.gone) continue;
      let seen = false;
      const inForest = this.nav.forestAt(r.mx, r.mz) > 0.45;
      for (const o of this.regs) {
        if (o.team === r.team || o.gone || o.routing) continue;
        const d = Math.hypot(o.mx - r.mx, o.mz - r.mz) - r.radius;
        const oForest = this.nav.forestAt(o.mx, o.mz) > 0.45;
        const range = (inForest ? RULES.forestHideRange : oForest ? RULES.forestVision : RULES.vision + (this.hf.height(o.mx, o.mz) > 8 ? 40 : 0)) * this.wx.vision;
        if (d < range) {
          seen = true;
          break;
        }
      }
      if (r.engagedWith.size > 0 || this.t - r.lastFireT < 3) seen = true;
      if (this.t < r.spottedT) seen = true;
      // 劇本隱藏的伏兵：被發現或開打前一律不顯示
      if (r.hidden && !seen) {
        r.visible = false;
        continue;
      }
      if (seen) r.hidden = false;
      r.visible = seen;
    }
  }

  /** 對 team 來說 r 是否可見 */
  isVisibleTo(r: Regiment, team: number): boolean {
    if (r.team === team) return true;
    if (team !== this.player) return r.visible || !r.hidden; // AI 稍微作弊：看得到沒躲起來的
    return r.visible;
  }

  // ───────────────────────── 勝負 ─────────────────────────

  private checkEnd(): void {
    if (this.over || !this.started) return;
    for (const team of this.teams) {
      // 殲滅九成：剩下的兵力不到開戰時的一成（主帥撤退／陣亡另在發生時判定）
      const alive = this.regs.filter((r) => r.team === team.index && !r.gone && r.name !== '逃兵').reduce((a, r) => a + r.alive, 0);
      if (alive === 0 || alive < team.initialStrength * RULES.defeatRemain) {
        this.finish(1 - team.index);
        return;
      }
    }
    if (this.sc.holdTime && this.t - ((this.flags.startT as number) ?? 0) >= this.sc.holdTime) this.finish(0);
  }

  finish(winner: number): void {
    if (this.over) return;
    this.over = true;
    this.winner = winner;
    this.flags.endT = this.t;
    this.events.push({ k: 'end', winner });
    // 敗方撤離戰場
    for (const r of this.regs) if (r.team !== winner && !r.gone && !r.routing) this.withdraw(r);
  }

  private runTriggers(): void {
    const trig = this.sc.triggers ?? [];
    trig.forEach((tr, k) => {
      if (this.triggered.has(k)) return;
      if (tr.when(this)) {
        this.triggered.add(k);
        tr.run(this);
      }
    });
  }

  /** 援軍：戰鬥中途加入一批軍團 */
  reinforce(team: number, specs: RegimentSpec[], text: string): void {
    for (const rs of specs) {
      const r = this.spawnRegiment(team, rs);
      this.teams[team].initialStrength += r.alive;
      if (team === this.player) r.visible = true;
    }
    this.hash.rebuild(this.s);
    this.events.push({ k: 'msg', text, tone: team === this.player ? 'good' : 'bad' });
  }

  /** 倒戈：軍團改投對方（官渡張郃、高覽） */
  defect(rid: number): void {
    const r = this.regs[rid];
    if (!r || r.gone) return;
    const to = 1 - r.team;
    const fromTeam = this.teams[r.team];
    r.team = to;
    r.faction = this.sc.teams[to].faction;
    r.state = 'ready';
    r.morale = Math.max(r.morale, 70);
    r.routs = 0;
    r.order = { type: 'idle', x: r.mx, z: r.mz, facing: r.facing, target: -1, struct: -1 };
    r.path = [];
    r.fireTarget = -1;
    r.hidden = false;
    r.visible = true;
    for (const i of r.members) {
      this.s.team[i] = to;
      this.s.target[i] = -1;
    }
    fromTeam.initialStrength = Math.max(1, fromTeam.initialStrength - r.alive);
    this.teams[to].initialStrength += r.alive;
    // 原本在打它的人停手
    for (const o of this.regs) {
      if (o.order.target === rid) this.commandHalt([o.id]);
      if (o.fireTarget === rid) o.fireTarget = -1;
    }
    this.events.push({ k: 'defect', reg: rid });
  }

  // ───────────────────────── 武將單挑 ─────────────────────────

  private duelT = new Map<string, number>();
  private genDuelT = new Map<string, number>();
  /** 劇本禁止的單挑組合（例：虎牢關呂布不和劉關張單挑，要等三英合擊） */
  duelBan: ((a: string, b: string) => boolean) | null = null;
  /** 劇本指定的單挑結果（回傳 null 表示照武力擲骰） */
  duelFate: ((a: string, b: string) => { winner: string; killed: boolean } | null) | null = null;
  /** 史實單挑：劇本指定的兩位武將在 8 m 內相遇才觸發（沒有隨機單挑） */
  private checkDuels(): void {
    if (!this.duelFate) return;
    const s = this.s;
    const gens = this.regs.filter((r) => r.general?.alive && !r.routing && !r.gone && r.order.type !== 'retreat' && (this.genDuelT.get(r.general.id) ?? -999) < this.t - 120);
    for (const a of gens) {
      for (const b of gens) {
        if (a.team >= b.team || a.team === b.team) continue;
        const ia = a.general!.soldier;
        const ib = b.general!.soldier;
        const d = Math.hypot(s.x[ia] - s.x[ib], s.z[ia] - s.z[ib]);
        if (d > 8) continue;
        if (this.duelBan?.(a.general!.id, b.general!.id)) continue;
        if (!this.duelFate(a.general!.id, b.general!.id)) continue;
        const key = `${a.general!.id}|${b.general!.id}`;
        if ((this.duelT.get(key) ?? -999) > this.t - 60) continue;
        this.duelT.set(key, this.t);
        this.genDuelT.set(a.general!.id, this.t);
        this.genDuelT.set(b.general!.id, this.t);
        const ga = GENERALS[a.general!.id];
        const gb = GENERALS[b.general!.id];
        // 武力十次方比：差 10 點約八成勝率
        const pa = ga.war ** 10 / (ga.war ** 10 + gb.war ** 10);
        // 劇本可指定史實結果（例：白馬關羽斬顏良）
        const fate = this.duelFate?.(ga.id, gb.id) ?? null;
        const aWins = fate ? fate.winner === ga.id : this.rng() < pa;
        const [win, lose, gw, gl] = aWins ? [a, b, ga, gb] : [b, a, gb, ga];
        const li = lose.general!.soldier;
        // 武力差距大 → 一合斬於馬下；否則重傷敗走
        const killed = fate ? fate.killed : gw.war - gl.war >= 6 || this.rng() < 0.2;
        this.events.push({ k: 'duel', a: ga.name, b: gb.name, winner: gw.name, loser: gl.name, winTeam: win.team, killed, x: s.x[li], z: s.z[li] });
        if (killed) this.damage(li, 1e6, win.general!.soldier);
        else {
          s.hp[li] = Math.max(1, s.hp[li] * 0.35);
          lose.morale -= 15;
        }
        for (const r of this.regs) {
          if (r.gone) continue;
          if (r.team === win.team) r.morale = Math.min(100, r.morale + 12);
          else if (!killed) r.morale -= 8;
        }
        s.stun[ia] = s.stun[ib] = 1.5;
        return;
      }
    }
  }

  // ───────────────────────── 武將技與計策 ─────────────────────────

  useAbility(rid: number, x?: number, z?: number): boolean {
    if (!this.started || this.over) return false;
    const r = this.regs[rid];
    if (!r?.general?.alive || r.routing || r.general.cd > this.t) return false;
    const g = GENERALS[r.general.id];
    if (!g.ability) return false;
    const ab = ABILITIES[g.ability];
    const s = this.s;
    const gi = r.general.soldier;
    const gx = s.x[gi];
    const gz = s.z[gi];
    const t = this.t;
    const within = (rad: number, team: number) => this.regs.filter((o) => o.team === team && !o.gone && Math.hypot(o.mx - gx, o.mz - gz) < rad + o.radius * 0.5);
    switch (ab.id) {
      case 'rally':
        for (const o of within(120, r.team)) {
          o.morale = Math.min(100, o.morale + 30);
        }
        break;
      case 'berserk':
        r.buffs.push({ id: 'berserk', until: t + 20, atk: 1.6, def: 0.7 });
        break;
      case 'terror':
        for (const o of within(35, 1 - r.team)) if (!o.hasBuff('steady', t)) o.morale -= 35;
        r.buffs.push({ id: 'terror', until: t + 15, speed: 1.3 });
        break;
      case 'peerless':
        for (const o of within(30, 1 - r.team)) if (!o.hasBuff('steady', t)) o.morale -= 25;
        r.buffs.push({ id: 'peerless', until: t + 15, atk: 1.5, speed: 1.15 });
        break;
      case 'swift':
        r.buffs.push({ id: 'swift', until: t + 20, speed: 1.4 });
        break;
      case 'steady':
        for (const o of within(40, r.team)) o.buffs.push({ id: 'steady', until: t + 25, steady: true });
        break;
      case 'cleave': {
        const fx = Math.sin(s.yaw[gi]);
        const fz = Math.cos(s.yaw[gi]);
        const n = this.hash.near(gx + fx * 10, gz + fz * 10, 12);
        const res = this.hash.res;
        const hitRegs = new Set<number>();
        for (let k = 0; k < n; k++) {
          const j = res[k];
          if (s.team[j] === r.team || s.state[j] !== SState.Alive) continue;
          const dx = s.x[j] - gx;
          const dz = s.z[j] - gz;
          const d = Math.hypot(dx, dz);
          if (d > 20 || (dx * fx + dz * fz) / (d || 1) < 0.5) continue;
          this.damage(j, 120, gi);
          if (s.state[j] === SState.Alive) s.stun[j] = 1.5;
          hitRegs.add(s.reg[j]);
        }
        for (const id of hitRegs) this.regs[id].morale -= 25;
        break;
      }
      case 'roar':
        for (const o of within(45, 1 - r.team)) {
          if (!o.hasBuff('steady', t)) o.morale -= 30;
          for (const i of o.members) s.stun[i] = 3;
        }
        break;
      case 'unstoppable':
        r.buffs.push({ id: 'unstoppable', until: t + 20, speed: 1.4, steady: true });
        break;
      case 'fortify':
        for (const o of within(40, r.team)) o.buffs.push({ id: 'fortify', until: t + 25, def: 1.4 });
        break;
      case 'raid':
        r.buffs.push({ id: 'raid', until: t + 20, speed: 1.4 });
        break;
      case 'fury':
        r.buffs.push({ id: 'fury', until: t + 20, atk: 1.4 });
        break;
      case 'firestorm': {
        const fx = x ?? gx;
        const fz = z ?? gz;
        // 施放距離：武將 160 m 內
        if (Math.hypot(fx - gx, fz - gz) > 160) return false;
        this.fireArea(fx, fz, 30, r.team);
        break;
      }
    }
    r.general.cd = t + ab.cd * (1.2 - g.int / 250);
    this.events.push({ k: 'ability', reg: r.id, name: ab.name });
    if (r.team === this.player) this.flags.did_ability = true;
    return true;
  }

  /** 主帥計策：花軍令點；回傳失敗原因或 null */
  useStratagem(team: number, id: StratagemId, x: number, z: number, rid = -1): string | null {
    if (!this.started) return '開戰後才能施放計策';
    const def = STRATAGEMS[id];
    const ts = this.teams[team];
    if (ts.command < def.cost) return '軍令點不足';
    if (id === 'firearrows' && this.sc.weather === 'rain') return '雨天點不著火，無法火攻';
    // 地點型計策要在我軍 160 m 內（斥候除外）
    if (def.target === 'area' && id !== 'scout' && !this.regs.some((o) => o.team === team && !o.gone && !o.routing && Math.hypot(o.mx - x, o.mz - z) < 160)) return '距離我軍太遠（需在 160 m 內）';
    const t = this.t;
    const friends = (rad: number) => this.regs.filter((o) => o.team === team && !o.gone && Math.hypot(o.mx - x, o.mz - z) < rad + o.radius * 0.5);
    switch (id) {
      case 'drums':
        for (const o of friends(def.radius)) {
          o.morale = Math.min(100, o.morale + 25);
          o.buffs.push({ id: 'drums', until: t + 20, atk: 1.15 });
        }
        break;
      case 'firearrows': {
        // 從己方後方射來的火箭雨
        const back = team === 0 ? 1 : -1;
        for (let k = 0; k < 90; k++) {
          const a = this.rng() * Math.PI * 2;
          const rr = Math.sqrt(this.rng()) * def.radius;
          const tx = x + Math.cos(a) * rr;
          const tz = z + Math.sin(a) * rr;
          const sx = x + (this.rng() - 0.5) * 60;
          const sz = z + back * 130;
          const t0 = t + this.rng() * 2.5;
          const p = this.proj.spawn(sx, this.groundY(sx, sz) + 3, sz, tx, this.groundY(tx, tz) + 0.5, tz, t0, 2.2, 38, team, 22 * this.wx.rangedDmg, 0.2, this.sc.weather !== 'rain', -1);
          void p;
        }
        for (const o of this.regs) if (o.team !== team && !o.gone && Math.hypot(o.mx - x, o.mz - z) < def.radius + o.radius * 0.5) o.morale -= 10;
        for (const st of this.structs) {
          if (this.sc.weather === 'rain') break;
          if (st.team !== team && !st.burnt && st.kind !== 'water' && Math.hypot(st.x - x, st.z - z) < def.radius + st.radius) {
            st.ignite = 1;
            if (st.fire === 0) {
              st.fire = 0.25;
              this.events.push({ k: 'ignite', s: st.id });
            }
          }
        }
        break;
      }
      case 'march': {
        const r = this.regs[rid];
        if (!r || r.team !== team || r.gone) return '請選擇己方軍團';
        r.buffs.push({ id: 'march', until: t + 20, speed: 1.4, tireless: true });
        r.stamina = Math.max(r.stamina, 60);
        break;
      }
      case 'scout':
        for (const o of this.regs) if (o.team !== team && !o.gone && Math.hypot(o.mx - x, o.mz - z) < def.radius) o.spottedT = t + 30;
        this.stepVision();
        break;
      case 'retreat': {
        const r = this.regs[rid];
        if (!r || r.team !== team || r.gone) return '請選擇己方軍團';
        this.commandRetreat([rid]);
        r.buffs.push({ id: 'gong', until: t + 15, steady: true });
        break;
      }
      case 'rockfall': {
        if (this.hf.slope(x, z) < 0.18) return '落石只能用在斜坡上';
        // 往坡下滾：傷害坡下 15 m 內的敵軍
        const e = 3;
        const gx = this.hf.height(x + e, z) - this.hf.height(x - e, z);
        const gz = this.hf.height(x, z + e) - this.hf.height(x, z - e);
        const gl = Math.hypot(gx, gz) || 1;
        const cx = x - (gx / gl) * 12;
        const cz = z - (gz / gl) * 12;
        const s = this.s;
        const n = this.hash.near(cx, cz, def.radius + 6);
        const res = this.hash.res;
        const hit = new Set<number>();
        for (let k = 0; k < n; k++) {
          const j = res[k];
          if (s.state[j] !== SState.Alive || s.team[j] === team) continue;
          if (Math.hypot(s.x[j] - cx, s.z[j] - cz) > def.radius + 4) continue;
          if (this.rng() < 0.55) this.damage(j, 70 + this.rng() * 60, -1);
          if (s.state[j] === SState.Alive) s.stun[j] = 2;
          hit.add(s.reg[j]);
        }
        for (const hid of hit) this.regs[hid].morale -= 15;
        this.flags.rockX = cx;
        this.flags.rockZ = cz;
        break;
      }
    }
    ts.command -= def.cost;
    this.events.push({ k: 'stratagem', team, id, x, z });
    if (team === this.player) this.flags.did_strat = true;
    return null;
  }

  /** 範圍火攻：傷害、士氣、點燃建築 */
  fireArea(x: number, z: number, rad: number, team: number): void {
    const s = this.s;
    const n = this.hash.near(x, z, rad);
    const res = this.hash.res;
    const hit = new Set<number>();
    for (let k = 0; k < n; k++) {
      const j = res[k];
      if (s.state[j] !== SState.Alive || s.team[j] === team) continue;
      if (Math.hypot(s.x[j] - x, s.z[j] - z) > rad) continue;
      if (this.rng() < 0.35) this.damage(j, 40 + this.rng() * 50, -1);
      hit.add(s.reg[j]);
    }
    for (const id of hit) this.regs[id].morale -= 12;
    for (const st of this.structs) {
      if (st.team !== team && !st.burnt && st.kind !== 'water' && Math.hypot(st.x - x, st.z - z) < rad + st.radius) {
        st.ignite = 1;
        if (st.fire === 0) {
          st.fire = 0.3;
          this.events.push({ k: 'ignite', s: st.id });
        }
      }
    }
    this.flags.lastFireX = x;
    this.flags.lastFireZ = z;
    this.flags.lastFireT = this.t;
  }

  // ───────────────────────── 查詢 ─────────────────────────

  groundY(x: number, z: number): number {
    let y = this.hf.groundOrWater(x, z);
    for (const b of this.bridges) {
      const dx = x - b.x;
      const dz = z - b.z;
      const along = dx * Math.sin(b.angle) + dz * Math.cos(b.angle);
      const across = dx * Math.cos(b.angle) - dz * Math.sin(b.angle);
      if (Math.abs(along) < b.length / 2 && Math.abs(across) < 5) y = Math.max(y, WATER_LEVEL + 1.1);
    }
    return y;
  }

  modelOf(i: number): ModelKey {
    return MODEL_KEYS[this.s.model[i]];
  }

  unitOf(i: number): UnitDef {
    return this.regs[this.s.reg[i]].unit;
  }

  teamStrength(team: number): number {
    let n = 0;
    for (const r of this.regs) if (r.team === team && !r.gone && !r.routing) n += r.alive;
    return n;
  }

  /** 全軍士氣（0..100，依兵力加權） */
  armyMorale(team: number): number {
    let sum = 0;
    const init = this.teams[team].initialStrength || 1;
    for (const r of this.regs) if (r.team === team && !r.gone && !r.routing && r.name !== '逃兵') sum += r.morale * r.alive;
    return Math.min(100, sum / init);
  }
}

/** 兵種相剋（近戰）：槍剋騎、騎剋射、盾剋槍 */
export function counterMul(att: UnitDef, def: UnitDef): number {
  if (def.cls === 'cav') return att.vsCav;
  if (att.cls === 'cav' && def.cls === 'missile') return RULES.cavVsMissile;
  if (att.cls === 'shield' && def.cls === 'pole') return RULES.shieldVsPole;
  return 1;
}

/** 路線加密：相鄰點不超過 step 公尺 */
function densify(pts: [number, number][], step: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < pts.length; k++) {
    const [x, z] = pts[k];
    if (k > 0) {
      const [px, pz] = pts[k - 1];
      const d = Math.hypot(x - px, z - pz);
      const n = Math.floor(d / step);
      for (let q = 1; q < n; q++) out.push([px + ((x - px) * q) / n, pz + ((z - pz) * q) / n]);
    }
    out.push([x, z]);
  }
  return out;
}

/** 點到折線的最短距離與最近點 */
export function distToRoute(route: [number, number][], x: number, z: number): [number, number, number] {
  let best = Infinity;
  let bx = route[0][0];
  let bz = route[0][1];
  for (let k = 1; k < route.length; k++) {
    const [ax, az] = route[k - 1];
    const [cx, cz] = route[k];
    const dx = cx - ax;
    const dz = cz - az;
    const l2 = dx * dx + dz * dz || 1;
    const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * u;
    const pz = az + dz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bx = px;
      bz = pz;
    }
  }
  return [best, bx, bz];
}

export function angDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
