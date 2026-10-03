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
import { GROUP_ORDER, STANCES } from '../game/tactics';
import { ROUTE_PRESETS, applyVia, currentPreset, dragVia, plannable, presetVia, routeStats, type RoutePreset } from '../game/supplyPlan';
import type { Structure } from '../sim/structures';
import { counterMul } from '../sim/world';
import type { UnitClass, UnitDef } from '../data/units';
import type { GroupId, Stance } from '../sim/regiment';
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

/** 各兵種剋誰、怕誰（資訊面板用） */
const CTR: Record<UnitClass, [string, string]> = {
  shield: ['長槍（近身）', '騎兵側衝'],
  pole: ['騎兵', '弓兵、刀盾'],
  missile: ['長槍', '騎兵'],
  cav: ['弓兵', '長槍'],
};

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
  /** 糧道部署：每個糧倉一組（面板、地圖上的拖曳標記） */
  private plans: { st: Structure; panel: HTMLElement; handle: HTMLElement }[] = [];
  private planDragT = 0;
  private groupChips = new Map<GroupId, HTMLElement>();
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
      row.innerHTML = `<span class="lb" style="color:${w.teams[t].color}">${FACTIONS[sc.teams[t].faction].flag}</span><span class="st">🍚糧道暢通</span><div class="bar"><i style="width:100%;background:linear-gradient(#ffe39a,#d19a2a)"></i></div>`;
      row.title = t === 0 ? '我軍糧道與本陣存糧：糧道被斷後存糧開始倒數，吃緊、斷糧時士氣低落、受到傷害變重' : '敵軍糧道與本陣存糧：派兵站上敵軍糧道（附近沒有敵軍）8 秒即可切斷';
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
    this.deployEl.innerHTML = `<div class="hint">佈陣：拖曳軍團到藍框內的位置・<b>右鍵拖曳拉出戰線</b>・好了就按「開戰」</div>`;
    // 糧道部署：快捷路線＋拖曳地圖上的 🍚 標記
    for (const st of plannable(w)) this.buildSupplyPlan(st);
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
    c.innerHTML = `<div class="ico">${this.iconOf(r)}</div><div class="nm stroke">${r.general ? r.general.name : r.name}</div><div class="num stroke"></div><div class="tags"></div><div class="grp stroke"></div><div class="mb"><i></i></div><div class="sb"><i></i></div>`;
    c.draggable = true;
    c.ondragstart = (e) => e.dataTransfer?.setData('text/plain', String(r.id));
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
    const sup = this.b.world.supplyOf(r);
    if (r.engagedWith.size > 0) s += '⚔';
    else if (r.morale < RULES.lowThreshold) s += '⚠';
    if (sup !== 'ok') s += SUPPLY_EFFECTS[sup].icon;
    if (t.panicUntil > this.b.world.t) s += '😱';
    if (r.terrain.high) s += '⛰';
    if (r.terrain.forest) s += '🌲';
    if (r.terrain.wet) s += '🌊';
    if (r.terrain.camp) s += '🏯';
    if (r.hold) s += '🛡';
    return s;
  }

  /** 戰場即時警示：讓玩家看懂士氣為什麼在掉 */
  /** 戰場即時效果字：讓玩家看懂這一團為什麼打得好／打得差（紅＝吃虧、綠＝佔便宜） */
  private warnOf(r: Regiment): { t: string; good?: boolean } | null {
    const w = this.b.world;
    const now = w.t;
    if (r.routing) return null;
    if (r.rearHits > 0) return { t: `背襲 ×${RULES.rearMul}` };
    if (r.flankHits > 0) return { t: `側擊 ×${RULES.flankMul}` };
    if (now - r.counterHitT < 2.5) return { t: `被剋 ×${+r.counterHitMul.toFixed(2)}` };
    if (now - r.counterDealT < 2.5) return { t: `剋制 ×${+r.counterDealMul.toFixed(2)}`, good: true };
    if (now - r.chargeShockT < 2.5) return { t: '衝鋒！' };
    if (now - r.holdBlockT < 2.5 && r.engagedWith.size > 0) return { t: `列陣 受傷−${Math.round((1 - RULES.holdDef) * 100)}%`, good: true };
    if (w.fording(r) && r.engagedWith.size > 0) return { t: `半渡 受傷+${Math.round(RULES.fordDef * 100)}%` };
    if (now - r.fordDealT < 2.5) return { t: `半渡而擊 ×${1 + RULES.fordDef}`, good: true };
    if (r.engagedWith.size > 0 && r.terrain.relHeight > 2) return { t: `居高 +${Math.round(Math.min(RULES.heightMax, r.terrain.relHeight * RULES.heightPerMeter) * 100)}%`, good: true };
    if (r.engagedWith.size > 0 && r.terrain.relHeight < -5) return { t: '仰攻' };
    const sup = w.supplyOf(r);
    if (sup === 'starving') return { t: '斷糧 受傷+35%' };
    if (sup === 'low') return { t: '吃緊 受傷+15%' };
    if (r.morale < RULES.brokenThreshold) return { t: '瓦解 受傷+20%' };
    if (r.stamina < 25 && !r.unit.mounted) return { t: '疲憊' };
    if (r.ranged && r.members.length && r.members.every((i) => w.s.ammo[i] <= 0)) return { t: '箭盡' };
    return null;
  }

  /** 糧道部署面板＋地圖標記 */
  private buildSupplyPlan(st: Structure): void {
    const b = this.b;
    const w = b.world;
    const panel = el('div', 'splan');
    panel.innerHTML = `<div class="sh">🍚 糧道部署：<b>${st.name}</b> → 本陣</div><div class="sp"></div><div class="ss"></div><div class="sn">拖曳地圖上的 <b>🍚</b> 標記，自訂糧道經過的位置</div>`;
    const row = panel.querySelector('.sp') as HTMLElement;
    for (const p of Object.keys(ROUTE_PRESETS) as RoutePreset[]) {
      const d = ROUTE_PRESETS[p];
      const e = el('div', 'btn sm', d.name);
      e.dataset.p = p;
      e.title = `${d.name}：${d.desc}`;
      e.onclick = () => {
        audio.play('ui_click');
        applyVia(w, st, presetVia(w, st, p));
        w.flags.did_route = true;
        this.refreshPlan();
      };
      row.appendChild(e);
    }
    this.deployEl.insertBefore(panel, this.deployEl.querySelector('.go'));
    // 地圖上的拖曳標記
    const handle = el('div', 'viah stroke', '🍚');
    handle.title = '拖曳：改變糧道經過的位置';
    let drag = false;
    handle.onpointerdown = (e) => {
      if (b.phase !== 'deploy') return;
      e.stopPropagation();
      e.preventDefault();
      drag = true;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('drag');
    };
    handle.onpointermove = (e) => {
      if (!drag) return;
      const now = performance.now();
      if (now - this.planDragT < 70) return;
      this.planDragT = now;
      const g = b.controls.ground(e.clientX, e.clientY);
      if (g) {
        dragVia(w, st, g.x, g.z);
        this.refreshPlan();
      }
    };
    const end = (e: PointerEvent) => {
      if (!drag) return;
      drag = false;
      handle.classList.remove('drag');
      const g = b.controls.ground(e.clientX, e.clientY);
      if (g) dragVia(w, st, g.x, g.z);
      w.flags.did_route = true;
      this.refreshPlan();
      audio.play('ui_order');
    };
    handle.onpointerup = end;
    handle.onpointercancel = end;
    this.badgeLayer.appendChild(handle);
    this.plans.push({ st, panel, handle });
    this.refreshPlan();
  }

  /** 糧道部署：按鈕高亮與路線數據 */
  private refreshPlan(): void {
    const w = this.b.world;
    for (const { st, panel } of this.plans) {
      const cur = currentPreset(w, st);
      for (const e of panel.querySelectorAll<HTMLElement>('.sp .btn')) e.classList.toggle('on', e.dataset.p === cur);
      const rs = routeStats(w, st);
      const col = rs.riskText === '高' ? '#ff6a55' : rs.riskText === '中' ? '#ffc24a' : '#7dff6a';
      (panel.querySelector('.ss') as HTMLElement).innerHTML = `長 <b>${Math.round(rs.len)} m</b>・斷後恢復 <b>${Math.round(rs.transit)} 秒</b>・被切風險 <b style="color:${col}">${rs.riskText}</b>・補給延伸 <b>${Math.max(0, Math.round(rs.reach))} m</b>${cur ? '' : '（自訂）'}`;
    }
  }

  /** 每幀：拖曳標記跟著路線（只在部署階段顯示） */
  private updatePlanHandles(): void {
    const b = this.b;
    const w = b.world;
    b.view.supplyLines.planning = b.phase === 'deploy';
    for (const { st, handle } of this.plans) {
      if (b.phase !== 'deploy') {
        handle.style.display = 'none';
        continue;
      }
      const [x, z] = st.via ?? st.route[Math.floor(st.route.length / 2)];
      const p = b.controls.screenOf(x, w.groundY(x, z) + 2, z);
      if (!p.vis) {
        handle.style.display = 'none';
        continue;
      }
      handle.style.display = '';
      handle.style.transform = `translate(${(p.x - 18).toFixed(1)}px, ${(p.y - 18).toFixed(1)}px)`;
    }
  }

  /** 相剋提示：選取的我軍剋這個敵軍（good）或被它剋（bad） */
  private counterHint(sel: UnitDef[], e: UnitDef): 'good' | 'bad' | '' {
    const edge = (a: UnitDef, b: UnitDef) => Math.max(counterMul(a, b), a.ranged && b.cls === 'pole' ? RULES.missileVsPole : 1);
    if (sel.some((u) => edge(u, e) > 1.1)) return 'good';
    if (sel.some((u) => edge(e, u) > 1.1)) return 'bad';
    return '';
  }

  /** 分組列：人數與共同姿態 */
  refreshGroups(): void {
    const w = this.b.world;
    for (const g of GROUP_ORDER) {
      const chip = this.groupChips.get(g);
      if (!chip) continue;
      const rs = w.regs.filter((r) => r.team === w.player && !r.gone && r.group === g);
      (chip.querySelector('.n') as HTMLElement).textContent = String(rs.length);
      const st = rs.length && rs.every((r) => r.stance === rs[0].stance) ? rs[0].stance : 'free';
      (chip.querySelector('.si') as HTMLElement).textContent = st !== 'free' ? STANCES[st].icon : '';
      chip.classList.toggle('empty', rs.length === 0);
      chip.classList.toggle('sel', rs.length > 0 && rs.every((r) => this.b.controls.selected.has(r.id)));
    }
  }

  private moraleColor(m: number): string {
    return m >= RULES.highThreshold ? '#5fe0ff' : m >= RULES.lowThreshold ? '#6ee25a' : m >= RULES.brokenThreshold ? '#ffc24a' : '#ff5a45';
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
      const gEl = c.querySelector('.grp') as HTMLElement;
      if (r.stance !== 'free' && !r.gone) {
        gEl.style.display = '';
        gEl.textContent = `${STANCES[r.stance].icon}${STANCES[r.stance].name}`;
      } else gEl.style.display = 'none';
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
    this.updatePlanHandles();
    const seen = new Set<number>();
    // 選取的我軍兵種（相剋提示用）
    const selUnits = [...new Set([...ctl.selected].map((id) => w.regs[id]).filter((r) => r && !r.gone && r.team === w.player).map((r) => r.unit))];
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
      const ctr = enemy && selUnits.length ? this.counterHint(selUnits, r.unit) : '';
      b.el.className = `badge${enemy ? ' enemy' : ''}${r.general ? ' gen' : ''}${ctl.selected.has(r.id) ? ' sel' : ''}${r.routing ? ' rout' : ''}${ctr ? ` ctr-${ctr}` : ''}`;
      b.el.style.transform = `translate(${(p.x - 14).toFixed(1)}px, ${(p.y - 14).toFixed(1)}px)`;
      b.el.style.display = '';
      b.num.textContent = fmt(r.alive * MEN_PER_SOLDIER);
      b.mb.style.width = `${r.morale}%`;
      b.mb.style.background = this.moraleColor(r.morale);
      b.st.textContent = this.stateIcons(r);
      const wn = this.warnOf(r);
      b.warn.textContent = wn ? wn.t : '';
      b.warn.className = `warn stroke${wn?.good ? ' good' : ''}`;
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

  /** 已完成的作戰步驟（完成後不會再變回未完成） */
  private stepsDone = new Set<number>();

  private updateGoals(): void {
    const w = this.b.world;
    const plan = this.b.sc.plan;
    if (plan?.length) {
      plan.forEach((p, i) => {
        if (this.stepsDone.has(i)) return;
        try {
          if (p.done(w)) {
            this.stepsDone.add(i);
            if (i === this.curStep()) this.toast(`✅ ${p.text}`, 'good', true);
          }
        } catch {
          /* 條件出錯就當未完成 */
        }
      });
      const cur = this.curStep();
      const hold = this.b.sc.holdTime ? `<div class="hold">⏳ 堅守 ${Math.max(0, Math.ceil(this.b.sc.holdTime - (w.t - ((w.flags.startT as number) ?? w.t))))} 秒</div>` : '';
      const rows = plan.map((p, i) => {
        const done = this.stepsDone.has(i);
        const now = i === cur;
        return `<div class="step${done ? ' done' : ''}${now ? ' now' : ''}"><span class="no">${done ? '✓' : i + 1}</span><div><b>${p.text}</b>${now ? `<small>${p.how}</small>` : ''}</div></div>`;
      });
      this.goalsEl.innerHTML = `<div class="gt">📋 作戰步驟 <small>（點擊收合）</small></div>${hold}${rows.join('')}`;
      return;
    }
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

  /** 目前要做的步驟：第一個還沒完成的 */
  private curStep(): number {
    const plan = this.b.sc.plan ?? [];
    for (let i = 0; i < plan.length; i++) if (!this.stepsDone.has(i)) return i;
    return plan.length;
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
    const supState = w.supplyOf(r);
    const sup = SUPPLY_EFFECTS[supState];
    const st = r.morale >= RULES.highThreshold ? '高昂' : r.morale >= RULES.lowThreshold ? '穩定' : r.morale >= RULES.brokenThreshold ? '低落' : '瓦解';
    const stColor = this.moraleColor(r.morale);
    // 只顯示「有影響」的狀態：糧況出問題、地形優劣、增益
    const notes: string[] = [];
    if (supState !== 'ok') notes.push(`<span style="color:#ffb04a">${sup.icon}${sup.name}${supState === 'cut' ? '（存糧倒數）' : `：受傷 +${Math.round((sup.taken - 1) * 100)}%`}</span>`);
    if (t.panicUntil > w.t) notes.push('<span style="color:#ff6a55">😱 軍心大亂</span>');
    const tr = r.terrain;
    if (tr.high && tr.relHeight > 1) notes.push(`⛰ 居高 +${Math.round(Math.min(RULES.heightMax, tr.relHeight * RULES.heightPerMeter) * 100)}%`);
    if (w.fording(r)) notes.push(`<span style="color:#ff9a8a">🌊 半渡：受傷 +${Math.round(RULES.fordDef * 100)}%、攻擊 −${Math.round((1 - RULES.fordAtk) * 100)}%</span>`);
    if (tr.forest) notes.push('🌲 森林：受箭 −30%');
    if (tr.camp) notes.push('🏯 營寨：受傷 −25%');
    const BUFF: Record<string, string> = { drums: '擂鼓', march: '急行軍', gong: '鳴金', berserk: '裸衣', terror: '威震', swift: '巧變', steady: '剛烈', unstoppable: '七進七出', fortify: '堅守', raid: '劫營', fury: '奮戰', peerless: '無雙' };
    const buffs = [...new Set(r.buffs.filter((b) => b.until > w.t).map((b) => BUFF[b.id] ?? b.id))];
    if (buffs.length) notes.push(`✨ ${buffs.join('、')}`);
    const gen = r.general ? GENERALS[r.general.id] : null;
    const genState = gen && !r.general!.alive ? (r.general!.fled ? '（已撤退）' : '（陣亡）') : '';
    this.infoEl.style.display = 'block';
    this.infoEl.className = `reginfo${r.team !== w.player ? ' enemy' : ''}`;
    this.infoEl.innerHTML = `<div class="hd"><b>${gen ? `⭐ ${gen.name}${genState}` : r.name}</b><span>${r.unit.icon} ${r.unit.name}</span></div>
      <div class="row"><span>兵力</span><b>${fmt(r.alive * MEN_PER_SOLDIER)}</b><span>士氣</span><b style="color:${stColor}">${st}</b></div>
      <div class="row"><b style="color:#8fe36a">剋 ${CTR[r.unit.cls][0]}</b>　<b style="color:#ff9a8a">怕 ${CTR[r.unit.cls][1]}</b></div>
      ${notes.length ? `<div class="row t">${notes.join('<br>')}</div>` : ''}`;
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
    // 戰線指令：整組戰術（開戰前也可以先設定）
    const battle = this.b.phase === 'battle';
    const stances: Exclude<Stance, 'free'>[] = battle ? ['hold', 'advance', 'retreat', 'flank'] : ['hold', 'advance', 'flank'];
    for (const st of stances) {
      const d = STANCES[st];
      btn(`${d.icon} ${d.name}`, `戰線指令・${d.name}：${d.desc}（手動下令會取消）`, all((r) => r.stance === st), () => {
        this.b.tactics.setStance(ids, st);
        audio.voice(st === 'retreat' ? 'ack_retreat' : st === 'hold' ? 'ack_hold' : 'ack_charge');
        this.toast(`${regs.length > 1 ? `${regs.length} 團` : regs[0].name}：${d.name}`, 'gold', true);
        this.refreshGroups();
      }, `stance st-${st}`);
    }
    // 武將技（最多兩位，避免按鈕太多）
    for (const r of regs.filter((x) => x.general?.alive).slice(0, 2)) {
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
        if (ev.state === 'ok' || ev.state === 'cut') break;
        const desc = ev.state === 'starving' ? '攻擊 −20%、受到傷害 +35%、移動變慢、士兵開始離隊' : '攻擊 −10%、受到傷害 +15%、士氣上限 70';
        this.toast(`${e.icon} ${t.name}${e.name}！${desc}`, mine(ev.team) ? 'bad' : 'good', true);
        break;
      }
      case 'lineCut': {
        const t = w.teams[ev.team];
        const how = ev.burnt ? '糧倉被焚，補給斷絕' : '補給路線被敵軍切斷';
        this.toast(mine(ev.team) ? `⚠️ 我軍糧道被斷！${how}，全軍士氣 −10，本陣存糧開始倒數` : `🔥 ${t.name}糧道已斷！${how}，敵軍存糧開始倒數`, mine(ev.team) ? 'bad' : 'gold', true, at(ev.x, ev.z));
        break;
      }
      case 'lineRestored': {
        const t = w.teams[ev.team];
        this.toast(mine(ev.team) ? '🍚 糧道恢復暢通，本陣重新進糧' : `${t.name}糧道恢復了`, mine(ev.team) ? 'good' : 'bad');
        break;
      }
      case 'generalRetreat': {
        const r = w.regs[ev.reg];
        this.toast(mine(r.team) ? `我軍武將${ev.name}重傷撤退！所屬部隊士氣 −25` : `敵將${ev.name}撤退！`, mine(r.team) ? 'bad' : 'gold', true, at(r.mx, r.mz));
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
        <div><b>${me.generalsBeaten}</b>逼退／斬殺敵將</div>
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
    this.root.classList.toggle('deploying', b.phase === 'deploy');
    // 指令列出現時，部署面板往上讓位
    if (b.phase === 'deploy') this.deployEl.style.bottom = this.cmdbar.style.display === 'none' ? '' : `${138 + this.cmdbar.offsetHeight + 6}px`;
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
    this.refreshGroups();
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
    // 戰況音樂：雙方交戰軍團多時切決戰曲；至少維持 25 秒、交戰明顯減少才切回（避免來回切換）
    if (b.phase === 'battle') {
      const engaged = w.regs.filter((r) => r.engagedWith.size > 0).length;
      const now = performance.now();
      let want = this.music;
      if (this.music === 'battle' && engaged >= 6) want = 'climax';
      else if (this.music === 'climax' && engaged <= 3 && now - this.musicT > 25000) want = 'battle';
      if (want !== this.music) {
        this.music = want;
        this.musicT = now;
        audio.music(want);
      }
    }
  }
  private music: 'battle' | 'climax' = 'battle';
  private musicT = 0;

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
