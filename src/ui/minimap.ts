// 小地圖：地形底圖（預先算好）＋ 雙方軍團、糧倉、鏡頭視野；點擊移動鏡頭
import type { RtsCamera } from '../input/camera';
import { WATER_LEVEL } from '../map/heightfield';
import type { World } from '../sim/world';

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;

  constructor(
    private w: World,
    private cam: RtsCamera,
    private size: number,
  ) {
    const dpr = Math.min(2, devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.base = this.renderBase();
    const go = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const [x, z] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.cam.set(x, z, undefined, undefined, false);
    };
    let down = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      down = true;
      go(e);
    });
    this.canvas.addEventListener('pointermove', (e) => down && go(e));
    this.onUp = () => (down = false);
    addEventListener('pointerup', this.onUp);
  }

  private onUp: () => void;

  dispose(): void {
    removeEventListener('pointerup', this.onUp);
  }

  private toMap(x: number, z: number): [number, number] {
    const p = this.w.hf.play;
    return [((x + p / 2) / p) * this.size, ((z + p / 2) / p) * this.size];
  }
  private toWorld(mx: number, my: number): [number, number] {
    const p = this.w.hf.play;
    return [(mx / this.size) * p - p / 2, (my / this.size) * p - p / 2];
  }

  private renderBase(): HTMLCanvasElement {
    const n = 128;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    const img = g.createImageData(n, n);
    const hf = this.w.hf;
    const p = hf.play;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i / n) * p - p / 2;
        const z = (j / n) * p - p / 2;
        const h = hf.height(x, z);
        const k = (j * n + i) * 4;
        let r = 120;
        let gg = 170;
        let b = 80;
        const shade = Math.max(-30, Math.min(40, (h - this.w.baseHeight) * 3));
        r += shade;
        gg += shade;
        b += shade * 0.5;
        const f = hf.forestAt(x, z);
        r -= f * 55;
        gg -= f * 40;
        b -= f * 30;
        const rd = hf.roadAt(x, z);
        r += rd * 80;
        gg += rd * 30;
        b += rd * 20;
        if (h < WATER_LEVEL) {
          r = 60;
          gg = 150;
          b = 190;
        }
        img.data[k] = r;
        img.data[k + 1] = gg;
        img.data[k + 2] = b;
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  draw(): void {
    const g = this.ctx;
    const s = this.size;
    const w = this.w;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0, s, s);
    // 糧道路線：己方顏色；被切斷紅色、補給點失守灰色
    for (const team of w.teams) {
      for (const st of w.supplySources(team)) {
        if (st.route.length < 2) continue;
        const lost = st.burnt || st.team !== st.owner;
        g.strokeStyle = lost ? 'rgba(90,80,70,0.7)' : st.cut ? '#ff3b2f' : team.color;
        g.lineWidth = st.cut ? 2.5 : 2;
        g.setLineDash(lost ? [2, 3] : [4, 3]);
        g.beginPath();
        st.route.forEach(([rx, rz], k) => {
          const [x, y] = this.toMap(rx, rz);
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
        g.setLineDash([]);
        if (st.cut && !lost) {
          const [x, y] = this.toMap(st.cutX, st.cutZ);
          g.strokeStyle = '#fff';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(x - 3, y - 3);
          g.lineTo(x + 3, y + 3);
          g.moveTo(x + 3, y - 3);
          g.lineTo(x - 3, y + 3);
          g.stroke();
        }
      }
    }
    // 糧道：輜重車
    for (const wg of w.wagons) {
      if (!wg.alive || wg.arrived) continue;
      if (wg.team !== w.player && !w.regs.some((r) => r.team === w.player && !r.gone && Math.hypot(r.mx - wg.x, r.mz - wg.z) < 150)) continue;
      const [x, y] = this.toMap(wg.x, wg.z);
      g.fillStyle = '#f2d36a';
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.fillRect(x - 2, y - 2, 4, 4);
      g.strokeRect(x - 2, y - 2, 4, 4);
    }
    // 建築
    for (const st of w.structs) {
      const [x, y] = this.toMap(st.x, st.z);
      g.fillStyle = st.burnt ? '#222' : w.teams[st.team].color;
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.beginPath();
      if (st.kind === 'hq') g.rect(x - 5, y - 5, 10, 10);
      else g.arc(x, y, st.main ? 5 : 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (st.fire > 0 && !st.burnt) {
        g.fillStyle = '#ff8a2a';
        g.beginPath();
        g.arc(x, y - 6, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 軍團
    for (const r of w.regs) {
      if (r.gone || r.name === '逃兵' || !w.isVisibleTo(r, w.player)) continue;
      const [x, y] = this.toMap(r.mx, r.mz);
      const fw = Math.max(3, (r.frontage() / w.hf.play) * s);
      const fd = Math.max(2, (r.depth() / w.hf.play) * s);
      g.save();
      g.translate(x, y);
      g.rotate(-r.facing);
      g.fillStyle = r.routing ? '#bbb' : w.teams[r.team].color;
      g.strokeStyle = '#000';
      g.lineWidth = 1;
      g.fillRect(-fw / 2, -fd / 2, fw, fd);
      g.strokeRect(-fw / 2, -fd / 2, fw, fd);
      g.restore();
    }
    // 鏡頭視野
    const [cx, cy] = this.toMap(this.cam.target.x, this.cam.target.z);
    const vr = (this.cam.viewRadius / w.hf.play) * s;
    g.save();
    g.translate(cx, cy);
    g.rotate(-this.cam.yaw);
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.strokeRect(-vr, -vr * 0.7, vr * 2, vr * 1.2);
    g.restore();
  }
}
