// 指揮操作：選取（點選／框選／卡片）、右鍵移動／攻擊、右鍵拖曳畫戰線、鏡頭（滑鼠＋觸控）
import * as THREE from 'three';
import type { PlanPreview } from '../render/overlays';
import type { Regiment } from '../sim/regiment';
import { SState } from '../sim/soldiers';
import type { World } from '../sim/world';
import { CAM, RtsCamera } from './camera';

export interface ControlHooks {
  onOrder?: (kind: 'move' | 'attack' | 'struct' | 'line', ids: number[]) => void;
  onSelect?: (ids: number[]) => void;
  /** 計策／技能等待選目標時攔截點擊（回傳 true 表示已處理） */
  onTargetPick?: (x: number, z: number) => boolean;
  onPause?: () => void;
  onSpeed?: (s: number) => void;
  onKey?: (key: string, e: KeyboardEvent) => boolean;
  /** 部署階段：拖曳己方軍團改位置 */
  deployMode?: () => boolean;
  onDeployMove?: (id: number, x: number, z: number) => void;
  /** 部署階段：右鍵擺放（直接就位，不用走過去） */
  onDeployPlace?: (id: number, x: number, z: number, facing: number, width?: number) => void;
}

const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export class Controls {
  readonly selected = new Set<number>();
  hover = -1;
  hoverStruct = -1;
  preview: PlanPreview[] | null = null;
  groups: number[][] = Array.from({ length: 10 }, () => []);
  /** 觸控模式：點地面＝移動 */
  multiSelect = false;
  private keys = new Set<string>();
  private el: HTMLElement;
  private box: HTMLDivElement;
  private ptr = new Map<number, { x: number; y: number; sx: number; sy: number; t: number; b: number }>();
  private lmb: { x: number; y: number; box: boolean } | null = null;
  private rmb: { x: number; y: number; gx: number; gz: number; line: boolean; t: number } | null = null;
  private mmb: { x: number; y: number; rot: boolean } | null = null;
  private lastRClick = 0;
  private touchLong: number | null = null;
  private touchLine: { gx: number; gz: number } | null = null;
  private pinch: { d: number; a: number; cx: number; cy: number } | null = null;
  private dragDeploy: { id: number; ox: number; oz: number } | null = null;
  mouse = { x: 0, y: 0, gx: 0, gz: 0, inside: false };

  constructor(
    private world: World,
    private cam: RtsCamera,
    private camera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    private hooks: ControlHooks,
  ) {
    this.el = canvas;
    this.box = document.createElement('div');
    this.box.style.cssText = 'position:fixed;border:2px solid #fff;background:rgba(255,255,255,0.12);pointer-events:none;display:none;z-index:5;border-radius:3px';
    document.body.appendChild(this.box);
    canvas.addEventListener('pointerdown', this.onDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContext);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
  }

  private onContext = (e: Event): void => e.preventDefault();
  private onKeyUp = (e: KeyboardEvent): void => {
    // macOS 按住 Cmd 時放開字母鍵不會有 keyup：放開 Meta 就全部清掉
    if (e.key === 'Meta' || e.key === 'Control') this.keys.clear();
    else this.keys.delete(e.key.toLowerCase());
  };
  private onBlur = (): void => this.keys.clear();

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContext);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    if (this.touchLong) clearTimeout(this.touchLong);
    this.box.remove();
  }

  /** 這次觸控期間曾經有兩指以上（結束時不算點擊） */
  private multiTouch = false;

  // ───────────── 拾取 ─────────────

  /** 螢幕座標 → 地面點（沿射線步進高度場） */
  ground(sx: number, sy: number): THREE.Vector3 | null {
    const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    _ray.setFromCamera(ndc, this.camera);
    const o = _ray.ray.origin;
    const d = _ray.ray.direction;
    const hf = this.world.hf;
    let t = 0;
    let prev = 0;
    for (let k = 0; k < 600; k++) {
      t += 2 + t * 0.01;
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (y < hf.groundOrWater(x, z)) {
        // 二分逼近
        let a = prev;
        let b = t;
        for (let n = 0; n < 12; n++) {
          const m = (a + b) / 2;
          if (o.y + d.y * m < hf.groundOrWater(o.x + d.x * m, o.z + d.z * m)) b = m;
          else a = m;
        }
        return _v.set(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b).clone();
      }
      prev = t;
      if (t > 3000) break;
    }
    return null;
  }

  /** 地面點附近的軍團（以最近士兵判定） */
  regimentAt(x: number, z: number, radius = 3.5): number {
    const w = this.world;
    const s = w.s;
    const n = w.hash.near(x, z, radius);
    let best = -1;
    let bd = radius * radius;
    for (let k = 0; k < n; k++) {
      const i = w.hash.res[k];
      if (s.state[i] !== SState.Alive) continue;
      const r = w.regs[s.reg[i]];
      if (!w.isVisibleTo(r, w.player) || r.name === '逃兵') continue;
      const d2 = (s.x[i] - x) ** 2 + (s.z[i] - z) ** 2;
      if (d2 < bd) {
        bd = d2;
        best = r.id;
      }
    }
    if (best >= 0) return best;
    // 退而求其次：在軍團外框內
    for (const r of w.regs) {
      if (r.gone || !w.isVisibleTo(r, w.player) || r.name === '逃兵') continue;
      const c = Math.cos(r.facing);
      const sn = Math.sin(r.facing);
      const dx = x - r.mx;
      const dz = z - r.mz;
      const lx = dx * c - dz * sn;
      const lz = dx * sn + dz * c;
      if (Math.abs(lx) < r.frontage() / 2 + 1 && Math.abs(lz) < r.depth() / 2 + 1) return r.id;
    }
    return -1;
  }

  structAt(x: number, z: number): number {
    for (const st of this.world.structs) if (!st.burnt && Math.hypot(st.x - x, st.z - z) < st.radius) return st.id;
    return -1;
  }

  screenOf(x: number, y: number, z: number): { x: number; y: number; vis: boolean } {
    _v.set(x, y, z).project(this.camera);
    return { x: ((_v.x + 1) / 2) * innerWidth, y: ((1 - _v.y) / 2) * innerHeight, vis: _v.z < 1 && _v.z > -1 };
  }

  // ───────────── 選取 ─────────────

  select(ids: number[], add = false): void {
    if (!add) this.selected.clear();
    for (const id of ids) {
      const r = this.world.regs[id];
      if (r && r.team === this.world.player && !r.gone) this.selected.add(id);
    }
    this.hooks.onSelect?.([...this.selected]);
  }

  toggle(id: number): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.hooks.onSelect?.([...this.selected]);
  }

  private mine(): number[] {
    return [...this.selected].filter((id) => {
      const r = this.world.regs[id];
      return r && !r.gone && !r.routing;
    });
  }

  // ───────────── 下令 ─────────────

  /** 右鍵點擊：攻擊／移動（多選時保持相對位置並旋轉） */
  orderAt(x: number, z: number, run: boolean): void {
    const ids = this.mine();
    if (!ids.length) return;
    const w = this.world;
    const target = this.regimentAt(x, z);
    if (target >= 0 && w.regs[target].team !== w.player) {
      w.commandAttack(ids, target, run || undefined);
      this.hooks.onOrder?.('attack', ids);
      return;
    }
    const st = this.structAt(x, z);
    if (st >= 0 && w.structs[st].team !== w.player && w.structs[st].kind !== 'water') {
      w.commandAttackStruct(ids, st);
      this.hooks.onOrder?.('struct', ids);
      return;
    }
    const regs = ids.map((id) => w.regs[id]);
    if (this.hooks.deployMode?.()) {
      // 部署：整組平移到點擊處
      let cx = 0;
      let cz = 0;
      for (const r of regs) {
        cx += r.cx;
        cz += r.cz;
      }
      cx /= regs.length;
      cz /= regs.length;
      for (const r of regs) this.hooks.onDeployPlace?.(r.id, x + r.cx - cx, z + r.cz - cz, r.facing);
      this.hooks.onOrder?.('move', ids);
      return;
    }
    let gx = 0;
    let gz = 0;
    for (const r of regs) {
      gx += r.mx;
      gz += r.mz;
    }
    gx /= regs.length;
    gz /= regs.length;
    const face = Math.atan2(x - gx, z - gz);
    if (regs.length === 1) {
      w.commandMove(ids, x, z, Math.hypot(x - gx, z - gz) > 4 ? face : regs[0].facing, undefined, run);
    } else {
      // 群組：以群組朝向旋轉相對位置
      let fx = 0;
      let fz = 0;
      for (const r of regs) {
        fx += Math.sin(r.facing);
        fz += Math.cos(r.facing);
      }
      const oldF = Math.atan2(fx, fz);
      const da = face - oldF;
      const c = Math.cos(da);
      const s = Math.sin(da);
      for (const r of regs) {
        const ox = r.mx - gx;
        const oz = r.mz - gz;
        const nx = ox * c + oz * s;
        const nz = -ox * s + oz * c;
        w.commandMove([r.id], x + nx, z + nz, face, undefined, run);
      }
    }
    this.hooks.onOrder?.('move', ids);
  }

  /** 戰線規劃：從 a 拉到 b，依兵力分配寬度 */
  planLine(ax: number, az: number, bx: number, bz: number): PlanPreview[] {
    const ids = this.mine();
    const w = this.world;
    const regs = ids.map((id) => w.regs[id]);
    if (!regs.length) return [];
    const L = Math.max(4, Math.hypot(bx - ax, bz - az));
    const dx = (bx - ax) / L;
    const dz = (bz - az) / L;
    // 朝向：垂直於線、背對鏡頭
    let nx = dz;
    let nz = -dx;
    const [cfx, cfz] = this.cam.forward();
    if (nx * cfx + nz * cfz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const facing = Math.atan2(nx, nz);
    // 依目前在線上的投影排序，避免交叉
    regs.sort((p, q) => (p.mx - ax) * dx + (p.mz - az) * dz - ((q.mx - ax) * dx + (q.mz - az) * dz));
    const gap = 3;
    const total = regs.reduce((a, r) => a + r.alive * r.unit.spacing[0] * r.spacingMul(), 0);
    const avail = Math.max(regs.length * 4, L - gap * (regs.length - 1));
    const out: PlanPreview[] = [];
    let pos = 0;
    for (const r of regs) {
      const share = (r.alive * r.unit.spacing[0] * r.spacingMul()) / total;
      const len = avail * share;
      const sx = r.unit.spacing[0] * r.spacingMul();
      // 至少兩排縱深（太薄的陣線一衝就破）
      const files = Math.max(2, Math.min(Math.ceil(r.alive / 2), Math.round(len / sx)));
      const realLen = files * sx;
      const mid = pos + len / 2;
      out.push({ reg: r, x: ax + dx * mid, z: az + dz * mid, facing, width: files });
      pos += len + gap;
      void realLen;
    }
    return out;
  }

  commitLine(plan: PlanPreview[], run: boolean): void {
    if (this.hooks.deployMode?.()) {
      for (const p of plan) this.hooks.onDeployPlace?.(p.reg.id, p.x, p.z, p.facing, p.width);
      this.hooks.onOrder?.('line', plan.map((p) => p.reg.id));
      return;
    }
    for (const p of plan) this.world.commandMove([p.reg.id], p.x, p.z, p.facing, p.width, run);
    this.hooks.onOrder?.('line', plan.map((p) => p.reg.id));
  }

  // ───────────── 指標事件 ─────────────

  private onDown = (e: PointerEvent): void => {
    this.el.setPointerCapture?.(e.pointerId);
    const g = this.ground(e.clientX, e.clientY);
    if (e.pointerType === 'touch') {
      this.ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), b: 0 });
      if (this.ptr.size === 1) {
        this.touchLine = null;
        this.touchLong = window.setTimeout(() => {
          // 長按：有選取 → 畫戰線；部署中 → 拖曳軍團
          if (g && this.mine().length) this.touchLine = { gx: g.x, gz: g.z };
          navigator.vibrate?.(15);
        }, 380);
        if (g && this.hooks.deployMode?.()) {
          const id = this.regimentAt(g.x, g.z, 6);
          if (id >= 0 && this.world.regs[id].team === this.world.player) {
            clearTimeout(this.touchLong!);
            this.dragDeploy = { id, ox: this.world.regs[id].cx - g.x, oz: this.world.regs[id].cz - g.z };
            this.select([id]);
          }
        }
      } else {
        if (this.touchLong) clearTimeout(this.touchLong);
        this.touchLine = null;
        this.preview = null;
        this.dragDeploy = null;
        this.multiTouch = true;
        this.pinch = this.pinchState();
      }
      return;
    }
    if (e.button === 0) {
      this.lmb = { x: e.clientX, y: e.clientY, box: false };
      if (g && this.hooks.deployMode?.()) {
        const id = this.regimentAt(g.x, g.z, 6);
        if (id >= 0 && this.world.regs[id].team === this.world.player) {
          this.dragDeploy = { id, ox: this.world.regs[id].cx - g.x, oz: this.world.regs[id].cz - g.z };
          if (!this.selected.has(id)) this.select([id], e.shiftKey);
          this.lmb = null;
        }
      }
    } else if (e.button === 2) {
      if (g) this.rmb = { x: e.clientX, y: e.clientY, gx: g.x, gz: g.z, line: false, t: performance.now() };
    } else if (e.button === 1) {
      e.preventDefault();
      this.mmb = { x: e.clientX, y: e.clientY, rot: e.shiftKey || e.ctrlKey || e.altKey };
    }
  };

  private pinchState(): { d: number; a: number; cx: number; cy: number } | null {
    const p = [...this.ptr.values()];
    if (p.length < 2) return null;
    const dx = p[1].x - p[0].x;
    const dy = p[1].y - p[0].y;
    return { d: Math.hypot(dx, dy), a: Math.atan2(dy, dx), cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
  }

  private onMove = (e: PointerEvent): void => {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = e.target === this.el;
    if (e.pointerType === 'touch') {
      const p = this.ptr.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.ptr.size >= 2) {
        const ps = this.pinchState();
        if (ps && this.pinch) {
          this.cam.zoomBy(this.pinch.d / Math.max(10, ps.d));
          this.cam.rotateBy(-(ps.a - this.pinch.a));
          this.cam.panScreen(ps.cx - this.pinch.cx, ps.cy - this.pinch.cy, innerHeight);
        }
        this.pinch = ps;
        return;
      }
      const moved = Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 10;
      if (moved && this.touchLong && !this.touchLine) {
        clearTimeout(this.touchLong);
        this.touchLong = null;
      }
      if (this.dragDeploy) {
        const g = this.ground(e.clientX, e.clientY);
        if (g) this.hooks.onDeployMove?.(this.dragDeploy.id, g.x + this.dragDeploy.ox, g.z + this.dragDeploy.oz);
        return;
      }
      if (this.touchLine) {
        const g = this.ground(e.clientX, e.clientY);
        if (g) this.preview = this.planLine(this.touchLine.gx, this.touchLine.gz, g.x, g.z);
        return;
      }
      this.cam.panScreen(dx, dy, innerHeight);
      return;
    }
    const g = this.ground(e.clientX, e.clientY);
    if (g) {
      this.mouse.gx = g.x;
      this.mouse.gz = g.z;
      if (!this.lmb?.box && !this.rmb?.line) {
        this.hover = this.regimentAt(g.x, g.z);
        this.hoverStruct = this.hover < 0 ? this.structAt(g.x, g.z) : -1;
      }
    }
    if (this.dragDeploy && g) {
      this.hooks.onDeployMove?.(this.dragDeploy.id, g.x + this.dragDeploy.ox, g.z + this.dragDeploy.oz);
      return;
    }
    if (this.lmb) {
      const dx = e.clientX - this.lmb.x;
      const dy = e.clientY - this.lmb.y;
      if (!this.lmb.box && Math.hypot(dx, dy) > 6) this.lmb.box = true;
      if (this.lmb.box) {
        const x0 = Math.min(this.lmb.x, e.clientX);
        const y0 = Math.min(this.lmb.y, e.clientY);
        Object.assign(this.box.style, { display: 'block', left: x0 + 'px', top: y0 + 'px', width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px' });
      }
    }
    if (this.rmb && g) {
      if (!this.rmb.line && Math.hypot(e.clientX - this.rmb.x, e.clientY - this.rmb.y) > 10 && this.mine().length) this.rmb.line = true;
      if (this.rmb.line) this.preview = this.planLine(this.rmb.gx, this.rmb.gz, g.x, g.z);
    }
    if (this.mmb) {
      const dx = e.clientX - this.mmb.x;
      const dy = e.clientY - this.mmb.y;
      this.mmb.x = e.clientX;
      this.mmb.y = e.clientY;
      if (this.mmb.rot) this.cam.rotateBy(-dx * 0.006);
      else this.cam.panScreen(dx, dy, innerHeight);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      const p = this.ptr.get(e.pointerId);
      this.ptr.delete(e.pointerId);
      if (this.touchLong) clearTimeout(this.touchLong);
      this.touchLong = null;
      if (this.ptr.size > 0) {
        this.pinch = this.pinchState();
        return;
      }
      this.pinch = null;
      const wasMulti = this.multiTouch;
      this.multiTouch = false;
      if (this.dragDeploy) {
        this.dragDeploy = null;
        return;
      }
      if (wasMulti) {
        this.touchLine = null;
        this.preview = null;
        return;
      }
      if (this.touchLine && this.preview) {
        this.commitLine(this.preview, false);
        this.preview = null;
        this.touchLine = null;
        return;
      }
      this.touchLine = null;
      this.preview = null;
      if (p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 12 && performance.now() - p.t < 450) this.tap(e.clientX, e.clientY);
      return;
    }
    if (this.dragDeploy) {
      this.dragDeploy = null;
      return;
    }
    if (e.button === 0 && this.lmb) {
      if (this.lmb.box) this.boxSelect(this.lmb.x, this.lmb.y, e.clientX, e.clientY, e.shiftKey);
      else this.click(e.clientX, e.clientY, e.shiftKey, e.ctrlKey || e.metaKey);
      this.lmb = null;
      this.box.style.display = 'none';
    } else if (e.button === 2 && this.rmb) {
      const now = performance.now();
      if (this.rmb.line && this.preview) {
        this.commitLine(this.preview, now - this.lastRClick < 350);
      } else {
        const dbl = now - this.lastRClick < 350;
        this.orderAt(this.rmb.gx, this.rmb.gz, dbl);
      }
      this.lastRClick = now;
      this.rmb = null;
      this.preview = null;
    } else if (e.button === 1) this.mmb = null;
  };

  /** 觸控點一下 */
  private tap(x: number, y: number): void {
    const g = this.ground(x, y);
    if (!g) return;
    if (this.hooks.onTargetPick?.(g.x, g.z)) return;
    const id = this.regimentAt(g.x, g.z, 5);
    const w = this.world;
    if (id >= 0 && w.regs[id].team === w.player) {
      if (this.multiSelect) this.toggle(id);
      else if (this.selected.size === 1 && this.selected.has(id)) this.select([]);
      else this.select([id]);
      return;
    }
    if (this.mine().length) this.orderAt(g.x, g.z, false);
  }

  private click(x: number, y: number, shift: boolean, ctrl: boolean): void {
    const g = this.ground(x, y);
    if (!g) return;
    if (this.hooks.onTargetPick?.(g.x, g.z)) return;
    const id = this.regimentAt(g.x, g.z);
    const w = this.world;
    if (id >= 0 && w.regs[id].team === w.player) {
      if (ctrl) this.select(w.regs.filter((r) => r.team === w.player && !r.gone && r.type === w.regs[id].type).map((r) => r.id), shift);
      else if (shift) this.toggle(id);
      else this.select([id]);
    } else if (!shift) this.select([]);
  }

  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    const w = this.world;
    const ids: number[] = [];
    for (const r of w.regs) {
      if (r.team !== w.player || r.gone || r.name === '逃兵') continue;
      const p = this.screenOf(r.mx, w.groundY(r.mx, r.mz) + 1, r.mz);
      if (p.vis && p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) ids.push(r.id);
    }
    this.select(ids, add);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const g = this.ground(e.clientX, e.clientY);
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.cam.zoomBy(Math.exp(dy * 0.0012), g ?? undefined);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (this.hooks.onKey?.(k, e)) return;
    if (!e.metaKey && !e.ctrlKey) this.keys.add(k);
    const w = this.world;
    const ids = this.mine();
    if (k === ' ') {
      e.preventDefault();
      this.hooks.onPause?.();
    } else if (k >= '0' && k <= '9' && !e.repeat) {
      const n = Number(k);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups[n] = [...this.selected];
      } else if (this.groups[n].length) this.select(this.groups[n].filter((id) => !w.regs[id].gone));
      else if (n >= 1 && n <= 3 && !this.groups[n].length) this.hooks.onSpeed?.([0.5, 1, 2][n - 1]);
    } else if (k === 'h') w.commandHalt(ids);
    else if (k === 'r') for (const id of ids) w.regs[id].run = !w.regs[id].run;
    else if (k === 'g') for (const id of ids) w.regs[id].hold = !w.regs[id].hold;
    else if (k === 'f') for (const id of ids) w.regs[id].fireAtWill = !w.regs[id].fireAtWill;
    else if (k === 't') {
      const order: Regiment['formation'][] = ['line', 'square', 'wedge', 'loose'];
      for (const id of ids) {
        const r = w.regs[id];
        w.setFormation([id], order[(order.indexOf(r.formation) + 1) % order.length]);
      }
    } else if (k === 'backspace') w.commandRetreat(ids);
    else if (k === 'escape') this.select([]);
    else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.select(w.regs.filter((r) => r.team === w.player && !r.gone).map((r) => r.id));
    }
  };

  /** 每幀：鍵盤平移、邊緣捲動 */
  update(dt: number): void {
    const [fx, fz] = this.cam.forward();
    const [rx, rz] = this.cam.right();
    const sp = this.cam.dist * CAM.keyPanSpeed * dt;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) this.cam.panBy(fx * sp, fz * sp);
    if (k.has('s') || k.has('arrowdown')) this.cam.panBy(-fx * sp, -fz * sp);
    if (k.has('d') || k.has('arrowright')) this.cam.panBy(rx * sp, rz * sp);
    if (k.has('a') || k.has('arrowleft')) this.cam.panBy(-rx * sp, -rz * sp);
    if (k.has('q')) this.cam.rotateBy(CAM.rotateSpeed * dt);
    if (k.has('e')) this.cam.rotateBy(-CAM.rotateSpeed * dt);
    if (CAM.edgePan && this.mouse.inside && !this.lmb && !this.rmb && matchMedia('(pointer:fine)').matches) {
      const m = 6;
      if (this.mouse.x < m) this.cam.panBy(-rx * sp, -rz * sp);
      if (this.mouse.x > innerWidth - m) this.cam.panBy(rx * sp, rz * sp);
      if (this.mouse.y < m) this.cam.panBy(fx * sp, fz * sp);
      if (this.mouse.y > innerHeight - m) this.cam.panBy(-fx * sp, -fz * sp);
    }
  }
}
