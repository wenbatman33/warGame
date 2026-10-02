// 戰場 HUD：主帥面板、雙方士氣、糧況、軍令點、小地圖、軍團徽章、軍團卡、指令列、計策卡、事件橫幅、結算
import './hud.css';
import { audio } from '../audio/audio';
import { FACTIONS } from '../data/factions';
import { ABILITIES, GENERALS } from '../data/generals';
import { RULES, SUPPLY_EFFECTS } from '../data/rules';
import { STRATAGEM_ORDER, STRATAGEMS, type StratagemId } from '../data/stratagems';
import { MEN_PER_SOLDIER } from '../data/units';
import type { Battle } from '../game/battle';
import { unitIcon } from '../render/icons';
import { terrainBase, terrainView } from '../render/terrain';
import type { Regiment } from '../sim/regiment';
import type { GameEvent } from '../sim/world';
import { SETTINGS } from '../game/settings';
import { ARMY_FORMATIONS, planArmyFormation, type ArmyFormation } from '../game/armyFormation';
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
  private badges = new Map<number, { el: HTMLDivElement; num: HTMLElement; mb: HTMLElement; st: HTMLElement; warn: HTMLElement }>();
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
  private infoEl: HTMLDivElement;
  private goalsEl: HTMLDivElement;
  private deployEl: HTMLDivElement;
  private minimap: Minimap;
  private slowT = 0;
  /** 等待選目標：計策或武將技 */
  pending: { kind: 'strat'; id: StratagemId } | { kind: 'ability'; reg: number } | null = null;
  private voiceT = 0;
  private terrainOn = false;
  private resultShown = false;
  /** 結算結果（觀戰後用 🚪 離開也會記錄） */
  private result: { scenario: string; win: boolean; stars: boolean[]; time: number } | null = null;
  private resultHtml = '';
  private cardFade: () => void = () => {};

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
      // 戰鬥已結束：直接帶著結果離開（星數照記）
      if (b.world.over) {
        this.freezeResult();
        b.exit(this.result!);
        return;
      }
      if (confirm('放棄這場戰役，返回選單？')) b.exit(null);
    };
    const help = el('div', 'btn', '❓');
    help.title = '操作說明';
    help.onclick = () => {
      if (!b.paused) b.togglePause();
      b.opts.onHelp?.();
    };
    const set = el('div', 'btn', '⚙');
    set.title = '設定';
    set.onclick = () => {
      if (!b.paused) b.togglePause();
      b.opts.onSettings?.();
    };
    sys.append(this.terrainBtn, this.pauseBtn, this.speedBtn, help, set, exit);
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
    // 三星目標
    this.goalsEl = el('div', 'goalbox pe');
    this.goalsEl.onclick = () => this.goalsEl.classList.toggle('min');
    tr.appendChild(this.goalsEl);
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

    // 選取資訊
    this.infoEl = el('div', 'reginfo');
    this.infoEl.dataset.layout = 'reginfo';
    root.appendChild(this.infoEl);

    // 指令列
    this.cmdbar = el('div', 'cmdbar');
    this.cmdbar.dataset.layout = 'cmdbar';
    root.appendChild(this.cmdbar);

    // 下方：軍團卡＋計策
    const bottom = el('div', 'bottom');
    bottom.dataset.layout = 'bottom';
    this.cardsEl = el('div', 'cards');
    // 卡片超出可視範圍時，右側淡出提示還能捲動
    const fade = () => this.cardsEl.classList.toggle('more', this.cardsEl.scrollLeft + this.cardsEl.clientWidth < this.cardsEl.scrollWidth - 4);
    this.cardsEl.addEventListener('scroll', fade, { passive: true });
    this.cardFade = fade;
    this.cardsEl.addEventListener(
      'wheel',
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          this.cardsEl.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
    );
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
    const all = el('div', 'card allbtn', '<div class="ico">⚔</div><div class="nm stroke">全軍</div>');
    all.title = '選取全軍（Ctrl＋A）';
    all.onclick = () => {
      audio.unlock();
      b.controls.select(w.regs.filter((r) => r.team === w.player && !r.gone && !r.routing).map((r) => r.id));
    };
    this.cardsEl.prepend(all);
    bottom.append(this.cardsEl, strats);
    root.appendChild(bottom);

    // 部署面板
    this.deployEl = el('div', 'deploy');
    this.deployEl.dataset.layout = 'deploy';
    this.deployEl.innerHTML = `<div class="hint">部署：左鍵選取／拖曳軍團（藍框內）・<b>右鍵拖曳拉出戰線</b>・🗺 地形看高地與淺灘・Enter 開戰</div>`;
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

  private onResize = (): void => {
    applyLayout(this.root);
    this.cardFade();
  };

  dispose(): void {
    removeEventListener('resize', this.onResize);
    this.minimap.dispose();
    this.root.remove();
    document.body.classList.remove('picking');
  }

  // ───────────── 卡片與徽章 ─────────────

  private iconOf(r: Regiment): string {
    if (r.general) return `<img src="${asset(`hero/hero_${r.general.id}.jpg`)}" onerror="this.replaceWith('${r.unit.icon}')">`;
    const url = unitIcon(r.unit.model, FACTIONS[r.faction].color);
    return url ? `<img src="${url}" alt="">` : r.unit.icon;
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
      const w = this.b.world;
      // Ctrl／Cmd＋點卡片：選取同兵種全部
      if (e.ctrlKey || e.metaKey) this.b.controls.select(w.regs.filter((x) => x.team === w.player && !x.gone && x.type === r.type).map((x) => x.id), e.shiftKey);
      else if (e.shiftKey || this.b.controls.multiSelect) this.b.controls.toggle(r.id);
      else this.b.controls.select([r.id]);
    };
    if (!r.general) {
      const nm = c.querySelector('.nm') as HTMLElement;
      nm.textContent = r.name;
    }
    if (!r.general) c.style.background = `linear-gradient(${FACTIONS[r.faction].color}, ${FACTIONS[r.faction].dark})`;
    this.cardsEl.appendChild(c);
    this.cards.set(r.id, c);
    requestAnimationFrame(() => this.cardFade());
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

  /** 戰場即時警示：讓玩家看懂士氣為什麼在掉 */
  private warnOf(r: Regiment): string {
    const w = this.b.world;
    if (r.routing) return '';
    if (r.rearHits > 0) return '背襲！';
    if (r.flankHits > 0) return '側擊！';
    if (w.t - r.chargeShockT < 2.5) return '衝鋒！';
    if (r.terrain.wet && r.engagedWith.size > 0) return '半渡！';
    if (r.stamina < 25 && !r.unit.mounted) return '疲憊';
    if (r.ranged && r.members.length && r.members.every((i) => w.s.ammo[i] <= 0)) return '箭盡';
    return '';
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
      // 本陣被佔領中：紅條顯示佔領進度
      if (st.capture > 0.02 && !st.burnt) {
        bar.style.width = `${st.capture * 100}%`;
        bar.style.background = '#ff3b2a';
        (e.firstChild as HTMLElement).textContent += st.kind === 'water' ? ' 爭奪中' : ' 失守中！';
      } else {
        bar.style.width = `${st.frac * 100}%`;
        bar.style.background = st.fire > 0 ? '#ff7a2a' : w.teams[st.team].color;
      }
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
        e.innerHTML = `<div class="ic">${this.iconOf(r)}</div><div class="bd">${r.general ? `<span class="gname stroke">${r.general.name}</span>` : ''}<span class="num"></span><span class="mb"><i></i></span></div><span class="st"></span><span class="warn stroke"></span>`;
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
        b = { el: e, num: e.querySelector('.num')!, mb: e.querySelector('.mb i')!, st: e.querySelector('.st')!, warn: e.querySelector('.warn')! };
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
      b.warn.textContent = this.warnOf(r);
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

  private updateGoals(): void {
    const w = this.b.world;
    const rows = this.b.sc.stars.map((st) => {
      let ok = false;
      try {
        ok = st.check(w);
      } catch {
        ok = false;
      }
      return `<div class="${ok ? 'ok' : ''}">${ok ? '⭐' : '☆'} ${st.text}</div>`;
    });
    const hold = this.b.sc.holdTime ? `<div class="hold">⏳ 堅守 ${Math.max(0, Math.ceil(this.b.sc.holdTime - (w.t - ((w.flags.startT as number) ?? w.t))))} 秒</div>` : '';
    this.goalsEl.innerHTML = `<div class="gt">🎯 目標 <small>（點擊收合）</small></div>${hold}${rows.join('')}`;
  }

  // ───────────── 選取資訊 ─────────────

  private updateInfo(): void {
    const w = this.b.world;
    const ctl = this.b.controls;
    const ids = [...ctl.selected].filter((id) => !w.regs[id].gone);
    let r: Regiment | null = ids.length === 1 ? w.regs[ids[0]] : null;
    // 沒選己方時，滑鼠停在敵軍上也顯示
    if (!r && ids.length === 0 && ctl.hover >= 0 && !w.regs[ctl.hover].gone) r = w.regs[ctl.hover];
    if (!r) {
      this.infoEl.style.display = 'none';
      return;
    }
    const t = w.teams[r.team];
    const sup = SUPPLY_EFFECTS[t.supply];
    const st = r.state === 'shattered' ? '潰散' : r.routing ? '潰逃' : r.morale >= RULES.highThreshold ? '高昂' : r.morale >= RULES.waverThreshold ? '穩定' : '動搖';
    const stColor = r.routing ? '#ff6a55' : r.morale >= RULES.highThreshold ? '#5fe0ff' : r.morale >= RULES.waverThreshold ? '#9cff7a' : '#ffc24a';
    const terr: string[] = [];
    const tr = r.terrain;
    if (tr.high) terr.push(`⛰ 高地${tr.relHeight > 1 ? ` +${tr.relHeight.toFixed(0)}m（近戰 +${Math.round(Math.min(RULES.heightMax, tr.relHeight * RULES.heightPerMeter) * 100)}%）` : ''}`);
    if (tr.forest) terr.push('🌲 森林（受箭 −30%）');
    if (tr.wet) terr.push('🌊 涉水（受傷 +25%）');
    if (tr.camp) terr.push('🏯 營寨（受傷 −25%）');
    if (tr.road) terr.push('🛣 道路');
    if (r.inSupply) terr.push('📦 本陣補給（補箭、體力回復 ×1.5）');
    const ammo = r.ranged ? r.members.reduce((a, i) => a + w.s.ammo[i], 0) / Math.max(1, r.members.length) : -1;
    const forms: Record<string, string> = { line: '橫陣', square: '方陣', wedge: '鋒矢', loose: '散陣' };
    const BUFF: Record<string, string> = { drums: '擂鼓', march: '急行軍', gong: '鳴金', berserk: '裸衣', terror: '威震', swift: '巧變', steady: '剛烈', unstoppable: '七進七出', fortify: '堅守', raid: '劫營', fury: '奮戰', peerless: '無雙' };
    const buffs = [...new Set(r.buffs.filter((b) => b.until > w.t).map((b) => BUFF[b.id] ?? b.id))];
    const gen = r.general ? GENERALS[r.general.id] : null;
    this.infoEl.style.display = 'block';
    this.infoEl.className = `reginfo${r.team !== w.player ? ' enemy' : ''}`;
    this.infoEl.innerHTML = `<div class="hd"><b>${r.name}</b><span>${r.unit.name}</span></div>
      <div class="row"><span>兵力</span><b>${fmt(r.alive * MEN_PER_SOLDIER)}</b><small>／${fmt(r.initial * MEN_PER_SOLDIER)}</small></div>
      <div class="row"><span>士氣</span><b style="color:${stColor}">${Math.round(r.morale)} ${st}</b>${r.routs ? `<small>潰逃 ${r.routs} 次</small>` : ''}</div>
      <div class="row"><span>體力</span><b>${Math.round(r.stamina)}</b>${r.stamina < 30 ? '<small style="color:#ffc24a">疲憊：攻防 −15%</small>' : ''}</div>
      ${ammo >= 0 ? `<div class="row"><span>箭矢</span><b>${ammo.toFixed(0)}</b><small>輪</small></div>` : ''}
      <div class="row"><span>陣型</span><b>${forms[r.formation]}</b>${r.hold ? '<small>🛡 堅守</small>' : ''}${r.run ? '<small>🏃 奔跑</small>' : ''}</div>
      <div class="row"><span>糧況</span><b>${sup.icon}${sup.name}</b>${t.panicUntil > w.t ? '<small style="color:#ff6a55">😱 軍心大亂</small>' : ''}</div>
      ${terr.length ? `<div class="row t">${terr.join('<br>')}</div>` : ''}
      ${gen ? `<div class="row t">⭐ ${gen.name}（武${gen.war} 統${gen.lead} 智${gen.int}）${r.general!.alive ? '' : r.general!.fled ? '<b style="color:#ffc24a">逃脫</b>' : '<b style="color:#ff6a55">陣亡</b>'}</div>` : ''}
      ${buffs.length ? `<div class="row t">✨ ${buffs.join('、')}</div>` : ''}`;
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
    // 全軍突擊（兩團以上、開戰後）
    if (regs.length >= 2 && this.b.phase === 'battle') {
      btn('⚔ 全軍突擊', '每團自動分配最近的敵軍進攻（目標盡量分散；弓弩射擊、騎兵衝鋒）', false, () => this.assault(ids), 'red');
    }
    // 陣法（三團以上）
    if (regs.length >= 3) {
      bar.appendChild(el('div', 'sep'));
      for (const [k, d] of Object.entries(ARMY_FORMATIONS) as [ArmyFormation, { name: string; desc: string }][]) {
        btn(`🏯 ${d.name}`, `陣法・${d.name}：${d.desc}`, false, () => this.applyArmyFormation(ids, k), 'formation');
      }
    }
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
      if (!r.general?.alive || this.b.phase !== 'battle') continue;
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

  /** 全軍突擊：貪婪分配，每個敵軍團最多被兩團鎖定 */
  private assault(ids: number[]): void {
    const w = this.b.world;
    const enemies = w.regs.filter((e) => e.team !== w.player && !e.gone && !e.routing && w.isVisibleTo(e, w.player));
    if (!enemies.length) {
      this.toast('看不到敵軍', 'info', true);
      return;
    }
    const load = new Map<number, number>();
    for (const id of ids) {
      const r = w.regs[id];
      if (r.gone || r.routing) continue;
      let best = enemies[0];
      let bs = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.mx - r.mx, e.mz - r.mz) * (1 + (load.get(e.id) ?? 0) * 0.6);
        if (d < bs) {
          bs = d;
          best = e;
        }
      }
      load.set(best.id, (load.get(best.id) ?? 0) + 1);
      w.commandAttack([r.id], best.id, r.unit.mounted || undefined);
    }
    audio.play('horn_charge');
    audio.voice('ack_charge');
    this.toast('全軍突擊！', 'gold', true);
  }

  /** 套用陣法：部署階段直接就位，開戰後下移動令 */
  private applyArmyFormation(ids: number[], f: ArmyFormation): void {
    const b = this.b;
    const plan = planArmyFormation(b.world, ids, f);
    for (const p of plan) {
      if (b.phase === 'deploy') b.deployPlace(p.id, p.x, p.z, p.facing, p.width);
      else b.world.commandMove([p.id], p.x, p.z, p.facing, p.width);
    }
    this.toast(`列${ARMY_FORMATIONS[f].name}！`, 'gold', true);
    audio.play('drum_boost');
    b.world.flags.did_line = true;
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
      else {
        audio.play('ui_error');
        this.toast('距離太遠（需在武將 160 m 內）', 'bad', true);
      }
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

  /** Shift 是否按著（Shift+H＝拍照模式） */
  private photoKey = false;

  onKey(k: string, e?: KeyboardEvent): boolean {
    this.photoKey = !!e?.shiftKey;
    if (k === 'v') {
      this.toggleTerrain();
      return true;
    }
    if (k === 'b') {
      this.badgeLayer.style.display = this.badgeLayer.style.display === 'none' ? '' : 'none';
      this.toast(this.badgeLayer.style.display === 'none' ? '隱藏徽章（B 恢復）' : '顯示徽章', 'info', true);
      return true;
    }
    if (k === 'h' && this.photoKey) {
      this.root.classList.toggle('photo');
      return true;
    }
    if (k === 'c') {
      const ids = [...this.b.controls.selected];
      this.b.follow = this.b.follow >= 0 || ids.length === 0 ? -1 : ids[0];
      this.toast(this.b.follow >= 0 ? `鏡頭跟隨：${this.b.world.regs[this.b.follow].name}（C 取消）` : '取消跟隨', 'info', true);
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

  private recentToasts = new Map<string, number>();
  toast(text: string, tone: 'good' | 'bad' | 'info' | 'gold' = 'info', small = false, onClick?: () => void): void {
    // 同樣的訊息 5 秒內不重複
    const now = performance.now();
    if ((this.recentToasts.get(text) ?? -1e9) > now - 5000) return;
    this.recentToasts.set(text, now);
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
      case 'duel': {
        this.toast(`⚔ 單挑！${ev.a} 對 ${ev.b}`, 'gold');
        const won = mine(ev.winTeam);
        setTimeout(() => this.toast(ev.killed ? `${ev.winner}斬${ev.loser}於馬下！` : `${ev.winner}勝！${ev.loser}負傷敗走`, won ? 'gold' : 'bad'), 900);
        audio.play('clash', { ...this.b.sndPos(ev.x, ev.z), volume: 1 });
        audio.play('war_cry', this.b.sndPos(ev.x, ev.z));
        this.b.slowmo = 2;
        this.b.cam.shake = 0.6;
        break;
      }
      case 'chargeStart': {
        const r = w.regs[ev.reg];
        if (!mine(r.team) && !w.isVisibleTo(r, w.player)) break;
        audio.play('horn_charge', this.b.sndPos(r.mx, r.mz));
        audio.play('war_cry', { ...this.b.sndPos(r.mx, r.mz), volume: 0.7 });
        if (mine(r.team)) this.say('ack_charge');
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
        this.toast(`${r.general?.name ?? r.name}：「${ev.name}」！`, mine(r.team) ? 'gold' : 'bad', !mine(r.team));
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
        // 結束當下就凍結結算數據（之後觀戰時的傷亡、星數不再變動）
        this.freezeResult();
        setTimeout(() => this.showResult(), 3500);
        break;
    }
  }

  // ───────────── 結算 ─────────────

  /** 戰鬥結束當下的結算快照 */
  private freezeResult(): void {
    if (this.resultHtml) return;
    const b = this.b;
    const w = b.world;
    const win = w.winner === w.player;
    const stars = b.sc.stars.map((s) => win && s.check(w));
    const me = w.teams[w.player];
    const en = w.teams[1 - w.player];
    const dur = ((w.flags.endT as number) ?? w.t) - ((w.flags.startT as number) ?? 0);
    this.result = { scenario: b.sc.id, win, stars, time: dur };
    this.resultHtml = `<div class="box">
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
      ${this.honorRoll()}
      <div class="btns"></div></div>`;
  }

  private showResult(): void {
    if (this.resultShown) return;
    this.resultShown = true;
    const b = this.b;
    this.freezeResult();
    const { win, stars, time: dur } = this.result!;
    const box = el('div', 'result');
    box.innerHTML = this.resultHtml;
    const btns = box.querySelector('.btns')!;
    const again = el('div', 'btn green stroke', '⚔ 再戰一次');
    again.onclick = () => b.exit({ scenario: b.sc.id, win, stars, time: dur, retry: true } as never);
    const back = el('div', 'btn stroke', '返回戰役');
    back.onclick = () => b.exit({ scenario: b.sc.id, win, stars, time: dur });
    const watch = el('div', 'btn stroke', '👁 觀看戰場');
    watch.onclick = () => {
      box.remove();
      // 觀戰時留一顆「返回結算」
      const re = el('div', 'btn green stroke reopen', '📜 返回結算');
      re.onclick = () => {
        re.remove();
        this.resultShown = false;
        this.showResult();
      };
      this.root.appendChild(re);
    };
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

  /** 戰功榜：我軍斬敵前三名 */
  private honorRoll(): string {
    const w = this.b.world;
    const top = w.regs
      .filter((r) => r.team === w.player && r.name !== '逃兵' && r.kills > 0)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 3);
    if (!top.length) return '';
    const medal = ['🥇', '🥈', '🥉'];
    return `<div class="honor">${top.map((r, i) => `<div>${medal[i]} <b>${r.general ? r.general.name : r.name}</b><small>${r.unit.name}</small><span>斬敵 ${fmt(r.kills * MEN_PER_SOLDIER)}</span></div>`).join('')}</div>`;
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
    // 指令列出現時，部署面板往上讓位
    if (b.phase === 'deploy') this.deployEl.style.bottom = this.cmdbar.style.display === 'none' ? '' : `${110 + this.cmdbar.offsetHeight + 6}px`;
    // 戰鬥結束後時鐘停住
    const el2 = (w.over ? (w.flags.endT as number) : w.t) - ((w.flags.startT as number) ?? w.t);
    const wxIcon = b.sc.weather === 'rain' ? '🌧 雨天・' : b.sc.weather === 'fog' ? '🌫 濃霧・' : '';
    this.clockEl.textContent = wxIcon + (b.phase === 'deploy' ? '部署中' : `${Math.floor(el2 / 60)}:${String(Math.floor(el2 % 60)).padStart(2, '0')}${b.sc.holdTime ? ` / ${Math.floor(b.sc.holdTime / 60)}:00` : ''}`);
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
    this.updateInfo();
    if (this.slowT % 5 === 0) this.updateGoals();
    if (this.slowT % 2 === 0) this.minimap.draw();
    this.updateHints();
    this.hqAlarm();
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

  private hqAlarmT = -1e9;
  /** 敵軍逼近我方本陣時警告（本陣失守＝戰敗） */
  private hqAlarm(): void {
    const w = this.b.world;
    const hq = w.teams[w.player].hq;
    if (!hq || hq.burnt || this.b.phase !== 'battle' || performance.now() - this.hqAlarmT < 30000) return;
    const threat = w.regs.find((r) => r.team !== w.player && !r.gone && !r.routing && Math.hypot(r.mx - hq.x, r.mz - hq.z) < 70);
    if (!threat) return;
    this.hqAlarmT = performance.now();
    this.toast(`⚠ 敵軍逼近「${hq.name}」！本陣失守＝戰敗`, 'bad', false, () => this.b.cam.set(hq.x, hq.z, 140, undefined, false));
    audio.play('gong');
  }

  // ───────────── 軍師提示 ─────────────
  private hintsDone = new Set<number>();
  private advisorEl: HTMLDivElement | null = null;
  private advisorT = 0;
  private updateHints(): void {
    const b = this.b;
    const w = b.world;
    const hints = b.sc.hints;
    if (!hints || !SETTINGS.tips) return;
    const shownFor = performance.now() - this.advisorT;
    if (this.advisorEl && shownFor > 16000) this.closeAdvisor();
    // 提示顯示超過 3.5 秒、而下一則已經可以出現 → 直接換下一則（教學步驟比較順）
    if (this.advisorEl && shownFor < 3500) return;
    const since = b.phase === 'deploy' ? -1 : w.t - ((w.flags.startT as number) ?? 0);
    for (let k = 0; k < hints.length; k++) {
      if (this.hintsDone.has(k)) continue;
      const hnt = hints[k];
      const ok = hnt.when ? (b.phase === 'battle' || hnt.deploy) && hnt.when(w) : hnt.at !== undefined && (hnt.at < 0 ? b.phase === 'deploy' : since >= hnt.at && b.phase === 'battle');
      if (!ok) continue;
      this.hintsDone.add(k);
      this.closeAdvisor();
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
