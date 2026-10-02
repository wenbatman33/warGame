// 軍旗：每個軍團由一名掌旗兵舉著勢力大旗（武將軍團用姓氏大旗）；潰逃時旗倒
import * as THREE from 'three';
import { FACTIONS } from '../data/factions';
import { buildBanner } from '../models/props';
import { SState } from '../sim/soldiers';
import type { World } from '../sim/world';

interface Standard {
  reg: number;
  group: THREE.Group;
  bearer: number;
}

export class Banners {
  readonly group = new THREE.Group();
  private list: Standard[] = [];

  constructor(private w: World) {
    this.group.name = 'banners';
    for (const r of w.regs) this.add(r.id);
  }

  private add(id: number): void {
    const r = this.w.regs[id];
    const f = FACTIONS[r.faction];
    const text = r.general ? r.general.name[0] : f.flag;
    const g = buildBanner({ team: f.color, text, height: r.general ? 5.6 : 4.6, big: !!r.general, seed: id });
    g.scale.setScalar(r.general ? 1.15 : 1.0);
    this.group.add(g);
    this.list.push({ reg: id, group: g, bearer: -1 });
  }

  private pickBearer(id: number): number {
    const r = this.w.regs[id];
    const s = this.w.s;
    // 第一排中央的士兵
    const mid = Math.floor(Math.min(r.width, r.members.length) / 2);
    let best = -1;
    let bd = Infinity;
    for (const i of r.members) {
      if (s.general[i]) continue;
      const d = Math.abs(s.slot[i] - mid);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  update(alpha: number): void {
    const w = this.w;
    const s = w.s;
    // 倒戈的軍團換旗
    for (const st of this.list) {
      const r = w.regs[st.reg];
      if (st.group.userData.faction && st.group.userData.faction !== r.faction) {
        this.group.remove(st.group);
        st.group = this.rebuild(st.reg);
      }
      st.group.userData.faction = r.faction;
      if (r.gone || r.routing || (r.team !== w.player && !w.isVisibleTo(r, w.player)) || r.name === '逃兵') {
        st.group.visible = false;
        continue;
      }
      let b = st.bearer;
      if (r.general?.alive) b = r.general.soldier;
      else if (b < 0 || s.state[b] !== SState.Alive || s.reg[b] !== r.id) b = st.bearer = this.pickBearer(r.id);
      if (b < 0) {
        st.group.visible = false;
        continue;
      }
      const x = s.px[b] + (s.x[b] - s.px[b]) * alpha;
      const z = s.pz[b] + (s.z[b] - s.pz[b]) * alpha;
      // 旗桿立在掌旗兵右後方
      const yaw = s.yaw[b];
      const ox = Math.cos(yaw) * -0.35 - Math.sin(yaw) * 0.25;
      const oz = -Math.sin(yaw) * -0.35 - Math.cos(yaw) * 0.25;
      st.group.position.set(x + ox, w.groundY(x, z) + (r.unit.mounted ? 1.1 : 0.2), z + oz);
      st.group.rotation.y = yaw + Math.PI / 2;
      st.group.visible = true;
    }
  }

  private rebuild(id: number): THREE.Group {
    const r = this.w.regs[id];
    const f = FACTIONS[r.faction];
    const g = buildBanner({ team: f.color, text: r.general ? r.general.name[0] : f.flag, height: r.general ? 5.6 : 4.6, big: !!r.general, seed: id });
    g.scale.setScalar(r.general ? 1.15 : 1.0);
    this.group.add(g);
    return g;
  }
}
