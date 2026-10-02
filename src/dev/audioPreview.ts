// 音效預覽頁（audio-preview.html）：每個音效一顆按鈕、環境層滑桿、配樂切換、語音、壓力測試
// 開發時：npm run dev 後開 /audio-preview.html

import { audio, type AmbienceLevels, type MusicMode, type SfxId, type VoiceId } from '../audio/audio';
import { MUSIC_MODES, SFX_IDS, VOICE_IDS } from '../audio/types';

const SFX_LABEL: Record<SfxId, string> = {
  drum_start: '開戰戰鼓',
  drum_boost: '擂鼓助威',
  horn_charge: '衝鋒號角',
  horn_retreat: '撤退號',
  gong: '鳴金',
  clash: '兵刃交擊',
  arrow_volley: '箭雨齊發',
  arrow_hit: '箭落地',
  shield_hit: '箭中盾',
  charge_impact: '騎兵衝撞',
  death: '倒地',
  war_cry: '軍團吶喊',
  fire_ignite: '點火',
  depot_burnt: '糧倉焚毀',
  rout: '潰逃',
  general_down: '武將陣亡',
  stratagem: '施放計策',
  ui_click: 'UI 點擊',
  ui_select: 'UI 選取',
  ui_order: 'UI 下令',
  ui_card: 'UI 卡片',
  ui_error: 'UI 錯誤',
  victory_sting: '勝利',
  defeat_sting: '敗北',
  star: '結算星星',
};

const VOICE_LINE: Record<VoiceId, string> = {
  ack_move: '遵命！',
  ack_attack: '殺！',
  ack_charge: '衝鋒！',
  ack_retreat: '撤！',
  ack_hold: '堅守陣地！',
  enemy_depot_burning: '敵軍糧倉起火了！',
  our_depot_burning: '我軍糧倉遭襲！',
  enemy_depot_burnt: '敵軍糧草已焚，軍心大亂！',
  our_depot_burnt: '糧倉失守，軍心動搖！',
  general_down: '將軍陣亡！',
  enemy_routing: '敵軍潰逃了！',
  our_routing: '我軍有部隊潰逃！',
  victory: '大獲全勝！',
  defeat: '全軍潰敗……',
  battle_start: '全軍聽令，進攻！',
};

const MUSIC_LABEL: Record<MusicMode, string> = {
  none: '靜音',
  menu: '主選單',
  deploy: '部署',
  battle: '交戰',
  climax: '決戰',
  victory: '凱旋',
  defeat: '敗北',
};

// ─────────────────────────────────────────── DOM 小工具

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids) e.append(k);
  return e;
}

function button(label: string, sub: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', {}, label);
  if (sub) b.append(el('small', {}, sub));
  b.addEventListener('click', () => {
    audio.unlock();
    onClick();
  });
  return b;
}

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): { root: HTMLElement; input: HTMLInputElement } {
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  const out = el('output', {}, String(value));
  input.addEventListener('input', () => {
    audio.unlock();
    const v = Number(input.value);
    out.textContent = String(v);
    onInput(v);
  });
  return { root: el('div', { className: 'slider' }, el('span', {}, label), input, out), input };
}

function panel(title: string, ...kids: Array<Node | string>): HTMLElement {
  return el('section', { className: 'panel' }, el('h2', {}, title), ...kids);
}

// ─────────────────────────────────────────── 狀態

const app = document.getElementById('app')!;
const opt = { randomPos: false, rate: 1, volume: 1 };
const listener = { x: 0, z: 0, h: 60 };
const amb: AmbienceLevels = { melee: 0, cavalry: 0, marching: 0, fire: 0 };

function playOne(id: SfxId): void {
  if (opt.randomPos) {
    audio.play(id, { x: listener.x + (Math.random() * 2 - 1) * 300, z: listener.z + (Math.random() * 2 - 1) * 300, rate: opt.rate, volume: opt.volume });
  } else audio.play(id, { rate: opt.rate, volume: opt.volume });
}

/** 在 ms 毫秒內平均觸發 n 次（壓測節流） */
function burst(id: SfxId, n: number, ms: number): void {
  for (let i = 0; i < n; i++) {
    window.setTimeout(() => audio.play(id, { x: listener.x + (Math.random() * 2 - 1) * 200, z: listener.z + (Math.random() * 2 - 1) * 200 }), (i / n) * ms);
  }
}

// 任何互動都先解鎖
window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
window.addEventListener('keydown', () => audio.unlock(), { capture: true });

// ─────────────────────────────────────────── 版面

const status = el('pre', { id: 'status' }, '尚未解鎖（點任何按鈕）');
app.append(
  el('h1', {}, '千軍令 · 音效預覽'),
  el('div', { className: 'sub' }, '全部 WebAudio 程式合成（語音除外）。第一次點擊會建立 AudioContext 並在背景預渲染常用音效變體。'),
  panel('狀態', el('div', { className: 'row' }, button('解鎖音訊', 'unlock()', () => undefined)), status),
);

// 音量
const vols = { master: 0.85, music: 0.55, sfx: 0.9, voice: 1 };
const volKeys = ['master', 'music', 'sfx', 'voice'] as const;
const volLabel: Record<(typeof volKeys)[number], string> = { master: '總音量', music: '配樂', sfx: '音效', voice: '語音' };
const volPanel = panel('音量');
for (const k of volKeys) {
  volPanel.append(
    slider(volLabel[k], 0, 1, 0.01, vols[k], (v) => {
      vols[k] = v;
      audio.setVolumes({ [k]: v });
    }).root,
  );
}

// 聽者
const lisPanel = panel('聽者（鏡頭）');
const applyListener = (): void => audio.setListener(listener.x, listener.z, listener.h);
lisPanel.append(
  slider('注視 x', -600, 600, 1, 0, (v) => {
    listener.x = v;
    applyListener();
  }).root,
  slider('注視 z', -600, 600, 1, 0, (v) => {
    listener.z = v;
    applyListener();
  }).root,
  slider('鏡頭高度 m', 5, 400, 1, 60, (v) => {
    listener.h = v;
    applyListener();
  }).root,
  el('div', { className: 'sub' }, '高度拉到 250 m 以上時，環境層會變成低沉的遠方轟鳴；「隨機位置」打開時可聽到距離衰減與左右聲像。'),
);

app.append(el('div', { className: 'cols' }, volPanel, lisPanel));

// 音效
const chk = el('input', { type: 'checkbox' });
chk.addEventListener('change', () => (opt.randomPos = chk.checked));
const sfxGrid = el('div', { className: 'grid' });
for (const id of SFX_IDS) sfxGrid.append(button(SFX_LABEL[id], id, () => playOne(id)));
app.append(
  panel(
    '音效',
    el('div', { className: 'row' }, el('label', { className: 'chk' }, chk, '隨機位置（注視點 ±300 m）')),
    slider('rate', 0.5, 2, 0.01, 1, (v) => (opt.rate = v)).root,
    slider('volume', 0, 2, 0.01, 1, (v) => (opt.volume = v)).root,
    sfxGrid,
    el('div', { className: 'sub' }, '結算星星：rate 1 → 1.12 → 1.26 依序升高。'),
  ),
);

// 壓力測試
app.append(
  panel(
    '壓力測試（節流）',
    el(
      'div',
      { className: 'grid' },
      button('兵刃 ×60', '1 秒內（同時上限 8）', () => burst('clash', 60, 1000)),
      button('倒地 ×120', '1 秒內（每 50ms 一次）', () => burst('death', 120, 1000)),
      button('箭雨 ×12', '0.5 秒內', () => burst('arrow_volley', 12, 500)),
      button('箭中盾 ×80', '1 秒內', () => burst('shield_hit', 80, 1000)),
      button('三顆星', 'rate 1 / 1.12 / 1.26', () => {
        [1, 1.12, 1.26].forEach((r, i) => window.setTimeout(() => audio.play('star', { rate: r }), i * 450));
      }),
      button('全部連發', '每個音效各一次', () => {
        SFX_IDS.forEach((id, i) => window.setTimeout(() => audio.play(id), i * 60));
      }),
    ),
  ),
);

// 環境層
const ambSliders: Record<keyof AmbienceLevels, HTMLInputElement> = {} as Record<keyof AmbienceLevels, HTMLInputElement>;
const ambLabel: Record<keyof AmbienceLevels, string> = { melee: '混戰', cavalry: '騎兵', marching: '行軍', fire: '大火' };
const ambPanel = panel('環境層（平滑過渡）');
for (const k of Object.keys(ambLabel) as Array<keyof AmbienceLevels>) {
  const s = slider(ambLabel[k], 0, 1, 0.01, 0, (v) => {
    amb[k] = v;
    audio.setAmbience({ ...amb });
  });
  ambSliders[k] = s.input;
  ambPanel.append(s.root);
}
const preset = (label: string, v: AmbienceLevels): HTMLButtonElement =>
  button(label, '', () => {
    Object.assign(amb, v);
    for (const k of Object.keys(v) as Array<keyof AmbienceLevels>) {
      ambSliders[k].value = String(v[k]);
      ambSliders[k].dispatchEvent(new Event('input'));
    }
    audio.setAmbience({ ...amb });
  });
ambPanel.append(
  el(
    'div',
    { className: 'row' },
    preset('寧靜', { melee: 0, cavalry: 0, marching: 0, fire: 0 }),
    preset('行軍', { melee: 0, cavalry: 0.1, marching: 0.8, fire: 0 }),
    preset('小規模接戰', { melee: 0.35, cavalry: 0, marching: 0.3, fire: 0 }),
    preset('千軍混戰', { melee: 1, cavalry: 0.3, marching: 0.2, fire: 0 }),
    preset('騎兵衝鋒', { melee: 0.5, cavalry: 1, marching: 0, fire: 0 }),
    preset('火燒連營', { melee: 0.4, cavalry: 0, marching: 0, fire: 1 }),
  ),
);

// 配樂
const musicBtns = new Map<MusicMode, HTMLButtonElement>();
const musicRow = el('div', { className: 'row' });
for (const m of MUSIC_MODES) {
  const b = button(MUSIC_LABEL[m], m, () => {
    audio.music(m);
    for (const [k, x] of musicBtns) x.classList.toggle('on', k === m);
  });
  musicBtns.set(m, b);
  musicRow.append(b);
}
const musicPanel = panel('配樂（模式間交叉淡化）', musicRow);

app.append(el('div', { className: 'cols' }, ambPanel, musicPanel));

// 語音
const voiceGrid = el('div', { className: 'grid' });
for (const id of VOICE_IDS) voiceGrid.append(button(VOICE_LINE[id], id, () => audio.voice(id)));
app.append(
  panel(
    '語音（同時只播一句、冷卻 1.5 秒；開戰／結算可打斷回應）',
    voiceGrid,
    el(
      'div',
      { className: 'row' },
      button('優先度測試', '遵命 → 立刻大獲全勝', () => {
        audio.voice('ack_move');
        window.setTimeout(() => audio.voice('victory'), 200);
      }),
      button('排隊測試', '糧倉起火 → 敵軍潰逃', () => {
        audio.voice('enemy_depot_burning');
        window.setTimeout(() => audio.voice('enemy_routing'), 300);
      }),
    ),
  ),
);

// 狀態列
window.setInterval(() => {
  const d = audio.debugInfo();
  const a = d.ambience;
  status.textContent =
    `context: ${d.state}   支援: ${d.supported ? '是' : '否'}   配樂: ${d.music}   語音: ${d.voice ?? '—'}（已載入 ${d.voicesLoaded}/15）\n` +
    `一次性音效: ${d.activeSfx}   環境細節事件: ${d.ambEvents}   預渲染變體: ${d.bankRendered}${d.bankReady ? '（完成）' : '（渲染中…）'}\n` +
    `環境強度  混戰 ${a.melee.toFixed(2)}  騎兵 ${a.cavalry.toFixed(2)}  行軍 ${a.marching.toFixed(2)}  大火 ${a.fire.toFixed(2)}   聽者 (${d.listener.x}, ${d.listener.z}) 高 ${d.listener.height} m`;
}, 250);

// 給瀏覽器主控台除錯用
(window as unknown as { __audio: typeof audio }).__audio = audio;
