// 玩家戰線指令：部隊分成左翼／中軍／右翼／奇兵／預備，整組下「固守／推進／後撤／包抄」
// 下了指令的部隊每 0.5 秒自動處理細節（找目標、跟上隊伍、轉向迎敵、弓兵保持在步兵後方）；玩家手動下令就回到 free
import type { GroupId, Regiment, Stance } from '../sim/regiment';
import type { World } from '../sim/world';

export const GROUPS: Record<GroupId, { name: string; short: string; color: string }> = {
  left: { name: '左翼', short: '左', color: '#5aa9ff' },
  center: { name: '中軍', short: '中', color: '#ffd24a' },
  right: { name: '右翼', short: '右', color: '#ff8a5a' },
  strike: { name: '奇兵', short: '奇', color: '#c47bff' },
  reserve: { name: '預備', short: '預', color: '#9fd8a0' },
};
export const GROUP_ORDER: GroupId[] = ['left', 'center', 'right', 'strike', 'reserve'];

export const STANCES: Record<Exclude<Stance, 'free'>, { name: string; icon: string; desc: string }> = {
  hold: { name: '固守', icon: '🛡', desc: '原地列陣迎敵：長槍擺拒馬、被側擊會轉向（正面已有敵人時不轉）、弓兵自動射擊、騎兵只反擊靠近的敵軍' },
  advance: { name: '推進', icon: '⚔', desc: '整組保持隊形向敵軍推進，接近就自動接戰；弓兵跟在步兵後方射擊' },
  retreat: { name: '後撤', icon: '↩', desc: '面向敵軍有序後退 60 m，到位後改為固守' },
  flank: { name: '包抄', icon: '🐎', desc: '繞到最近敵軍（優先已被我軍纏住的）的側面與背後再進攻：側面 ×1.4、背後 ×2' },
  lure: { name: '誘敵', icon: '🎣', desc: '上前挑釁最近的敵軍，被追就退回現在的位置——把敵人引進你的伏兵或火場' },
};

export class PlayerTactics {
  private next = 0;

  constructor(
    private w: World,
    readonly team: number,
  ) {}

  private mine(): Regiment[] {
    return this.w.regs.filter((r) => r.team === this.team && !r.gone && !r.routing && r.name !== '逃兵');
  }

  private enemies(): Regiment[] {
    const w = this.w;
    return w.regs.filter((e) => e.team !== this.team && !e.gone && !e.routing && e.name !== '逃兵' && w.isVisibleTo(e, this.team));
  }

  /** 敵軍方向：看得到的敵軍重心，否則敵方本陣 */
  private enemyDir(from: { mx: number; mz: number }, enemies: Regiment[]): [number, number] {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const e of enemies) {
      x += e.mx * e.alive;
      z += e.mz * e.alive;
      n += e.alive;
    }
    if (n === 0) {
      const hq = this.w.teams[1 - this.team]?.hq;
      if (!hq) return [0, -1];
      x = hq.x;
      z = hq.z;
    } else {
      x /= n;
      z /= n;
    }
    const dx = x - from.mx;
    const dz = z - from.mz;
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  }

  /** 開戰時自動分組：步兵與弓兵依左右位置分三路，騎兵當奇兵，主帥與後方部隊當預備 */
  assignGroups(): void {
    const regs = this.mine();
    if (!regs.length) return;
    const cx = regs.reduce((a, r) => a + r.mx, 0) / regs.length;
    const cz = regs.reduce((a, r) => a + r.mz, 0) / regs.length;
    const [dx, dz] = this.enemyDir({ mx: cx, mz: cz }, this.enemies());
    // 玩家從己方後方看向敵軍時，螢幕右手邊＝(−dz, dx)（與鏡頭的右方向一致）
    const side = (r: Regiment) => (r.mx - cx) * -dz + (r.mz - cz) * dx;
    const fwd = (r: Regiment) => (r.mx - cx) * dx + (r.mz - cz) * dz;
    const cmd = this.w.sc.teams[this.team].commander;
    // 步兵與弓兵依左右排序，平均分成左、中、右三路
    const foot = regs.filter((r) => !r.unit.mounted && !(cmd && r.general?.id === cmd) && fwd(r) >= -70).sort((a, b) => side(a) - side(b));
    const third = foot.length / 3;
    foot.forEach((r, k) => (r.group = foot.length < 3 ? 'center' : k < third ? 'left' : k >= foot.length - third ? 'right' : 'center'));
    for (const r of regs) {
      if (cmd && r.general?.id === cmd) r.group = 'reserve';
      else if (r.unit.mounted) r.group = 'strike';
      else if (!foot.includes(r)) r.group = 'reserve';
    }
  }

  setStance(ids: number[], st: Stance): void {
    const w = this.w;
    const enemies = this.enemies();
    for (const id of ids) {
      const r = w.regs[id];
      if (!r || r.gone || r.team !== this.team) continue;
      r.stance = st;
      r.stanceX = r.mx;
      r.stanceZ = r.mz;
      if (st === 'lure') {
        r.lureStage = 'go';
        r.lureT = w.t;
        r.hold = false;
      } else if (st === 'retreat') {
        const [dx, dz] = this.enemyDir(r, enemies);
        r.stanceX = r.mx - dx * 60;
        r.stanceZ = r.mz - dz * 60;
        w.commandMove([r.id], r.stanceX, r.stanceZ, Math.atan2(dx, dz), undefined, true);
      } else if (st === 'hold') {
        r.hold = !r.ranged && !r.unit.mounted;
        if (r.order.type === 'move' || r.order.type === 'attack') w.commandHalt([r.id]);
      } else {
        r.hold = false;
      }
    }
    this.next = 0;
  }

  update(): void {
    const w = this.w;
    if (!w.started || w.over || w.t < this.next) return;
    this.next = w.t + 0.5;
    const mine = this.mine();
    const auto = mine.filter((r) => r.stance !== 'free');
    if (!auto.length) return;
    const enemies = this.enemies();
    for (const r of auto) {
      switch (r.stance) {
        case 'hold':
          this.hold(r, enemies);
          break;
        case 'advance':
          this.advance(r, enemies, auto);
          break;
        case 'retreat':
          if (Math.hypot(r.mx - r.stanceX, r.mz - r.stanceZ) < 12 || r.order.type === 'idle') {
            r.stance = 'hold';
            r.stanceX = r.mx;
            r.stanceZ = r.mz;
            r.hold = !r.ranged && !r.unit.mounted;
          }
          break;
        case 'flank':
          this.flank(r, enemies);
          break;
        case 'lure':
          this.lure(r, enemies);
          break;
      }
    }
  }

  private nearest(r: Regiment, list: Regiment[], max: number, filter?: (e: Regiment) => boolean): Regiment | null {
    let best: Regiment | null = null;
    let bd = max;
    for (const e of list) {
      if (filter && !filter(e)) continue;
      const d = Math.hypot(e.mx - r.mx, e.mz - r.mz) - e.radius * 0.5;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private busy(r: Regiment): boolean {
    const t = r.order.type === 'attack' && r.order.target >= 0 ? this.w.regs[r.order.target] : null;
    return !!t && !t.gone;
  }

  /** 固守：留在錨點、轉向迎敵；騎兵只反擊靠近的敵軍 */
  private hold(r: Regiment, enemies: Regiment[]): void {
    const w = this.w;
    const home = { mx: r.stanceX, mz: r.stanceZ };
    const far = Math.hypot(r.mx - home.mx, r.mz - home.mz);
    if (r.unit.mounted && !r.ranged) {
      const t = this.nearest(r, enemies, 50, (e) => Math.hypot(e.mx - home.mx, e.mz - home.mz) < 60);
      if (t && far < 80) {
        if (r.order.target !== t.id) w.commandAttack([r.id], t.id, true);
      } else if (far > 20 && r.order.type !== 'move') w.commandMove([r.id], home.mx, home.mz, r.facing);
      return;
    }
    if (r.ranged) {
      const t = this.nearest(r, enemies, r.unit.ranged!.range * 0.95);
      if (t && r.fireTarget !== t.id) r.fireTarget = t.id;
      return;
    }
    // 步兵：被側擊、背襲且正面沒有敵人纏住 → 轉向
    if (r.engagedWith.size > 0 && (r.flankHits > 0 || r.rearHits > 0)) {
      let x = 0;
      let z = 0;
      let n = 0;
      let frontPinned = false;
      for (const id of r.engagedWith) {
        const e = w.regs[id];
        const a = Math.atan2(e.mx - r.mx, e.mz - r.mz);
        let d = a - r.facing;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < 1.0) frontPinned = true;
        x += e.mx * e.alive;
        z += e.mz * e.alive;
        n += e.alive;
      }
      if (!frontPinned && n > 0) {
        const face = Math.atan2(x / n - r.mx, z / n - r.mz);
        w.commandMove([r.id], r.mx, r.mz, face);
        r.hold = true;
      }
      return;
    }
    if (far > 25 && r.engagedWith.size === 0 && r.order.type !== 'move') {
      const [dx, dz] = this.enemyDir(r, enemies);
      w.commandMove([r.id], home.mx, home.mz, Math.atan2(dx, dz));
    }
  }

  /** 推進：接近就接戰，否則整組一起往前（不超前隊伍太多）；弓兵跟在步兵後面 */
  private advance(r: Regiment, enemies: Regiment[], auto: Regiment[]): void {
    const w = this.w;
    if (r.engagedWith.size > 0 && this.busy(r)) return;
    if (r.ranged && !r.unit.mounted) {
      const t = this.nearest(r, enemies, r.unit.ranged!.range * 0.9);
      if (t) {
        if (r.order.target !== t.id) w.commandAttack([r.id], t.id);
        return;
      }
    } else {
      const reach = r.unit.mounted ? 130 : 70;
      // 騎兵優先打弓兵與已被纏住的敵軍；步兵打最近的
      let t: Regiment | null = null;
      if (r.unit.mounted) {
        let bs = -Infinity;
        for (const e of enemies) {
          const d = Math.hypot(e.mx - r.mx, e.mz - r.mz);
          if (d > reach) continue;
          let s = -d;
          if (e.unit.cls === 'missile') s += 60;
          if (e.engagedWith.size > 0) s += 40;
          if (e.unit.cls === 'pole') s -= 70;
          if (s > bs) {
            bs = s;
            t = e;
          }
        }
      } else t = this.nearest(r, enemies, reach);
      if (t) {
        if (r.order.target !== t.id) w.commandAttack([r.id], t.id, r.unit.mounted || undefined);
        return;
      }
    }
    // 整組往前：同組（同分組、同姿態）的推進進度
    const mates = auto.filter((m) => m.stance === 'advance' && m.group === r.group);
    const [dx, dz] = this.enemyDir(r, enemies);
    const prog = (m: Regiment) => m.mx * dx + m.mz * dz;
    const foot = mates.filter((m) => !m.unit.mounted && !m.ranged);
    const avg = (foot.length ? foot : mates).reduce((a, m) => a + prog(m), 0) / Math.max(1, (foot.length ? foot : mates).length);
    const mine = prog(r);
    // 弓兵保持在步兵後方 25 m（平穩跟進，不走走停停）；其他不超前 15 m
    const limit = r.ranged ? avg - 25 : avg + 15;
    if (r.ranged && mates.length > 1) {
      if (mine > limit + 10) {
        if (r.order.type === 'move') w.commandHalt([r.id]);
        return;
      }
      if (limit - mine < 15) return;
    } else if (mine > limit && mates.length > 1) {
      if (r.order.type === 'move') w.commandHalt([r.id]);
      return;
    }
    const step = Math.min(40, limit - mine + 30);
    const tx = r.mx + dx * step;
    const tz = r.mz + dz * step;
    if (r.order.type !== 'move' || Math.hypot(r.order.x - tx, r.order.z - tz) > 15) w.commandMove([r.id], tx, tz, Math.atan2(dx, dz));
  }

  /** 誘敵：上前挑釁 → 被追就跑回陷阱點（下令時的位置）→ 到了改固守 */
  private lure(r: Regiment, enemies: Regiment[]): void {
    const w = this.w;
    const home = { mx: r.stanceX, mz: r.stanceZ };
    const near = this.nearest(r, enemies, 300);
    if (!near) return;
    const d = Math.hypot(near.mx - r.mx, near.mz - r.mz) - near.radius;
    if (r.lureStage === 'go') {
      // 靠近到 35 m（弓兵射程內就放箭）或已經接觸 → 掉頭跑
      if (d < 40 || r.engagedWith.size > 0 || (r.ranged && d < r.unit.ranged!.range * 0.8 && w.t - r.lureT > 6)) {
        r.lureStage = 'back';
        r.lureT = w.t;
        w.commandMove([r.id], home.mx, home.mz, Math.atan2(near.mx - home.mx, near.mz - home.mz), undefined, true);
        return;
      }
      if (r.order.type !== 'move' || Math.hypot(r.order.x - near.mx, r.order.z - near.mz) > 20) {
        const a = Math.atan2(near.mx - r.mx, near.mz - r.mz);
        w.commandMove([r.id], near.mx - Math.sin(a) * 30, near.mz - Math.cos(a) * 30, a);
      }
      return;
    }
    // 退回中：到了陷阱點就固守；敵人沒追來就再去挑釁
    const atHome = Math.hypot(r.mx - home.mx, r.mz - home.mz) < 15;
    if (atHome) {
      const chased = enemies.some((e) => Math.hypot(e.mx - r.mx, e.mz - r.mz) < 90);
      if (chased) {
        r.stance = 'hold';
        r.hold = !r.ranged && !r.unit.mounted;
        return;
      }
      if (w.t - r.lureT > 12) {
        r.lureStage = 'go';
        r.lureT = w.t;
      }
    } else if (r.order.type !== 'move') w.commandMove([r.id], home.mx, home.mz, r.facing, undefined, true);
  }

  /** 包抄：繞到目標的側後方再進攻 */
  private flank(r: Regiment, enemies: Regiment[]): void {
    const w = this.w;
    if (r.engagedWith.size > 0 && this.busy(r)) return;
    if (!enemies.length) return;
    // 目標：已被我軍纏住的敵軍優先
    let t: Regiment | null = null;
    let bs = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.mx - r.mx, e.mz - r.mz) * (e.engagedWith.size > 0 ? 0.6 : 1);
      if (d < bs && d < 320) {
        bs = d;
        t = e;
      }
    }
    if (!t) return;
    const f = t.facing;
    const fx = Math.sin(f);
    const fz = Math.cos(f);
    // 目標的右手邊 (cos f, −sin f)；選離我比較近的那一側
    const sx = Math.cos(f);
    const sz = -Math.sin(f);
    const sign = (r.mx - t.mx) * sx + (r.mz - t.mz) * sz >= 0 ? 1 : -1;
    const off = t.frontage() / 2 + 18;
    const back = t.depth() / 2 + 8;
    const px = t.mx + sx * sign * off - fx * back;
    const pz = t.mz + sz * sign * off - fz * back;
    const dPoint = Math.hypot(px - r.mx, pz - r.mz);
    const dTarget = Math.hypot(t.mx - r.mx, t.mz - r.mz);
    // 已經在側後方、或已經貼近 → 進攻
    const behind = (r.mx - t.mx) * fx + (r.mz - t.mz) * fz < t.depth() / 2;
    if (dPoint < 18 || (dTarget < t.radius + 20 && behind)) {
      if (r.order.target !== t.id) w.commandAttack([r.id], t.id, true);
      return;
    }
    if (r.order.type !== 'move' || Math.hypot(r.order.x - px, r.order.z - pz) > 12) w.commandMove([r.id], px, pz, Math.atan2(t.mx - px, t.mz - pz), undefined, true);
  }
}
