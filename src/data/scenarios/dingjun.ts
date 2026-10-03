// 定軍山之戰（219 年）：黃忠居高臨下，趁夏侯淵修補鹿角時俯衝斬將
import type { Scenario } from '../scenario';

export const DINGJUN: Scenario = {
  id: 'dingjun',
  title: '定軍山之戰',
  subtitle: '居高臨下',
  year: '建安二十四年（219 年）',
  image: 'battle/battle_dingjun.jpg',
  intro: [
    '劉備進軍漢中，據定軍山。魏將夏侯淵與張郃屯兵山下。',
    '夜裡劉備火燒鹿角，夏侯淵親率輕兵修補南圍。法正望見時機：「可擊矣！」',
    '黃忠將軍，我軍居高臨下——擂鼓吶喊，從山上俯衝而下，斬殺夏侯淵！',
  ],
  goals: ['斬殺或逼退夏侯淵（敵軍主帥）', '據山不出，讓魏軍仰攻自損', '善用地形：居高臨下近戰最多 +45%、往下坡衝鋒 +30%'],
  tip: '別急著下山：魏軍 150 秒後會全軍仰攻，在山上固守、弓兵居高射擊（射程 +25%）。魏軍攻勢減弱後，黃忠與騎兵沿山坡俯衝，直取夏侯淵。',
  time: 'dusk',
  camera: { x: 0, z: 150, dist: 230 },
  map: {
    play: 540,
    seed: 2190,
    hills: [
      { x: 0, z: 125, r: 120, h: 24, plateau: true },
      { x: -200, z: -160, r: 60, h: 10 },
      { x: 210, z: -150, r: 55, h: 9 },
    ],
    rivers: [
      {
        pts: [
          [-340, -110],
          [-120, -80],
          [80, -120],
          [340, -90],
        ],
        w: 16,
        depth: 1.2,
        fords: [
          { t: 0.2, w: 30 },
          { t: 0.45, w: 34 },
          { t: 0.7, w: 30 },
        ],
      },
    ],
    roads: [
      {
        pts: [
          [0, 270],
          [-40, 200],
          [0, 130],
          [60, 30],
          [20, -60],
          [0, -230],
        ],
        w: 6,
      },
    ],
    forests: [
      { x: -170, z: 60, r: 50, density: 0.8 },
      { x: 180, z: 70, r: 50, density: 0.8 },
      { x: 0, z: -260, r: 40, density: 0.6 },
    ],
    clearings: [{ x: 0, z: 125, r: 80 }, { x: 0, z: -220, r: 40 }, { x: 60, z: -30, r: 25 }, { x: -110, z: -150, r: 22 }, { x: 110, z: -170, r: 22 }],
  },
  teams: [
    {
      faction: 'shu',
      name: '蜀軍',
      commander: 'huangzhong',
      hq: { x: 0, z: 225, stock: 400, name: '定軍山營' },
      depots: [{ x: -90, z: 245, stock: 700, name: '漢中糧道' }],
      deploy: { x: 0, z: 120, w: 200, d: 110 },
      regiments: [
        { type: 'guard', x: 30, z: 95, general: 'huangzhong', name: '黃忠部' },
        { type: 'guard', x: 0, z: 175, general: 'fazheng', role: 'reserve' },
        { type: 'sword', x: -40, z: 85 },
        { type: 'sword', x: 40, z: 75 },
        { type: 'spear', x: 0, z: 80 },
        { type: 'spear', x: -80, z: 100 },
        { type: 'archer', x: -30, z: 120 },
        { type: 'archer', x: 40, z: 125 },
        { type: 'archer', x: 80, z: 105, name: '諸葛連弩' },
        { type: 'cav', x: -60, z: 140, name: '白毦兵' },
        { type: 'cav', x: 70, z: 150 },
      ],
    },
    {
      faction: 'wei',
      name: '魏軍',
      commander: 'xiahouyuan',
      hq: { x: 0, z: -222, stock: 420, name: '夏侯淵大營' },
      depots: [
        { x: -110, z: -150, stock: 300, kind: 'camp', name: '北圍' },
        { x: 110, z: -170, stock: 300, kind: 'camp', name: '東圍' },
        { x: 60, z: -30, stock: 200, kind: 'camp', name: '南圍鹿角' },
      ],
      ai: { plan: 'defend', aggression: 0.6, raid: true, startDelay: 30, attackAfter: 150 },
      regiments: [
        // 夏侯淵坐鎮後方：先撐過魏軍仰攻，再突破過去斬將
        { type: 'guard', x: 40, z: -150, general: 'xiahouyuan', name: '夏侯淵部', role: 'hold' },
        { type: 'sword', x: 90, z: -35, count: 90, name: '修補鹿角的輕兵', role: 'hold', morale: 60 },
        { type: 'guard', x: -120, z: -120, general: 'zhanghe', name: '張郃部' },
        { type: 'sword', x: -60, z: -90 },
        { type: 'sword', x: -150, z: -100 },
        { type: 'spear', x: 0, z: -120 },
        { type: 'spear', x: 140, z: -130 },
        { type: 'spear', x: 60, z: -140, name: '魏軍精兵' },
        { type: 'archer', x: -40, z: -150 },
        { type: 'archer', x: 100, z: -190 },
        { type: 'archer', x: 0, z: -170 },
        { type: 'cav', x: -200, z: -60, role: 'raider' },
        { type: 'cav', x: 200, z: -80, name: '虎豹騎' },
      ],
    },
  ],
  onStart: (w) => {
    // 史實：黃忠於定軍山斬夏侯淵
    w.duelFate = (a, b) => ((a === 'huangzhong' && b === 'xiahouyuan') || (a === 'xiahouyuan' && b === 'huangzhong') ? { winner: 'huangzhong', killed: true } : null);
  },
  plan: [
    { text: '部署糧道', how: '開戰前：拖曳地圖上的 <b>🍚</b> 標記，或在下方面板選「官道／前線捷徑／後方小路」決定補給路線。', done: (w) => !!w.flags.did_route || w.started },
    { text: '據山不出', how: '全軍在山上按「🛡 固守」，讓魏軍仰攻（他們近戰最多 −35%、士氣持續下滑）。', done: (w) => (w.started ? w.t - ((w.flags.startT as number) ?? 0) : 0) > 160 },
    { text: '斬夏侯淵', how: '魏軍攻勢減弱後，選<b>黃忠</b> → 右鍵點<b>夏侯淵</b>（敵軍主帥）。靠近就會單挑，史實上黃忠一刀斬之。', done: (w) => w.winner === 0 },
  ],
  stars: [
    { text: '擊潰魏軍', check: (w) => w.winner === 0 },
    { text: '斬殺夏侯淵', check: (w) => w.regs.some((r) => r.general?.id === 'xiahouyuan' && !r.general.alive && !r.general.fled) },
    { text: '傷亡少於三成五', check: (w) => w.winner === 0 && w.teams[0].dead + w.teams[0].fled < w.teams[0].initialStrength * 0.35 },
  ],
  triggers: [
    {
      when: (w) => w.regs.some((r) => r.general?.id === 'xiahouyuan' && !r.general.alive && !r.general.fled),
      run: (w) => {
        w.events.push({ k: 'msg', text: '夏侯淵陣亡！魏軍群龍無首', tone: 'gold' });
        w.teams[1].panicUntil = w.t + 60;
        w.events.push({ k: 'panic', team: 1 });
      },
    },
  ],
  advisor: { name: '法正', portrait: 'hero/hero_fazheng.jpg' },
  hints: [
    { at: -1, text: '漢升，我軍<b>居高臨下</b>：近戰最多 +45%、弓弩射程 +25%、<b>往下坡衝鋒 +30%</b>。按「🗺 地形」看看山勢。' },
    { at: 8, text: '先讓<b>弓弩</b>從山上射擊山腳的魏軍。夏侯淵在<b>南圍鹿角</b>附近修補柵欄，身邊兵少。' },
    { at: 30, text: '<b>可擊矣！</b>選黃忠與騎兵，右鍵點<b>夏侯淵</b>——沿著山坡俯衝下去！' },
    { when: (w) => w.regs.some((r) => r.team === 1 && !r.gone && !r.routing && r.terrain.relHeight < -6 && r.engagedWith.size > 0), text: '魏軍在<b>仰攻</b>我軍！他們近戰吃虧，守住山頭就是勝利。' },
  ],
};
