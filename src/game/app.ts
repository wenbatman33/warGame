// 畫面流程：主選單 → 戰役地圖 → 戰前簡報 → 讀取 → 戰鬥 → 結算 → 回戰役地圖；設定、操作說明、自訂會戰
import '../ui/menu.css';
import { audio } from '../audio/audio';
import { CAMPAIGN, type CampaignEntry } from '../data/scenarios/index';
import type { Scenario } from '../data/scenario';
import { CAM } from '../input/camera';
import { asset } from '../ui/hud';
import { applyLayout } from '../ui/layout';
import { Battle, type BattleResult } from './battle';
import { buildCustomScenario, CUSTOM_DEFAULT, type CustomOptions } from './custom';
import { PROGRESS, recordResult, saveSettings, SETTINGS, starCount } from './settings';

const VERSION = 'v0.5';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

function btn(label: string, cls: string, fn: () => void): HTMLDivElement {
  const b = h('div', `mbtn ${cls}`, label);
  b.onclick = () => {
    audio.unlock();
    audio.play('ui_click');
    fn();
  };
  return b;
}

export class App {
  private screen: HTMLElement | null = null;
  battle: Battle | null = null;

  constructor(private root: HTMLElement) {
    this.applySettings();
  }

  applySettings(): void {
    audio.setVolumes({ master: SETTINGS.master, music: SETTINGS.music, sfx: SETTINGS.sfx, voice: SETTINGS.voice });
    CAM.edgePan = SETTINGS.edgePan;
  }

  private setScreen(e: HTMLElement): void {
    this.screen?.remove();
    this.screen = e;
    this.root.appendChild(e);
    applyLayout(e);
  }

  // ───────────── 主選單 ─────────────
  showMenu(): void {
    audio.music('menu');
    const s = h('div', 'scr');
    const bg = h('div', 'bg');
    bg.style.backgroundImage = `url(${asset('ui/menu_bg.jpg')})`;
    s.append(bg, h('div', 'vig'));
    const c = h('div', 'menu-c');
    c.dataset.layout = 'menu';
    c.appendChild(h('div', 'logo', `<img src="${asset('ui/emblem.png')}" alt=""><div><div class="t">千軍令</div><div class="s">三國戰役指揮</div></div>`));
    c.append(
      btn('⚔ 出征・歷史戰役', 'gold', () => this.showCampaign()),
      btn('🏕 自訂會戰', 'blue', () => this.showCustom()),
      btn('📖 操作說明', 'gray', () => this.showHelp()),
      btn('⚙ 設定', 'gray', () => this.showSettings()),
    );
    s.appendChild(c);
    s.appendChild(h('div', 'ver', `${VERSION}・點任意處開啟聲音`));
    s.addEventListener('pointerdown', () => audio.unlock(), { once: true });
    this.setScreen(s);
  }

  // ───────────── 戰役地圖 ─────────────
  showCampaign(): void {
    audio.music('menu');
    const s = h('div', 'scr');
    s.style.background = '#1a120a';
    const wrap = h('div', 'mapwrap');
    const box = h('div', 'mapbox');
    box.appendChild(h('img', 'map'));
    (box.firstChild as HTMLImageElement).src = asset('ui/campaign_map.jpg');
    for (const e of CAMPAIGN) {
      const n = h('div', `node${starCount(e.id) ? ' done' : ''}`);
      n.style.left = `${e.x}%`;
      n.style.top = `${e.y}%`;
      const stars = PROGRESS.stars[e.id] ?? [];
      n.innerHTML = `<div class="pin" style="background-image:url(${asset(e.image)})"></div><div class="nm">${e.name}</div><div class="yr">${e.year} 年${e.scenario ? '' : '・籌備中'}</div><div class="st">${[0, 1, 2].map((i) => (stars[i] ? '⭐' : '☆')).join('')}</div>`;
      if (!e.scenario) n.style.filter = 'grayscale(0.85) brightness(0.75)';
      n.onclick = () => {
        audio.unlock();
        audio.play('ui_card');
        if (e.scenario) this.showBriefing(e);
      };
      box.appendChild(n);
    }
    wrap.appendChild(box);
    s.appendChild(wrap);
    const total = CAMPAIGN.reduce((a, e) => a + starCount(e.id), 0);
    const top = h('div', 'camp-top', `<div class="camp-title">三國戰役</div><div class="camp-stars">⭐ ${total} / ${CAMPAIGN.length * 3}</div>`);
    s.appendChild(top);
    const bottom = h('div', 'camp-bottom');
    bottom.append(btn('↩ 返回', 'gray sm', () => this.showMenu()), btn('🏕 自訂會戰', 'blue sm', () => this.showCustom()));
    s.appendChild(bottom);
    this.setScreen(s);
  }

  // ───────────── 戰前簡報 ─────────────
  showBriefing(e: CampaignEntry): void {
    const sc = e.scenario!;
    const s = h('div', 'scr');
    const bg = h('div', 'bg');
    bg.style.backgroundImage = `url(${asset('ui/campaign_map.jpg')})`;
    bg.style.filter = 'blur(3px) brightness(0.6)';
    s.appendChild(bg);
    const br = h('div', 'brief');
    const card = h('div', 'bcard');
    const pic = h('div', 'pic', `<div class="ttl">${sc.title}<small>${sc.subtitle}・${sc.year}</small></div>`);
    pic.style.backgroundImage = `url(${asset(e.image)})`;
    const stars = PROGRESS.stars[e.id] ?? [];
    const txt = h(
      'div',
      'txt',
      `${sc.intro.map((p) => `<p>${p}</p>`).join('')}
      <h4>目標</h4><ul>${sc.goals.map((g) => `<li>${g}</li>`).join('')}</ul>
      <h4>三星條件</h4><ul style="list-style:none;padding-left:4px">${sc.stars.map((st, i) => `<li>${stars[i] ? '⭐' : '☆'} ${st.text}</li>`).join('')}</ul>
      ${sc.tip ? `<div class="tip">💡 ${sc.tip}</div>` : ''}
      <h4>難度</h4>`,
    );
    const diff = h('div', 'diff');
    const diffs: [Battle['opts']['difficulty'], string][] = [
      ['easy', '簡單'],
      ['normal', '普通'],
      ['hard', '困難'],
    ];
    const diffBtns = diffs.map(([d, nm]) => {
      const b = btn(nm, `sm ${SETTINGS.difficulty === d ? 'gold' : 'gray off'}`, () => {
        SETTINGS.difficulty = d;
        saveSettings();
        diffBtns.forEach((x, k) => (x.className = `mbtn sm ${diffs[k][0] === d ? 'gold' : 'gray off'}`));
      });
      diff.appendChild(b);
      return b;
    });
    txt.appendChild(diff);
    const acts = h('div', 'acts');
    acts.append(btn('↩ 返回', 'gray', () => this.showCampaign()), btn('⚔ 出戰', '', () => this.startBattle(sc, e.image)));
    txt.appendChild(acts);
    card.append(pic, txt);
    br.appendChild(card);
    s.appendChild(br);
    this.setScreen(s);
  }

  // ───────────── 戰鬥 ─────────────
  startBattle(sc: Scenario, image: string): void {
    audio.music('none');
    const ld = h('div', 'loading', `<div class="lt"><b>${sc.title}</b><span>佈陣中……</span><div class="pb"><i></i></div></div>`);
    ld.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.1), rgba(0,0,0,0.6)), url(${asset(image)})`;
    document.body.appendChild(ld);
    this.screen?.remove();
    this.screen = null;
    // 讓讀取畫面先畫出來再做重活
    setTimeout(() => {
      const params = new URLSearchParams(location.search);
      this.battle = new Battle(this.root, sc, {
        quality: SETTINGS.quality,
        difficulty: SETTINGS.difficulty,
        skipDeploy: params.has('skip'),
        onExit: (r) => this.onBattleExit(sc, image, r),
        onHelp: () => this.showHelp(),
        onSettings: () => this.showSettings(),
      });
      (window as unknown as { battle: Battle }).battle = this.battle;
      setTimeout(() => ld.remove(), 400);
    }, 60);
  }

  private onBattleExit(sc: Scenario, image: string, r: (BattleResult & { retry?: boolean }) | null): void {
    this.battle = null;
    if (r && !sc.id.startsWith('custom')) recordResult(sc.id, r.stars, r.time, r.win);
    if (r?.retry) {
      this.startBattle(sc, image);
      return;
    }
    if (sc.id.startsWith('custom')) this.showCustom();
    else this.showCampaign();
  }

  // ───────────── 自訂會戰 ─────────────
  private custom: CustomOptions = { ...CUSTOM_DEFAULT };
  showCustom(): void {
    audio.music('menu');
    const s = h('div', 'scr');
    const bg = h('div', 'bg');
    bg.style.backgroundImage = `url(${asset('battle/battle_custom.jpg')})`;
    bg.style.filter = 'brightness(0.55)';
    s.appendChild(bg);
    const m = h('div', 'modal');
    m.style.position = 'absolute';
    m.style.background = 'transparent';
    const box = h('div', 'box');
    box.innerHTML = '<h3>🏕 自訂會戰</h3>';
    const o = this.custom;
    const seg = <T extends string | number | boolean>(label: string, opts: [T, string][], get: () => T, set: (v: T) => void) => {
      const row = h('div', 'row', `<label>${label}</label>`);
      const sg = h('div', 'seg');
      const bs = opts.map(([v, nm]) => {
        const b = btn(nm, `sm ${get() === v ? 'gold' : 'gray off'}`, () => {
          set(v);
          bs.forEach((x, k) => (x.className = `mbtn sm ${opts[k][0] === get() ? 'gold' : 'gray off'}`));
        });
        sg.appendChild(b);
        return b;
      });
      row.appendChild(sg);
      box.appendChild(row);
    };
    seg('地形', [['plain', '平原'], ['river', '大河'], ['hills', '丘陵'], ['forest', '密林']], () => o.terrain, (v) => (o.terrain = v));
    seg('我軍', [['wei', '魏'], ['shu', '蜀'], ['wu', '吳'], ['yuan', '袁']], () => o.player, (v) => (o.player = v));
    seg('敵軍', [['wei', '魏'], ['shu', '蜀'], ['wu', '吳'], ['yuan', '袁']], () => o.enemy, (v) => (o.enemy = v));
    seg('我軍規模', [[6, '6 團'], [10, '10 團'], [14, '14 團']], () => o.mySize, (v) => (o.mySize = v));
    seg('敵軍規模', [[6, '6 團'], [10, '10 團'], [14, '14 團'], [20, '20 團']], () => o.enemySize, (v) => (o.enemySize = v));
    seg('糧倉', [[true, '有（可燒糧）'], [false, '無']], () => o.depots, (v) => (o.depots = v));
    seg('時間', [['day', '白天'], ['dusk', '黃昏'], ['night', '夜晚']], () => o.time, (v) => (o.time = v));
    seg('難度', [['easy', '簡單'], ['normal', '普通'], ['hard', '困難']], () => SETTINGS.difficulty, (v) => (SETTINGS.difficulty = v));
    const acts = h('div', 'close');
    acts.style.display = 'flex';
    acts.style.gap = '10px';
    acts.style.justifyContent = 'center';
    acts.append(btn('↩ 返回', 'gray sm', () => this.showMenu()), btn('⚔ 開戰', 'sm', () => this.startBattle(buildCustomScenario(o), 'battle/battle_custom.jpg')));
    box.appendChild(acts);
    m.appendChild(box);
    s.appendChild(m);
    this.setScreen(s);
  }

  // ───────────── 設定與說明 ─────────────
  showSettings(): void {
    const m = h('div', 'modal');
    const box = h('div', 'box', '<h3>⚙ 設定</h3>');
    const q = h('div', 'row', '<label>畫質</label>');
    const seg = h('div', 'seg');
    const qs: [typeof SETTINGS.quality, string][] = [
      ['high', '高'],
      ['medium', '中'],
      ['low', '低（手機）'],
    ];
    const qb = qs.map(([v, nm]) => {
      const b = btn(nm, `sm ${SETTINGS.quality === v ? 'gold' : 'gray off'}`, () => {
        SETTINGS.quality = v;
        qb.forEach((x, k) => (x.className = `mbtn sm ${qs[k][0] === v ? 'gold' : 'gray off'}`));
        saveSettings();
      });
      seg.appendChild(b);
      return b;
    });
    q.appendChild(seg);
    box.appendChild(q);
    const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'voice') => {
      const row = h('div', 'row', `<label>${label}</label>`);
      const inp = h('input');
      inp.type = 'range';
      inp.min = '0';
      inp.max = '1';
      inp.step = '0.05';
      inp.value = String(SETTINGS[key]);
      inp.oninput = () => {
        SETTINGS[key] = Number(inp.value);
        this.applySettings();
        saveSettings();
      };
      row.appendChild(inp);
      box.appendChild(row);
    };
    slider('主音量', 'master');
    slider('配樂', 'music');
    slider('音效', 'sfx');
    slider('語音', 'voice');
    const tg = (label: string, key: 'tips' | 'edgePan') => {
      const row = h('div', 'row', `<label>${label}</label>`);
      const b = btn(SETTINGS[key] ? '開' : '關', `sm ${SETTINGS[key] ? 'gold' : 'gray'}`, () => {
        SETTINGS[key] = !SETTINGS[key];
        b.textContent = SETTINGS[key] ? '開' : '關';
        b.className = `mbtn sm ${SETTINGS[key] ? 'gold' : 'gray'}`;
        this.applySettings();
        saveSettings();
      });
      row.appendChild(b);
      box.appendChild(row);
    };
    tg('軍師提示', 'tips');
    tg('邊緣捲動', 'edgePan');
    box.appendChild(h('div', 'row', '<span style="font-size:12px;opacity:.75">畫質在下一場戰鬥生效。網址加 ?dev=1 可開 DEV 微調工具（` 鍵）。</span>'));
    const c = h('div', 'close');
    c.appendChild(btn('確定', 'sm', () => m.remove()));
    box.appendChild(c);
    m.appendChild(box);
    m.onclick = (e) => e.target === m && m.remove();
    document.body.appendChild(m);
  }

  showHelp(): void {
    const m = h('div', 'modal');
    const rows: [string, string][] = [
      ['選取', '左鍵點軍團或頭上徽章／下方卡片；Shift 加選；左鍵拖曳框選；Ctrl＋點卡片＝同兵種全選；雙擊卡片＝鏡頭跳過去'],
      ['移動', '右鍵點地面；雙擊右鍵＝奔跑'],
      ['畫戰線', '右鍵按住拖曳：拖曳長度＝陣寬、方向＝朝向（多選時自動排成一線）'],
      ['攻擊', '右鍵點敵軍；右鍵點敵方糧倉＝縱火（輕騎兵最快）'],
      ['指令列', '奔跑、停止、堅守（長槍拒馬）、陣型、自由射擊、火矢、撤退、武將技'],
      ['計策卡', '右下角，花軍令點：擂鼓、火矢齊射、急行軍、斥候、鳴金、落石'],
      ['鏡頭', 'WASD／方向鍵／畫面邊緣平移；滾輪縮放；Q／E 或 Shift＋中鍵旋轉；中鍵拖曳平移'],
      ['時間', '空白鍵＝戰術暫停（暫停中可下令）；1／2／3＝0.5×／1×／2×'],
      ['快捷鍵', 'H 停止、R 奔跑、G 堅守、F 自由射擊、T 換陣型、Backspace 撤退、V 地形圖、Ctrl＋數字編隊'],
      ['觸控', '點卡片／徽章選取、點地面移動、點敵軍攻擊；長按地面再拖曳＝畫戰線；單指拖曳平移、雙指縮放旋轉'],
      ['勝利', '敵軍全數潰逃就贏。燒掉敵方糧倉→軍心大亂、斷糧→攻防大減、出現逃兵'],
      ['地形', '高地加攻加射程；涉水的敵人（半渡）受傷 +25%；森林擋箭可埋伏；己方營寨內防禦提升'],
    ];
    m.innerHTML = `<div class="box"><h3>📖 操作說明</h3><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table></div>`;
    const c = h('div', 'close');
    c.appendChild(btn('知道了', 'sm', () => m.remove()));
    m.querySelector('.box')!.appendChild(c);
    m.onclick = (e) => e.target === m && m.remove();
    document.body.appendChild(m);
  }
}
