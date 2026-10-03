// 地點地圖玩法的操作介面：手指滑動指揮
//  從我軍部隊滑到地點＝移動（森林＝埋伏）；滑到敵軍＝進攻（放手前顯示勝算）；滑過敵軍再滑到地點＝誘敵
//  把計策卡拖到地點上＝施放；點一下部隊＝看資訊；空白處拖曳＝移動鏡頭
import { audio } from '../audio/audio';
import { GENERALS } from '../data/generals';
import type { Battle } from '../game/battle';
import { NODE_R, TRAIT_NAME, type NUnit, type NodeGame, type Preview } from '../node/game';
import { CARD_INFO, TERRAIN_INFO, type CardId } from '../node/types';
import type { NodeMapRenderer } from '../render/nodeMap';

const TYPE_INFO: Record<NUnit['type'], { icon: string; name: string; beats: string; fears: string }> = {
  sword: { icon: '🛡️', name: '刀盾兵', beats: '—（萬用前排）', fears: '—' },
  spear: { icon: '🔱', name: '長槍兵', beats: '騎兵', fears: '弓兵' },
  archer: { icon: '🏹', name: '弓兵', beats: '長槍兵', fears: '騎兵' },
  cav: { icon: '🐎', name: '騎兵', beats: '弓兵', fears: '長槍兵' },
};

type DragKind = 'move' | 'attack' | 'lure' | null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export class NodeHud {
  readonly root: HTMLDivElement;
  private svg: SVGSVGElement;
  private labels = new Map<string, HTMLDivElement>();
  private dlabel: HTMLDivElement;
  private info: HTMLDivElement;
  private cmdEl: HTMLDivElement;
  private cards = new Map<CardId, HTMLDivElement>();
  private ghost: HTMLDivElement;
  private start: HTMLDivElement;
  private pausedTip: HTMLDivElement;
  /** 開戰前（第一次解除暫停前）的大按鈕 */
  private goBtn: HTMLDivElement;
  private begun = false;
  private selected: NUnit | null = null;
  /** 滑動中的狀態 */
  /** far＝拖曳中離起點最遠的距離（滑出去再滑回原地也算手勢，不算點一下） */
  private drag: { u: NUnit; x0: number; y0: number; x: number; y: number; far: number; passed: NUnit | null; kind: DragKind; node: string | null; foe: NUnit | null; pv: Preview | null } | null = null;
  private cardDrag: { card: CardId; x: number; y: number } | null = null;

  constructor(
    private b: Battle,
    private g: NodeGame,
    private map: NodeMapRenderer,
  ) {
    const root = (this.root = el('div', 'nodehud'));
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'nsvg');
    root.appendChild(this.svg);
    for (const n of g.nodes.values()) {
      const l = el('div', 'nlabel', `<span class="ti">${TERRAIN_INFO[n.terrain].icon}</span><b>${n.name}</b>`);
      l.title = `${n.name}（${TERRAIN_INFO[n.terrain].name}）：${TERRAIN_INFO[n.terrain].desc}`;
      root.appendChild(l);
      this.labels.set(n.id, l);
    }
    this.dlabel = el('div', 'ndrag');
    root.appendChild(this.dlabel);
    this.info = el('div', 'ninfo');
    root.appendChild(this.info);
    // 計策卡
    const cb = el('div', 'ncards');
    this.cmdEl = el('div', 'ncmd stroke');
    cb.appendChild(this.cmdEl);
    for (const c of g.sc.cards) {
      const d = CARD_INFO[c];
      const e = el('div', 'ncard', `<span class="ic">${d.icon}</span><span class="nm stroke">${d.name}</span><span class="co">${d.cost}</span>`);
      e.title = `${d.name}（${d.cost} 軍令）：${d.desc}`;
      e.addEventListener('pointerdown', (ev) => this.cardDown(ev, c));
      cb.appendChild(e);
      this.cards.set(c, e);
    }
    root.appendChild(cb);
    this.ghost = el('div', 'nghost');
    root.appendChild(this.ghost);
    // 開場（暫停中部署）
    this.start = el(
      'div',
      'nstart',
      `<div class="box"><h3>📜 用手指指揮</h3>
      <div class="row"><b>👆 滑到地點</b><span>沿道路移動；停在 🌲森林 會自動<b>埋伏</b></span></div>
      <div class="row"><b>👆 滑到敵軍</b><span>進攻：<b>放手前會顯示勝算</b></span></div>
      <div class="row"><b>👆 滑過敵軍→再滑到地點</b><span>🎣 <b>誘敵</b>：把敵人引過去</span></div>
      <div class="row"><b>🃏 把計策卡拖到地點</b><span>🔥火攻、🥁擂鼓、👁偵察</span></div>
      <p>現在是<b>暫停</b>狀態，可以先下好命令。準備好再開戰（隨時可按 ⏸ 暫停，暫停中也能下令）。</p></div>`,
    );
    const btns = el('div', 'gobtns');
    const plan = el('div', 'btn stroke', '👍 先佈陣（暫停中）');
    plan.addEventListener('click', () => {
      audio.unlock();
      this.start.remove();
    });
    const go = el('div', 'btn green stroke go', '▶ 直接開戰');
    go.addEventListener('click', () => this.begin());
    btns.append(plan, go);
    this.start.querySelector('.box')!.appendChild(btns);
    // 說明框放在 HUD 最上層（蓋過部隊徽章）
    b.hud.root.appendChild(this.start);
    this.goBtn = el('div', 'btn green stroke ngo', '▶ 開戰');
    this.goBtn.addEventListener('click', () => this.begin());
    root.appendChild(this.goBtn);
    this.pausedTip = el('div', 'npaused stroke', '⏸ 暫停中：可以繼續滑動下令');
    root.appendChild(this.pausedTip);
    b.container.appendChild(root);
    // 手勢：在容器的捕獲階段先攔截「從我軍部隊開始的拖曳」（其他拖曳照常移動鏡頭）
    b.container.addEventListener('pointerdown', this.onDown, { capture: true });
  }

  /** 開戰：解除暫停 */
  private begin(): void {
    audio.unlock();
    this.start.remove();
    this.begun = true;
    this.goBtn.remove();
    if (this.b.paused) this.b.togglePause();
  }

  dispose(): void {
    this.b.container.removeEventListener('pointerdown', this.onDown, { capture: true });
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    this.root.remove();
  }

  // ───────────────────────── 座標 ─────────────────────────

  private screenOfUnit(u: NUnit): { x: number; y: number; vis: boolean } {
    const r = this.g.reg(u);
    return this.b.controls.screenOf(r.mx, this.b.world.groundY(r.mx, r.mz) + (r.unit.mounted ? 7 : 5.5), r.mz);
  }

  private screenOfNode(id: string): { x: number; y: number; vis: boolean } {
    const n = this.g.nodes.get(id)!;
    return this.b.controls.screenOf(n.x, this.b.world.groundY(n.x, n.z) + 1, n.z);
  }

  private local(e: PointerEvent): [number, number] {
    const rc = this.b.container.getBoundingClientRect();
    return [e.clientX - rc.left, e.clientY - rc.top];
  }

  private unitAt(x: number, y: number, team: number): NUnit | null {
    let best: NUnit | null = null;
    let bd = 40;
    for (const u of this.g.units) {
      if (u.team !== team || !this.g.alive(u) || !this.g.visibleTo(u, this.b.world.player)) continue;
      const p = this.screenOfUnit(u);
      if (!p.vis) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  private nodeAt(x: number, y: number, max = 60): string | null {
    let best: string | null = null;
    let bd = max;
    for (const id of this.g.nodes.keys()) {
      const p = this.screenOfNode(id);
      if (!p.vis) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  // ───────────────────────── 滑動指揮 ─────────────────────────

  private onDown = (e: PointerEvent): void => {
    if (this.b.phase === 'end' || e.button === 2 || this.cardDrag) return;
    const [x, y] = this.local(e);
    const u = this.unitAt(x, y, this.b.world.player);
    if (!u) return;
    // 從我軍部隊開始：攔下來當成指揮手勢（不讓鏡頭跟著拖）
    e.stopPropagation();
    e.preventDefault();
    audio.unlock();
    this.drag = { u, x0: x, y0: y, x, y, far: 0, passed: null, kind: null, node: null, foe: null, pv: null };
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
  };

  private onMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d) return;
    const [x, y] = this.local(e);
    d.x = x;
    d.y = y;
    d.far = Math.max(d.far, Math.hypot(x - d.x0, y - d.y0));
    // 還沒滑出去（或滑回原地但沒經過敵軍）：不算手勢
    if (d.far < 14 || (!d.passed && Math.hypot(x - d.x0, y - d.y0) < 14)) {
      d.kind = null;
      return;
    }
    const foe = this.unitAt(x, y, 1 - this.b.world.player);
    if (foe) {
      d.passed = foe;
      d.kind = 'attack';
      d.foe = foe;
      d.node = null;
      d.pv = this.g.preview(d.u, foe);
    } else {
      const n = this.nodeAt(x, y);
      d.node = n;
      d.foe = null;
      d.pv = null;
      d.kind = n ? (d.passed ? 'lure' : 'move') : null;
    }
  };

  private onUp = (e: PointerEvent): void => {
    const d = this.drag;
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
    this.drag = null;
    if (!d) return;
    void e;
    // 幾乎沒動：點一下＝選取看資訊
    if (d.far < 14) {
      this.select(d.u);
      return;
    }
    const g = this.g;
    let ok = false;
    let text = '';
    if (d.kind === 'attack' && d.foe) {
      ok = g.orderAttack(d.u, d.foe);
      text = `${this.nameOf(d.u)}：進攻 ${this.nameOf(d.foe)}`;
    } else if (d.kind === 'lure' && d.passed && d.node) {
      const bait = g.lureTarget(d.passed);
      ok = g.orderLure(d.u, bait, d.node);
      text = `${this.nameOf(d.u)}：誘敵 ${this.nameOf(bait)} → ${g.nodes.get(d.node)!.name}`;
    } else if (d.kind === 'move' && d.node) {
      ok = g.orderMove(d.u, d.node);
      const ter = g.nodes.get(d.node)!.terrain;
      text = `${this.nameOf(d.u)}：前往 ${g.nodes.get(d.node)!.name}${ter === 'forest' ? '（埋伏）' : ''}`;
    }
    if (ok) {
      audio.play('ui_order');
      audio.voice(d.kind === 'attack' ? 'ack_attack' : 'ack_move');
      this.b.hud.toast(text, 'info', true);
      this.select(d.u);
    } else if (d.kind) audio.play('ui_error');
  };

  private select(u: NUnit | null): void {
    this.selected = u;
    this.b.controls.select(u ? [u.regId] : []);
  }

  // ───────────────────────── 計策卡 ─────────────────────────

  private cardDown(e: PointerEvent, c: CardId): void {
    e.stopPropagation();
    e.preventDefault();
    audio.unlock();
    const [x, y] = this.local(e);
    this.cardDrag = { card: c, x, y };
    const move = (ev: PointerEvent) => {
      const [mx, my] = this.local(ev);
      if (this.cardDrag) {
        this.cardDrag.x = mx;
        this.cardDrag.y = my;
      }
    };
    const up = (ev: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      const cd = this.cardDrag;
      this.cardDrag = null;
      this.map.highlight.clear();
      if (!cd) return;
      const [ux, uy] = this.local(ev);
      const n = this.nodeAt(ux, uy, 80);
      if (!n) return;
      const err = this.g.useCard(this.b.world.player, cd.card, n);
      if (err) {
        audio.play('ui_error');
        this.b.hud.toast(err, 'bad', true);
      } else {
        audio.play(cd.card === 'fire' ? 'fire_ignite' : cd.card === 'drums' ? 'drum_boost' : 'ui_order');
        if (cd.card === 'fire') this.b.cam.shake = 0.4;
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  /** 這張卡可以用在哪些地點 */
  private cardTargets(c: CardId): string[] {
    const g = this.g;
    if (c === 'fire') return [...g.nodes.values()].filter((n) => n.terrain === 'forest' || n.terrain === 'grass').map((n) => n.id);
    if (c === 'drums') return [...new Set(g.units.filter((u) => u.team === this.b.world.player && g.alive(u)).map((u) => g.nodeOf(u) ?? u.at))];
    return [...g.nodes.keys()];
  }

  // ───────────────────────── 每幀 ─────────────────────────

  private nameOf(u: NUnit): string {
    return u.general ? GENERALS[u.general].name : u.name;
  }

  update(): void {
    const g = this.g;
    const w = this.b.world;
    const me = w.player;
    // 地點標籤
    for (const [id, l] of this.labels) {
      const p = this.screenOfNode(id);
      if (!p.vis) {
        l.style.display = 'none';
        continue;
      }
      l.style.display = '';
      l.style.transform = `translate(${(p.x - 30).toFixed(0)}px, ${(p.y + 8).toFixed(0)}px)`;
      l.classList.toggle('fire', g.isBurning(id));
      l.classList.toggle('pick', this.map.highlight.has(id));
    }
    // 計策卡
    this.cmdEl.textContent = `⚡ 軍令 ${g.cmd[me].toFixed(1)}／5`;
    for (const [c, e] of this.cards) e.classList.toggle('dis', g.cmd[me] < CARD_INFO[c].cost);
    // 拖曳中的高亮
    this.map.highlight.clear();
    if (this.cardDrag) for (const id of this.cardTargets(this.cardDrag.card)) this.map.highlight.add(id);
    if (this.drag?.node) this.map.highlight.add(this.drag.node);
    this.drawArrows();
    this.drawDrag();
    this.drawGhost();
    this.drawInfo();
    if (!this.begun && !this.b.paused) {
      // 玩家用頂部按鈕解除暫停也算開戰
      this.begun = true;
      this.goBtn.remove();
    }
    this.goBtn.style.display = !this.begun && !this.start.isConnected ? '' : 'none';
    this.pausedTip.style.display = this.b.paused && this.begun ? '' : 'none';
    if (this.b.phase === 'end') this.start.remove();
  }

  /** 路線：我軍（綠／誘敵金）與看得到的敵軍意圖（紅虛線） */
  private drawArrows(): void {
    const g = this.g;
    const me = this.b.world.player;
    const parts: string[] = [];
    for (const u of g.units) {
      if (!g.alive(u) || !g.visibleTo(u, me)) continue;
      const p0 = this.screenOfUnit(u);
      if (!p0.vis) continue;
      let pts: { x: number; y: number }[] = [];
      let cls = '';
      if (u.team === me) {
        if (u.mode === 'attack' && u.target) {
          const f = g.unit(u.target);
          if (f && g.alive(f)) pts = [this.screenOfUnit(f)];
          cls = 'att';
        } else if (u.mode === 'lure' && u.lureStage === 'go' && u.target && u.lureTo) {
          // 誘敵：先去挑釁，再撤回陷阱點
          const f = g.unit(u.target);
          if (f && g.alive(f)) pts = [this.screenOfUnit(f), this.screenOfNode(u.lureTo)];
          cls = 'lure';
        } else if (u.path.length) {
          pts = u.path.map((id) => this.screenOfNode(id));
          cls = u.mode === 'lure' ? 'lure' : u.mode === 'retreat' ? 'ret' : 'mv';
        }
      } else {
        // 敵軍：要去哪裡
        if (u.mode === 'attack' && u.target) {
          const f = g.unit(u.target);
          if (f && g.alive(f)) pts = [this.screenOfUnit(f)];
        } else if (u.path.length) pts = u.path.map((id) => this.screenOfNode(id));
        cls = 'foe';
      }
      if (!pts.length) continue;
      const d = [p0, ...pts].map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ');
      parts.push(`<path class="${cls}" d="${d}" marker-end="url(#ah-${cls})"/>`);
    }
    if (this.drag && this.drag.kind) {
      const d = this.drag;
      const p0 = this.screenOfUnit(d.u);
      let pts: { x: number; y: number }[] = [];
      const start = g.nodeOf(d.u) ?? d.u.at;
      if (d.kind === 'attack' && d.foe) pts = [{ x: d.x, y: d.y }];
      else if (d.node) {
        if (d.kind === 'lure' && d.passed) pts = [this.screenOfUnit(this.g.lureTarget(d.passed)), this.screenOfNode(d.node)];
        else pts = [...g.path(start, d.node).map((id) => this.screenOfNode(id))];
        if (!pts.length) pts = [this.screenOfNode(d.node)];
      }
      const cls = d.kind === 'attack' ? (d.pv?.chance === '高' ? 'pv-hi' : d.pv?.chance === '中' ? 'pv-mid' : 'pv-lo') : d.kind === 'lure' ? 'lure' : 'mv';
      const path = [p0, ...pts].map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ');
      parts.push(`<path class="drag ${cls}" d="${path}" marker-end="url(#ah-${cls})"/>`);
    }
    const defs = ['mv', 'att', 'lure', 'ret', 'foe', 'pv-hi', 'pv-mid', 'pv-lo']
      .map((c) => `<marker id="ah-${c}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path class="ah ${c}" d="M0,0 L10,5 L0,10 z"/></marker>`)
      .join('');
    this.svg.innerHTML = `<defs>${defs}</defs>${parts.join('')}`;
  }

  /** 手指旁的說明：要做什麼、勝算多少 */
  private drawDrag(): void {
    const d = this.drag;
    if (!d || !d.kind) {
      this.dlabel.style.display = 'none';
      return;
    }
    const g = this.g;
    let html = '';
    if (d.kind === 'attack' && d.foe && d.pv) {
      const pv = d.pv;
      const col = pv.chance === '高' ? 'hi' : pv.chance === '中' ? 'mid' : 'lo';
      html = `<div class="t">⚔ 進攻 ${this.nameOf(d.foe)}</div>
        <div class="ch ${col}">勝算：${pv.chance}</div>
        <div class="ls">我軍約 −${pv.myLoss}　敵軍約 −${pv.foeLoss}</div>
        ${pv.factors.length ? `<div class="fx">${pv.factors.slice(0, 4).join('<br>')}</div>` : ''}
        ${d.u.hidden ? '<div class="fx good">🌲 從埋伏殺出：伏擊！</div>' : ''}
        <div class="hint">放手＝進攻・繼續滑到地點＝🎣誘敵</div>`;
    } else if (d.kind === 'lure' && d.passed && d.node) {
      const bait = g.lureTarget(d.passed);
      const pct = Math.round(g.lureChance(bait) * 100);
      const fol = g
        .lureFollowers(bait)
        .map((o) => `${this.nameOf(o)} ${Math.round(g.lureChance(o) * 100)}%`)
        .join('、');
      html = `<div class="t">🎣 誘敵 ${this.nameOf(bait)} → ${g.nodes.get(d.node)!.name}</div>
        <div class="ch ${pct >= 80 ? 'hi' : pct >= 50 ? 'mid' : 'lo'}">上鉤機率 ${pct}%（${TRAIT_NAME[bait.trait ?? 'normal']}）</div>
        ${fol ? `<div class="hint">可能跟著追：${fol}</div>` : ''}
        <div class="hint">挑釁後撤到這裡，敵軍會追過來</div>`;
    } else if (d.kind === 'move' && d.node) {
      const n = g.nodes.get(d.node)!;
      const ti = TERRAIN_INFO[n.terrain];
      const extra = n.terrain === 'forest' ? '到了會自動<b>埋伏</b>（敵軍看不見）' : g.isBurning(n.id) ? '🔥 正在燃燒！' : ti.desc;
      html = `<div class="t">🚶 前往 ${n.name}</div><div class="fx">${ti.icon} ${ti.name}：${extra}</div>`;
    }
    this.dlabel.innerHTML = html;
    this.dlabel.style.display = 'block';
    const W = this.b.container.clientWidth;
    const x = Math.min(W - 250, d.x + 24);
    const y = Math.max(8, d.y - 110);
    this.dlabel.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }

  private drawGhost(): void {
    const c = this.cardDrag;
    if (!c) {
      this.ghost.style.display = 'none';
      return;
    }
    this.ghost.style.display = 'grid';
    this.ghost.textContent = CARD_INFO[c.card].icon;
    this.ghost.style.transform = `translate(${(c.x - 28).toFixed(0)}px, ${(c.y - 28).toFixed(0)}px)`;
  }

  /** 選取的部隊資訊 */
  private drawInfo(): void {
    const u = this.selected;
    if (!u || !this.g.alive(u)) {
      this.info.style.display = 'none';
      return;
    }
    const g = this.g;
    const ti = TYPE_INFO[u.type];
    const t = this.b.world.t;
    const st: string[] = [];
    if (u.hidden) st.push('🌲 埋伏中');
    if (g.holding(u)) st.push('🛡 固守（受傷 −25%）');
    if (u.ambushedUntil > t) st.push('<span class="bad">中伏</span>');
    if (u.burnT > t - 1.5) st.push('<span class="bad">🔥 火中</span>');
    if (u.cut) st.push('<span class="bad">💀 斷糧（戰力 −30%）</span>');
    if (u.mode === 'retreat') st.push('<span class="bad">敗退中</span>');
    const n = g.nodeOf(u);
    const where = n ? g.nodes.get(n)!.name : '行軍中';
    const order =
      u.mode === 'move' ? `前往 ${g.nodes.get(u.path[u.path.length - 1] ?? u.at)?.name}` : u.mode === 'attack' ? `進攻 ${this.nameOf(g.unit(u.target ?? '')!)}` : u.mode === 'lure' ? `誘敵 → ${g.nodes.get(u.lureTo ?? u.at)?.name}` : u.mode === 'retreat' ? '撤退' : '待命';
    this.info.style.display = 'block';
    this.info.innerHTML = `<div class="hd">${u.general ? '⭐ ' : ''}${this.nameOf(u)}<span>${ti.icon} ${ti.name}</span></div>
      <div class="row"><span>兵力</span><b>${Math.round(u.troops)}</b><small>／${u.maxTroops}</small></div>
      <div class="row"><span>士氣</span><b>${Math.round(u.morale)}</b></div>
      <div class="row"><b class="good">剋 ${ti.beats}</b>　<b class="bad">怕 ${ti.fears}</b></div>
      <div class="row"><span>位置</span><b>${where}</b><small>${order}</small></div>
      ${st.length ? `<div class="row t">${st.join('　')}</div>` : ''}
      <div class="tip">從這支部隊滑到地點或敵軍來下令</div>`;
    void NODE_R;
  }
}
