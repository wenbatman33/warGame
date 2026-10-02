// 戰場 HUD：主帥面板、雙方士氣、糧況、軍令點、小地圖、軍團徽章、軍團卡、指令列、計策卡、事件橫幅、結算
import './hud.css';
import { audio } from '../audio/audio';
import { FACTIONS } from '../data/factions';
import { ABILITIES, GENERALS } from '../data/generals';
import { RULES, SUPPLY_EFFECTS } from '../data/rules';
import { STRATAGEM_ORDER, STRATAGEMS, type StratagemId } from '../data/stratagems';
import { MEN_PER_SOLDIER } from '../data/units';
import type { Battle } from '../game/battle';
import { terrainBase, terrainView } from '../render/terrain';
import type { Regiment } from '../sim/regiment';
import type { GameEvent } from '../sim/world';
import { SETTINGS } from '../game/settings';
import { applyLayout, LAYOUT } from './layout';
import { Minimap } from './minimap';

const BASE = import.meta.env.BASE_URL;
export const asset = (p: string) => `${BASE}assets/${p}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export class Hud {
  readonly root: HTMLDivElement;
  private badges = new Map<number, { el: HTMLDivElement; num: HTMLElement; mb: HTMLElement; st: HTMLElement }>();
  private badgeLayer: HTMLDivElement;
  private cards = new Map<number, HTMLDivElement>();
  private cardsEl: HTMLDivElement;
  private stratEls = new Map<StratagemId, HTMLDivElement>();
  private cmdbar: HTMLDivElement;
  private toasts: HTMLDivElement;
  private clockEl: HTMLElement;
  private tugMine: HTMLElement;
  private tugEnemy: HTMLElement;
  private strengthEl: HTMLElement;
  private moraleBar: HTMLElement;
  private supplyRows: HTMLElement[] = [];
  private cmdN: HTMLElement;
  private cmdBar: HTMLElement;
  private pauseBar: HTMLElement;
  private speedBtn: HTMLElement;
  private pauseBtn: HTMLElement;
  private terrainBtn: HTMLElement;
  private terrainTip: HTMLDivElement;
  private deployEl: HTMLDivElement;
  private minimap: Minimap;
  private slowT = 0;
  /** 等待選目標：計策或武將技 */
  pending: { kind: 'strat'; id: StratagemId } | { kind: 'ability'; reg: number } | null = null;
  private voiceT = 0;
  private terrainOn = false;
  private resultShown = false;

  constructor(
    container: HTMLElement,
    private b: Battle,
  ) {
    const w = b.world;
    const sc = b.sc;
    const root = (this.root = el('div', 'hud'));
    container.appendChild(root);
    terrainBase.value = w.baseHeight;

    // 左上：主帥
    const me = sc.teams[w.player];
    const cmdrId = me.commander;
    const g = cmdrId ? GENERALS[cmdrId] : null;
    const cmdr = el('div', 'cmdr pe');
    cmdr.dataset.layout = 'cmdr';
    const por = el('div', 'por');
    if (g) por.style.backgroundImage = `url(${asset(`hero/hero_${g.id}.jpg`)})`;
    por.appendChild(el('span', 'lv', FACTIONS[me.faction].flag));
    const info = el('div', 'info');
    info.innerHTML = `<div class="nm stroke">${g ? g.name : me.name}<span style="font-size:11px;color:#ccc;margin-left:6px">${me.name}</span></div>`;
    this.strengthEl = el('div', 'sub', '');
    info.appendChild(this.strengthEl);
    const mb = el('div', 'bar');
    this.moraleBar = el('i');
    mb.appendChild(this.moraleBar);
    info.appendChild(mb);
    cmdr.append(por, info);
    cmdr.onclick = () => {
      const r = w.regs.find((x) => x.team === w.player && x.general?.id === cmdrId && !x.gone);
      if (r) this.focus(r);
    };
    root.appendChild(cmdr);

    // 中上
    const top = el('div', 'top-c');
    top.dataset.layout = 'top';
    top.appendChild(el('div', 'ttl stroke', `${sc.title}・${sc.subtitle}`));
    this.clockEl = el('div', 'clock stroke', '部署中');
    top.appendChild(this.clockEl);
    const tug = el('div', 'tug');
    const tb = el('div', 'tb');
    this.tugMine = el('i');
    this.tugEnemy = el('i');
    this.tugMine.style.background = `linear-gradient(${w.teams[0].color}, ${FACTIONS[sc.teams[0].faction].dark})`;
    this.tugEnemy.style.background = `linear-gradient(${w.teams[1].color}, ${FACTIONS[sc.teams[1].faction].dark})`;
    tb.append(this.tugMine, this.tugEnemy);
    tug.append(el('span', 'side stroke', `${w.teams[0].name}士氣`), tb, el('span', 'side stroke', `${w.teams[1].name}士氣`));
    top.appendChild(tug);
    this.pauseBar = el('div', 'pausebar', '⏸ 戰術暫停中——仍可下令（空白鍵繼續）');
    top.appendChild(this.pauseBar);
    root.appendChild(top);

    // 右上
    const tr = el('div', 'top-r');
    tr.dataset.layout = 'topRight';
    const sys = el('div', 'sysbtns');
    this.terrainBtn = el('div', 'btn', '🗺 地形');
    this.terrainBtn.title = '地形圖（V）';
    this.terrainBtn.onclick = () => this.toggleTerrain();
    this.pauseBtn = el('div', 'btn', '⏸');
    this.pauseBtn.onclick = () => b.togglePause();
    this.speedBtn = el('div', 'btn', '1×');
    this.speedBtn.onclick = () => b.setSpeed(b.speed === 1 ? 2 : b.speed === 2 ? 0.5 : 1);
    const exit = el('div', 'btn red', '🚪');
    exit.title = '撤離戰場';
    exit.onclick = () => {
      if (confirm('放棄這場戰役，返回選單？')) b.exit(null);
    };
    sys.append(this.terrainBtn, this.pauseBtn, this.speedBtn, exit);
    tr.appendChild(sys);
    const sup = el('div', 'supply');
    for (let t = 0; t < 2; t++) {
      const row = el('div', 'row');
      row.innerHTML = `<span class="lb" style="color:${w.teams[t].color}">${FACTIONS[sc.teams[t].faction].flag}</span><span class="st">🍚充足</span><div class="bar"><i style="width:100%;background:linear-gradient(#ffe39a,#d19a2a)"></i></div>`;
      row.title = t === 0 ? '我軍糧況（本陣存糧）' : '敵軍糧況（本陣存糧）';
      sup.appendChild(row);
      this.supplyRows.push(row);
    }
    tr.appendChild(sup);
    const cp = el('div', 'cmdpts');
    cp.title = '軍令點：施放計策用，每 8 秒回復 1 點';
    this.cmdN = el('span', 'n stroke', '⚡4');
    const cpb = el('div', 'bar');
    this.cmdBar = el('i');
    cpb.appendChild(this.cmdBar);
    cp.append(this.cmdN, cpb);
    tr.appendChild(cp);
    this.minimap = new Minimap(w, b.cam, 168);
    this.minimap.canvas.className = 'minimap';
    tr.appendChild(this.minimap.canvas);
    root.appendChild(tr);

    // 徽章層
    this.badgeLayer = el('div', 'badges');
    root.insertBefore(this.badgeLayer, root.firstChild);

    // 事件橫幅
    this.toasts = el('div', 'toasts');
    root.appendChild(this.toasts);

    // 地形提示
    this.terrainTip = el('div', 'terrain-tip');
    root.appendChild(this.terrainTip);

    // 指令列
    this.cmdbar = el('div', 'cmdbar');
    this.cmdbar.dataset.layout = 'cmdbar';
    root.appendChild(this.cmdbar);

    // 下方：軍團卡＋計策
    const bottom = el('div', 'bottom');
    bottom.dataset.layout = 'bottom';
    this.cardsEl = el('div', 'cards');
    for (const r of w.regs.filter((x) => x.team === w.player)) this.addCard(r);
    const strats = el('div', 'strats');
    for (const id of STRATAGEM_ORDER) {
      const d = STRATAGEMS[id];
      const s = el('div', 'strat');
      s.innerHTML = `<span class="em">${d.icon}</span><img src="${asset(`icon/strat_${id}.jpg`)}" onerror="this.remove()"><span class="nm stroke">${d.name}</span><span class="cost">${d.cost}</span>`;
      s.title = `${d.name}（${d.cost} 軍令點）：${d.desc}`;
      s.onclick = () => this.pickStrat(id);
      strats.appendChild(s);
      this.stratEls.set(id, s);
    }
    bottom.append(this.cardsEl, strats);
    root.appendChild(bottom);

    // 部署面板
    this.deployEl = el('div', 'deploy');
    this.deployEl.dataset.layout = 'deploy';
    this.deployEl.innerHTML = `<div class="hint">部署階段：拖曳軍團調整位置（藍框內）・右鍵拖曳拉出戰線與朝向・按「🗺 地形」看高地與淺灘</div>`;
    const go = el('div', 'btn green go stroke', '⚔ 開戰');
    go.onclick = () => {
      audio.unlock();
      b.startBattle();
    };
    this.deployEl.appendChild(go);
    root.appendChild(this.deployEl);
    if (b.phase !== 'deploy') this.deployEl.style.display = 'none';

    applyLayout(root);
    addEventListener('resize', this.onResize);
    this.refreshSelection();
    this.refreshTime();
  }

  private onResize = (): void => applyLayout(this.root);

  dispose(): void {
    removeEventListener('resize', this.onResize);
    this.root.remove();
    document.body.classList.remove('picking');
  }

  // ───────────── 卡片與徽章 ─────────────

  private iconOf(r: Regiment): string {
    if (r.general) return `<img src="${asset(`hero/hero_${r.general.id}.jpg`)}" onerror="this.replaceWith('${r.unit.icon}')">`;
    return r.unit.icon;
  }

  private addCard(r: Regiment): void {
    const c = el('div', 'card' + (r.general ? ' gen' : ''));
    c.innerHTML = `<div class="ico">${this.iconOf(r)}</div><div class="nm stroke">${r.general ? r.general.name : r.name}</div><div class="num stroke"></div><div class="tags"></div><div class="mb"><i></i></div><div class="sb"><i></i></div>`;
    c.title = `${r.name}（${r.unit.name}）：${r.unit.desc}`;
    let lastClick = 0;
    c.onclick = (e) => {
      audio.unlock();
      const now = performance.now();
      if (now - lastClick < 300) this.focus(r);
      lastClick = now;
      if (this.pending?.kind === 'strat' && STRATAGEMS[this.pending.id].target === 'own') {
        this.applyStrat(this.pending.id, r.mx, r.mz, r.id);
        return;
      }
      if (e.shiftKey || this.b.controls.multiSelect) this.b.controls.toggle(r.id);
      else this.b.controls.select([r.id]);
    };
    if (!r.general) {
      const nm = c.querySelector('.nm') as HTMLElement;
      nm.textContent = r.name;
    }
    if (!r.general) c.style.background = `linear-gradient(${FACTIONS[r.faction].color}, ${FACTIONS[r.faction].dark})`;
    this.cardsEl.appendChild(c);
    this.cards.set(r.id, c);
  }

  private focus(r: Regiment): void {
    this.b.cam.set(r.mx, r.mz, Math.min(this.b.cam.dist, 140), undefined, false);
  }

  private stateIcons(r: Regiment): string {
    const t = this.b.world.teams[r.team];
    let s = '';
    if (r.state === 'shattered') s += '💀';
    else if (r.routing) s += '🏳';
    else if (r.engagedWith.size > 0) s += '⚔';
    else if (r.wavering) s += '⚠';
    if (t.supply !== 'ok' && !r.routing) s += SUPPLY_EFFECTS[t.supply].icon;
    if (t.panicUntil > this.b.world.t && !r.routing) s += '😱';
    if (r.terrain.high) s += '⛰';
    if (r.terrain.forest) s += '🌲';
    if (r.terrain.wet) s += '🌊';
    if (r.terrain.camp) s += '🏯';
    if (r.hold) s += '🛡';
    return s;
  }

  private moraleColor(m: number): string {
    return m >= RULES.highThreshold ? '#5fe0ff' : m >= RULES.waverThreshold ? '#6ee25a' : m >= RULES.routThreshold ? '#ffc24a' : '#ff5a45';
  }

  private updateCards(): void {
    const w = this.b.world;
    for (const r of w.regs) {
      if (r.team !== w.player || r.name === '逃兵') continue;
      let c = this.cards.get(r.id);
      if (!c) {
        this.addCard(r);
        c = this.cards.get(r.id)!;
      }
      (c.querySelector('.num') as HTMLElement).textContent = fmt(r.alive * MEN_PER_SOLDIER);
      const mi = c.querySelector('.mb i') as HTMLElement;
      mi.style.width = `${r.gone ? 0 : r.morale}%`;
      mi.style.background = this.moraleColor(r.morale);
      (c.querySelector('.sb i') as HTMLElement).style.width = `${r.stamina}%`;
      (c.querySelector('.tags') as HTMLElement).textContent = r.gone ? '' : this.stateIcons(r);
      c.classList.toggle('sel', this.b.controls.selected.has(r.id));
      c.classList.toggle('rout', r.routing && !r.gone);
      c.classList.toggle('dead', r.gone);
    }
    // 倒戈離開我方的卡片
    for (const [id, c] of this.cards) {
      if (w.regs[id].team !== w.player) {
        c.remove();
        this.cards.delete(id);
      }
    }
  }

  private structBadges = new Map<number, HTMLDivElement>();
  private updateStructBadges(): void {
    const w = this.b.world;
    const ctl = this.b.controls;
    for (const st of w.structs) {
      let e = this.structBadges.get(st.id);
      if (!e) {
        e = el('div', 'sbadge');
        e.innerHTML = `<span class="nm stroke"></span><span class="bar"><i></i></span>`;
        e.onpointerdown = (ev) => {
          ev.stopPropagation();
          if (st.team !== w.player && ctl.selected.size && st.kind !== 'water') ctl.orderAt(st.x, st.z, false);
        };
        this.badgeLayer.appendChild(e);
        this.structBadges.set(st.id, e);
      }
      const p = ctl.screenOf(st.x, w.hf.height(st.x, st.z) + (st.kind === 'hq' ? 16 : 12), st.z);
      if (!p.vis || p.x < -60 || p.y < -40 || p.x > innerWidth + 60 || p.y > innerHeight + 40) {
        e.style.display = 'none';
        continue;
      }
      e.style.display = '';
      e.style.transform = `translate(${(p.x - 50).toFixed(1)}px, ${(p.y - 12).toFixed(1)}px)`;
      const icon = st.kind === 'hq' ? '🏯' : st.kind === 'water' ? '💧' : st.kind === 'camp' ? '⛺' : '🌾';
      const state = st.burnt ? '（焚毀）' : st.fire > 0 ? ' 🔥' : '';
      (e.firstChild as HTMLElement).textContent = `${icon}${st.name}${state}`;
      const bar = e.querySelector('i') as HTMLElement;
      bar.style.width = `${st.frac * 100}%`;
      bar.style.background = st.fire > 0 ? '#ff7a2a' : w.teams[st.team].color;
      e.classList.toggle('enemy', st.team !== w.player);
      e.classList.toggle('burnt', st.burnt);
    }
  }

  private updateBadges(): void {
    const w = this.b.world;
    const ctl = this.b.controls;
    this.updateStructBadges();
    const seen = new Set<number>();
    for (const r of w.regs) {
      if (r.gone || r.name === '逃兵' || !w.isVisibleTo(r, w.player)) continue;
      const p = ctl.screenOf(r.mx, w.groundY(r.mx, r.mz) + (r.unit.mounted ? 7 : 5.5), r.mz);
      if (!p.vis || p.x < -40 || p.y < -40 || p.x > innerWidth + 40 || p.y > innerHeight + 40) continue;
      seen.add(r.id);
      let b = this.badges.get(r.id);
      if (!b) {
        const e = el('div', 'badge');
        e.innerHTML = `<div class="ic">${this.iconOf(r)}</div><div class="bd">${r.general ? `<span class="gname stroke">${r.general.name}</span>` : ''}<span class="num"></span><span class="mb"><i></i></span></div><span class="st"></span>`;
        e.onpointerdown = (ev) => {
          ev.stopPropagation();
          audio.unlock();
          const reg = w.regs[r.id];
          if (this.pending?.kind === 'strat' && STRATAGEMS[this.pending.id].target === 'own' && reg.team === w.player) {
            this.applyStrat(this.pending.id, reg.mx, reg.mz, reg.id);
            return;
          }
          if (reg.team === w.player) {
            if (ev.button === 2) return;
            if (ev.shiftKey || ctl.multiSelect) ctl.toggle(reg.id);
            else ctl.select([reg.id]);
          } else if (ctl.selected.size) {
            ctl.orderAt(reg.mx, reg.mz, false);
          }
        };
        e.oncontextmenu = (ev) => {
          ev.preventDefault();
          const reg = w.regs[r.id];
          if (reg.team !== w.player) ctl.orderAt(reg.mx, reg.mz, false);
        };
        this.badgeLayer.appendChild(e);
        b = { el: e, num: e.querySelector('.num')!, mb: e.querySelector('.mb i')!, st: e.querySelector('.st')! };
        this.badges.set(r.id, b);
      }
      const enemy = r.team !== w.player;
      b.el.style.setProperty('--tc', FACTIONS[r.faction].color);
      b.el.className = `badge${enemy ? ' enemy' : ''}${r.general ? ' gen' : ''}${ctl.selected.has(r.id) ? ' sel' : ''}${r.routing ? ' rout' : ''}`;
      b.el.style.transform = `translate(${(p.x - 14).toFixed(1)}px, ${(p.y - 14).toFixed(1)}px)`;
      b.el.style.display = '';
      b.num.textContent = fmt(r.alive * MEN_PER_SOLDIER);
      b.mb.style.width = `${r.morale}%`;
      b.mb.style.background = this.moraleColor(r.morale);
      b.st.textContent = this.stateIcons(r);
    }
    for (const [id, b] of this.badges) {
      if (!seen.has(id)) {
        if (w.regs[id].gone) {
          b.el.remove();
          this.badges.delete(id);
        } else b.el.style.display = 'none';
      }
    }
  }

  // ───────────── 指令列 ─────────────

  refreshSelection(): void {
    const w = this.b.world;
    const ids = [...this.b.controls.selected].filter((id) => !w.regs[id].gone);
    const bar = this.cmdbar;
    bar.innerHTML = '';
    if (!ids.length || this.b.phase === 'end') {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    const regs = ids.map((id) => w.regs[id]);
    const all = (f: (r: Regiment) => boolean) => regs.every(f);
    const btn = (label: string, title: string, on: boolean, fn: () => void, cls = '') => {
      const e = el('div', `btn ${on ? 'on' : ''} ${cls}`, label);
      e.title = title;
      e.onclick = () => {
        audio.play('ui_click');
        fn();
        this.refreshSelection();
      };
      bar.appendChild(e);
      return e;
    };
    btn('🏃 奔跑', '奔跑移動：快 50%，消耗體力（R）', all((r) => r.run), () => {
      const v = !all((r) => r.run);
      for (const r of regs) r.run = v;
    });
    btn('✋ 停止', '停止（H）', false, () => w.commandHalt(ids));
    btn('🛡 堅守', '堅守：不追擊；長槍兵擺出拒馬陣，騎兵正面衝鋒反吃三倍傷害（G）', all((r) => r.hold), () => {
      const v = !all((r) => r.hold);
      for (const r of regs) r.hold = v;
      if (v) audio.voice('ack_hold');
    });
    bar.appendChild(el('div', 'sep'));
    const forms: [Regiment['formation'], string, string][] = [
      ['line', '橫陣', '接觸面最大（預設）'],
      ['square', '方陣', '側擊背襲懲罰減半、移動 −15%'],
      ['wedge', '鋒矢', '騎兵衝鋒 +30%'],
      ['loose', '散陣', '受箭傷 −40%、近戰防禦 −20%'],
    ];
    for (const [f, nm, tip] of forms) btn(nm, `${nm}：${tip}（T 切換）`, all((r) => r.formation === f), () => w.setFormation(ids, f));
    if (regs.some((r) => r.ranged)) {
      bar.appendChild(el('div', 'sep'));
      btn('🎯 自由射擊', '自動射擊射程內最近的敵軍（F）', all((r) => !r.ranged || r.fireAtWill), () => {
        const v = !all((r) => !r.ranged || r.fireAtWill);
        for (const r of regs) r.fireAtWill = v;
      });
      btn('🔥 火矢', '改射火矢：可點燃糧倉與營寨', all((r) => !r.ranged || r.fireArrows), () => {
        const v = !all((r) => !r.ranged || r.fireArrows);
        for (const r of regs) if (r.ranged) r.fireArrows = v;
      });
    }
    bar.appendChild(el('div', 'sep'));
    btn('↩ 撤退', '有序撤回本陣（Backspace）', false, () => {
      w.commandRetreat(ids);
      audio.voice('ack_retreat');
    }, 'red');
    for (const r of regs) {
      if (!r.general?.alive) continue;
      const gd = GENERALS[r.general.id];
      if (!gd.ability) continue;
      const ab = ABILITIES[gd.ability];
      const e = btn(`⭐ ${ab.name}`, `${gd.name}・${ab.name}：${ab.desc}`, false, () => {
        if (ab.targeted) {
          this.pending = { kind: 'ability', reg: r.id };
          document.body.classList.add('picking');
          this.toast(`選擇「${ab.name}」的目標地點`, 'info', true);
        } else if (w.useAbility(r.id)) audio.voice('ack_charge');
        else audio.play('ui_error');
      }, 'abil');
      e.dataset.reg = String(r.id);
      e.appendChild(el('div', 'cd'));
    }
    if (matchMedia('(pointer:coarse)').matches) {
      bar.appendChild(el('div', 'sep'));
      btn('☑ 多選', '點卡片／旗號加入選取', this.b.controls.multiSelect, () => (this.b.controls.multiSelect = !this.b.controls.multiSelect));
    }
  }

  private updateAbilityCd(): void {
    const w = this.b.world;
    for (const e of this.cmdbar.querySelectorAll<HTMLElement>('.abil')) {
      const r = w.regs[Number(e.dataset.reg)];
      const cd = e.querySelector('.cd') as HTMLElement;
      if (!r?.general) continue;
      const ab = ABILITIES[GENERALS[r.general.id].ability!];
      const left = Math.max(0, r.general.cd - w.t);
      cd.style.width = `${Math.min(100, (left / ab.cd) * 100)}%`;
      e.classList.toggle('dis', left > 0 || !r.general.alive);
    }
  }

  // ───────────── 計策 ─────────────

  private pickStrat(id: StratagemId): void {
    audio.unlock();
    const w = this.b.world;
    if (this.b.phase !== 'battle') {
      this.toast('開戰後才能施放計策', 'info', true);
      return;
    }
    if (w.teams[w.player].command < STRATAGEMS[id].cost) {
      audio.play('ui_error');
      this.toast('軍令點不足', 'bad', true);
      return;
    }
    if (this.pending?.kind === 'strat' && this.pending.id === id) {
      this.cancelPick();
      return;
    }
    audio.play('ui_card');
    const d = STRATAGEMS[id];
    // 己方目標且已選取一個軍團 → 直接施放
    if (d.target === 'own' && this.b.controls.selected.size === 1) {
      const r = w.regs[[...this.b.controls.selected][0]];
      this.applyStrat(id, r.mx, r.mz, r.id);
      return;
    }
    this.pending = { kind: 'strat', id };
    document.body.classList.add('picking');
    this.toast(d.target === 'own' ? `選擇要「${d.name}」的軍團` : `選擇「${d.name}」的位置`, 'info', true);
  }

  private cancelPick(): void {
    this.pending = null;
    document.body.classList.remove('picking');
  }

  private applyStrat(id: StratagemId, x: number, z: number, rid = -1): void {
    const w = this.b.world;
    const err = w.useStratagem(w.player, id, x, z, rid);
    if (err) {
      audio.play('ui_error');
      this.toast(err, 'bad', true);
      return;
    }
    this.cancelPick();
  }

  /** Controls 的點擊攔截：選目標 */
  pickTarget(x: number, z: number): boolean {
    if (!this.pending) return false;
    const w = this.b.world;
    if (this.pending.kind === 'ability') {
      if (w.useAbility(this.pending.reg, x, z)) audio.voice('ack_charge');
      this.cancelPick();
      return true;
    }
    const d = STRATAGEMS[this.pending.id];
    if (d.target === 'own') {
      const rid = this.b.controls.regimentAt(x, z, 6);
      if (rid >= 0 && w.regs[rid].team === w.player) this.applyStrat(this.pending.id, x, z, rid);
      else this.toast('請點選己方軍團', 'bad', true);
      return true;
    }
    this.applyStrat(this.pending.id, x, z);
    return true;
  }

  onKey(k: string): boolean {
    if (k === 'v') {
      this.toggleTerrain();
      return true;
    }
    if (k === 'escape' && this.pending) {
      this.cancelPick();
      return true;
    }
    if (k === 'enter' && this.b.phase === 'deploy') {
      audio.unlock();
      this.b.startBattle();
      return true;
    }
    return false;
  }

  private toggleTerrain(): void {
    this.terrainOn = !this.terrainOn;
    this.terrainBtn.classList.toggle('on', this.terrainOn);
    audio.play('ui_click');
  }

  // ───────────── 事件 ─────────────

  toast(text: string, tone: 'good' | 'bad' | 'info' | 'gold' = 'info', small = false, onClick?: () => void): void {
    const t = el('div', `toast stroke ${tone}${small ? ' small' : ''}${onClick ? ' click' : ''}`, text);
    if (onClick) {
      t.style.pointerEvents = 'auto';
      t.onclick = onClick;
    }
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild!.remove();
    setTimeout(() => t.remove(), 3200);
  }

  private say(id: Parameters<typeof audio.voice>[0]): void {
    const now = performance.now();
    if (now - this.voiceT < 2500) return;
    this.voiceT = now;
    audio.voice(id);
  }

  onEvent(ev: GameEvent): void {
    const w = this.b.world;
    const mine = (team: number) => team === w.player;
    const at = (x: number, z: number) => () => this.b.cam.set(x, z, Math.min(this.b.cam.dist, 160), undefined, false);
    switch (ev.k) {
      case 'rout': {
        const r = w.regs[ev.reg];
        if (r.name === '逃兵') break;
        this.toast(mine(r.team) ? `${r.name} 潰逃！` : `敵軍 ${r.name} 潰逃！`, mine(r.team) ? 'bad' : 'good', true, at(r.mx, r.mz));
        audio.play('rout', { ...this.b.sndPos(r.mx, r.mz) });
        this.say(mine(r.team) ? 'our_routing' : 'enemy_routing');
        break;
      }
      case 'shattered': {
        const r = w.regs[ev.reg];
        if (r.name === '逃兵') break;
        this.toast(mine(r.team) ? `${r.name} 潰散，逃離戰場` : `敵軍 ${r.name} 潰散！`, mine(r.team) ? 'bad' : 'good', true);
        break;
      }
      case 'rally': {
        const r = w.regs[ev.reg];
        if (mine(r.team)) this.toast(`${r.name} 重整旗鼓`, 'good', true, at(r.mx, r.mz));
        break;
      }
      case 'generalDown': {
        const r = w.regs[ev.reg];
        this.toast(`${mine(r.team) ? '我軍' : '敵將'}${ev.name} 陣亡！`, mine(r.team) ? 'bad' : 'gold', false, at(r.mx, r.mz));
        audio.play('general_down');
        this.say('general_down');
        this.b.slowmo = 1.2;
        break;
      }
      case 'ignite': {
        const st = w.structs[ev.s];
        this.toast(mine(st.team) ? `我軍「${st.name}」遭到縱火！` : `敵軍「${st.name}」起火了！`, mine(st.team) ? 'bad' : 'gold', false, at(st.x, st.z));
        audio.play('fire_ignite', this.b.sndPos(st.x, st.z));
        this.say(mine(st.team) ? 'our_depot_burning' : 'enemy_depot_burning');
        break;
      }
      case 'burnt': {
        const st = w.structs[ev.s];
        const enemyName = w.teams[st.team].name;
        this.toast(mine(st.team) ? `「${st.name}」被焚毀，軍心動搖！` : `「${st.name}」焚毀！${enemyName}軍心大亂`, mine(st.team) ? 'bad' : 'gold', false, at(st.x, st.z));
        audio.play('depot_burnt', this.b.sndPos(st.x, st.z));
        this.say(mine(st.team) ? 'our_depot_burnt' : 'enemy_depot_burnt');
        this.b.slowmo = 1.5;
        break;
      }
      case 'supply': {
        const t = w.teams[ev.team];
        const e = SUPPLY_EFFECTS[ev.state];
        if (ev.state === 'ok') break;
        const desc = ev.state === 'starving' ? '攻擊 −30%、防禦 −20%、移動 −20%，動搖部隊開始逃亡' : '攻擊 −10%、體力回復變慢、士氣上限 75';
        this.toast(`${e.icon} ${t.name}${e.name}！${desc}`, mine(ev.team) ? 'bad' : 'good', true);
        break;
      }
      case 'panic': {
        const t = w.teams[ev.team];
        this.toast(`😱 ${t.name}軍心大亂！90 秒內攻擊 −20%、士氣只降不升`, mine(ev.team) ? 'bad' : 'gold');
        break;
      }
      case 'wagonLost':
        this.toast(mine(ev.team) ? '我軍輜重車被劫！' : '劫下敵軍輜重！', mine(ev.team) ? 'bad' : 'good', true);
        break;
      case 'ability': {
        const r = w.regs[ev.reg];
        this.toast(`${r.general?.name ?? r.name}：「${ev.name}」！`, mine(r.team) ? 'gold' : 'bad');
        audio.play('war_cry', this.b.sndPos(r.mx, r.mz));
        break;
      }
      case 'stratagem':
        audio.play(ev.id === 'drums' ? 'drum_boost' : ev.id === 'retreat' ? 'gong' : 'stratagem', this.b.sndPos(ev.x, ev.z));
        if (ev.id === 'rockfall') {
          const x = (w.flags.rockX as number) ?? ev.x;
          const z = (w.flags.rockZ as number) ?? ev.z;
          this.b.view.particles.emit('dust', x, w.groundY(x, z) + 1, z, 40, 18);
          this.b.cam.shake = 1;
        }
        if (!mine(ev.team)) this.toast(`敵軍施放「${STRATAGEMS[ev.id].name}」！`, 'bad', true);
        break;
      case 'msg':
        this.toast(ev.text, ev.tone);
        break;
      case 'defect': {
        const r = w.regs[ev.reg];
        this.toast(`${r.name} 倒戈${w.teams[r.team].name}！`, mine(r.team) ? 'good' : 'bad');
        break;
      }
      case 'end':
        this.b.phase = 'end';
        this.refreshSelection();
        audio.music(ev.winner === w.player ? 'victory' : 'defeat');
        audio.play(ev.winner === w.player ? 'victory_sting' : 'defeat_sting');
        this.say(ev.winner === w.player ? 'victory' : 'defeat');
        setTimeout(() => this.showResult(), 3500);
        break;
    }
  }

  // ───────────── 結算 ─────────────

  private showResult(): void {
    if (this.resultShown) return;
    this.resultShown = true;
    const b = this.b;
    const w = b.world;
    const win = w.winner === w.player;
    const stars = b.sc.stars.map((s) => win && s.check(w));
    const box = el('div', 'result');
    const me = w.teams[w.player];
    const en = w.teams[1 - w.player];
    const dur = w.t - ((w.flags.startT as number) ?? 0);
    box.innerHTML = `<div class="box">
      <div class="big stroke ${win ? '' : 'lose'}">${win ? '大獲全勝' : '兵敗'}</div>
      <div class="stars">${stars.map(() => '<span class="star">⭐</span>').join('')}</div>
      <div class="goals">${b.sc.stars.map((s, i) => `<div>${stars[i] ? '✅' : '⬜'} ${s.text}</div>`).join('')}</div>
      <div class="stats">
        <div><b>${fmt(me.initialStrength * MEN_PER_SOLDIER)}</b>我軍出征</div>
        <div><b>${fmt(me.dead * MEN_PER_SOLDIER)}</b>我軍陣亡</div>
        <div><b>${fmt(en.dead * MEN_PER_SOLDIER)}</b>斬首敵軍</div>
        <div><b>${fmt(en.fled * MEN_PER_SOLDIER)}</b>敵軍逃散</div>
        <div><b>${en.depotsBurnt}</b>焚敵糧倉</div>
        <div><b>${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}</b>戰鬥時間</div>
      </div>
      <div class="btns"></div></div>`;
    const btns = box.querySelector('.btns')!;
    const again = el('div', 'btn green stroke', '⚔ 再戰一次');
    again.onclick = () => b.exit({ scenario: b.sc.id, win, stars, time: dur, retry: true } as never);
    const back = el('div', 'btn stroke', '返回戰役');
    back.onclick = () => b.exit({ scenario: b.sc.id, win, stars, time: dur });
    const watch = el('div', 'btn stroke', '👁 觀看戰場');
    watch.onclick = () => box.remove();
    btns.append(again, back, watch);
    this.root.appendChild(box);
    const starEls = box.querySelectorAll('.star');
    stars.forEach((on, i) => {
      if (!on) return;
      setTimeout(() => {
        starEls[i].classList.add('on');
        audio.play('star', { rate: [1, 1.12, 1.26][i] });
      }, 600 + i * 450);
    });
  }

  // ───────────── 每幀 ─────────────

  refreshTime(): void {
    const b = this.b;
    this.pauseBtn.textContent = b.paused ? '▶' : '⏸';
    this.pauseBtn.classList.toggle('on', b.paused);
    this.speedBtn.textContent = `${b.speed}×`;
    this.pauseBar.style.display = b.paused ? 'inline-block' : 'none';
  }

  private slowAcc = 0;
  update(dt: number): void {
    const b = this.b;
    const w = b.world;
    // 地形圖淡入淡出
    terrainView.value += ((this.terrainOn ? 1 : 0) - terrainView.value) * Math.min(1, dt * 6);
    this.updateBadges();
    this.slowAcc += dt;
    if (this.slowAcc < 0.2) return;
    this.slowAcc = 0;
    this.slowT++;
    this.deployEl.style.display = b.phase === 'deploy' ? '' : 'none';
    const el2 = w.t - ((w.flags.startT as number) ?? w.t);
    this.clockEl.textContent = b.phase === 'deploy' ? '部署中' : `${Math.floor(el2 / 60)}:${String(Math.floor(el2 % 60)).padStart(2, '0')}${b.sc.holdTime ? ` / ${Math.floor(b.sc.holdTime / 60)}:00` : ''}`;
    const m0 = w.armyMorale(0);
    const m1 = w.armyMorale(1);
    const tot = m0 + m1 || 1;
    this.tugMine.style.width = `${(m0 / tot) * 100}%`;
    this.tugEnemy.style.width = `${(m1 / tot) * 100}%`;
    const me = w.teams[w.player];
    this.strengthEl.textContent = `兵力 ${fmt(w.teamStrength(w.player) * MEN_PER_SOLDIER)} / ${fmt(me.initialStrength * MEN_PER_SOLDIER)}`;
    this.moraleBar.style.width = `${w.armyMorale(w.player)}%`;
    this.moraleBar.style.background = this.moraleColor(w.armyMorale(w.player));
    for (let t = 0; t < 2; t++) {
      const team = w.teams[t];
      const row = this.supplyRows[t];
      const e = SUPPLY_EFFECTS[team.supply];
      row.className = `row ${team.supply}`;
      (row.querySelector('.st') as HTMLElement).textContent = `${e.icon}${e.name}`;
      (row.querySelector('i') as HTMLElement).style.width = `${team.hq ? team.hq.frac * 100 : 100}%`;
    }
    this.cmdN.textContent = `⚡${Math.floor(me.command)}`;
    this.cmdBar.style.width = `${(me.command / RULES.commandMax) * 100}%`;
    for (const [id, s] of this.stratEls) {
      s.classList.toggle('dis', me.command < STRATAGEMS[id].cost || b.phase !== 'battle');
      s.classList.toggle('pick', this.pending?.kind === 'strat' && this.pending.id === id);
    }
    this.updateCards();
    this.updateAbilityCd();
    if (this.slowT % 2 === 0) this.minimap.draw();
    this.updateHints();
    // 地形提示（滑鼠所在點）
    const m = b.controls.mouse;
    if (m.inside && matchMedia('(pointer:fine)').matches) {
      const h = w.hf.height(m.gx, m.gz) - w.baseHeight;
      const tags: string[] = [`高度 ${h >= 0 ? '+' : ''}${h.toFixed(0)} m`];
      if (w.nav.forestAt(m.gx, m.gz) > 0.45) tags.push('🌲 森林（受箭 −30%、可埋伏、騎兵衝鋒 ×0.3）');
      if (w.isWet(m.gx, m.gz)) tags.push('🌊 淺灘（半渡：受傷 +25%）');
      else if (!w.nav.passable(m.gx, m.gz)) tags.push('⛔ 無法通行');
      if (w.hf.roadAt(m.gx, m.gz) > 0.5) tags.push('🛣 道路（移動 +15%）');
      if (h > 4) tags.push('⛰ 高地');
      this.terrainTip.textContent = tags.join('　');
      this.terrainTip.style.display = 'block';
    } else this.terrainTip.style.display = 'none';
    // 戰況音樂：雙方交戰人數多時切高潮
    if (b.phase === 'battle') {
      const engaged = w.regs.filter((r) => r.engagedWith.size > 0).length;
      const want = engaged >= 6 ? 'climax' : 'battle';
      if (want !== this.music) {
        this.music = want;
        audio.music(want);
      }
    }
  }
  private music = 'battle';

  // ───────────── 軍師提示 ─────────────
  private hintsDone = new Set<number>();
  private advisorEl: HTMLDivElement | null = null;
  private advisorT = 0;
  private updateHints(): void {
    const b = this.b;
    const w = b.world;
    const hints = b.sc.hints;
    if (!hints || !SETTINGS.tips) return;
    if (this.advisorEl && performance.now() - this.advisorT > 11000) this.closeAdvisor();
    if (this.advisorEl) return;
    const since = b.phase === 'deploy' ? -1 : w.t - ((w.flags.startT as number) ?? 0);
    for (let k = 0; k < hints.length; k++) {
      if (this.hintsDone.has(k)) continue;
      const hnt = hints[k];
      const ok = hnt.when ? b.phase === 'battle' && hnt.when(w) : hnt.at !== undefined && (hnt.at < 0 ? b.phase === 'deploy' : since >= hnt.at && b.phase === 'battle');
      if (!ok) continue;
      this.hintsDone.add(k);
      this.showAdvisor(hnt.text);
      return;
    }
  }

  private showAdvisor(text: string): void {
    const adv = this.b.sc.advisor;
    const e = el('div', 'advisor');
    e.innerHTML = `<div class="face" style="background-image:url(${asset(adv?.portrait ?? 'ui/emblem.png')})"></div><div class="say"><span class="x">✕</span><b>${adv?.name ?? '軍師'}：</b>${text}</div>`;
    (e.querySelector('.x') as HTMLElement).onclick = () => this.closeAdvisor();
    this.root.appendChild(e);
    this.advisorEl = e;
    this.advisorT = performance.now();
    audio.play('ui_card');
  }

  private closeAdvisor(): void {
    this.advisorEl?.remove();
    this.advisorEl = null;
  }
}

export { LAYOUT };
