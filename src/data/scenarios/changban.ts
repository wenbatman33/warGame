// 長坂坡之戰（208 年）：張飛據水斷橋、趙雲七進七出——堅守 5 分鐘讓劉備脫身
import type { Scenario } from '../scenario';

export const CHANGBAN: Scenario = {
  id: 'changban',
  title: '長坂坡之戰',
  subtitle: '據水斷橋',
  year: '建安十三年（208 年）',
  image: 'battle/battle_changban.jpg',
  intro: [
    '曹操親率五千虎豹騎，一日一夜行三百餘里，追及劉備於當陽長坂。',
    '劉備棄妻子南走，命張飛率二十騎斷後。張飛據水斷橋，瞋目橫矛：「身是張益德也，可來共決死！」敵皆無敢近者。',
    '趙雲懷抱阿斗，在曹軍中七進七出——主公，守住長坂橋 5 分鐘，並接應趙雲回到南岸！',
  ],
  goals: ['堅守 5 分鐘（曹軍只能走橋或東邊遠處的淺灘過河）', '接應趙雲：趙雲從北岸殺回南岸', '張飛「長坂怒吼」：45 m 內敵軍士氣 −30、定身 3 秒'],
  tip: '橋是天然隘口：長槍兵在橋頭堅守（拒馬）專剋騎兵，弓弩從兩側射擊擠在橋上的敵軍。東邊森林裡藏著兩隊伏兵（敵軍看不見）。',
  time: 'day',
  holdTime: 300,
  camera: { x: 0, z: 90, dist: 210 },
  map: {
    play: 520,
    seed: 2080,
    hills: [
      { x: -150, z: 130, r: 50, h: 7, plateau: true },
      { x: 180, z: -140, r: 60, h: 9 },
      { x: -200, z: -150, r: 50, h: 8 },
    ],
    rivers: [
      {
        pts: [
          [-330, 10],
          [-150, -5],
          [0, 5],
          [150, -10],
          [330, 5],
        ],
        w: 30,
        depth: 2.6,
        fords: [{ t: 0.93, w: 22 }],
      },
    ],
    roads: [
      {
        pts: [
          [0, -270],
          [-20, -120],
          [0, -20],
          [0, 30],
          [10, 140],
          [0, 280],
        ],
        w: 7,
      },
    ],
    forests: [
      { x: 140, z: 90, r: 55 },
      { x: -230, z: 60, r: 45, density: 0.8 },
      { x: -80, z: -170, r: 45, density: 0.8 },
      { x: 60, z: -220, r: 40, density: 0.7 },
    ],
    clearings: [{ x: 0, z: 220, r: 40 }, { x: 0, z: -230, r: 40 }, { x: 0, z: 40, r: 30 }],
  },
  bridges: [{ x: 0, z: 2, angle: 0, length: 52 }],
  teams: [
    {
      faction: 'shu',
      name: '劉備軍',
      commander: 'zhangfei',
      hq: { x: 0, z: 222, stock: 380, name: '劉備營' },
      depots: [],
      deploy: { x: 0, z: 90, w: 380, d: 110 },
      regiments: [
        { type: 'guard', x: 0, z: 42, general: 'zhangfei', name: '張飛二十騎', facing: 180 },
        { type: 'spear', x: -32, z: 52, name: '橋頭長槍', hold: true },
        { type: 'spear', x: 32, z: 52, name: '橋頭長槍', hold: true },
        { type: 'archer', x: -60, z: 85, name: '弓手' },
        { type: 'crossbow', x: 60, z: 85, name: '弩手' },
        { type: 'sword', x: 0, z: 110, name: '殿後刀盾' },
        { type: 'lightcav', x: 140, z: 80, name: '林中伏兵', hidden: true },
        { type: 'lightcav', x: 165, z: 105, name: '林中伏兵', hidden: true },
        { type: 'guard', x: 0, z: 190, general: 'liubei', role: 'reserve' },
        { type: 'guard', x: -150, z: -150, general: 'zhaoyun', name: '趙雲（懷抱阿斗）', facing: 180, fixed: true },
      ],
    },
    {
      faction: 'wei',
      name: '曹軍',
      commander: 'caocao',
      hq: { x: 0, z: -232, stock: 420, name: '曹軍前營' },
      depots: [],
      ai: { plan: 'attack', aggression: 0.8, raid: false, startDelay: 8 },
      regiments: [
        { type: 'guard', x: 0, z: -200, general: 'caocao', role: 'reserve' },
        { type: 'heavycav', x: -40, z: -100, name: '虎豹騎' },
        { type: 'heavycav', x: 40, z: -100, name: '虎豹騎' },
        { type: 'heavycav', x: 0, z: -130, name: '虎豹騎' },
        { type: 'lightcav', x: -90, z: -110 },
        { type: 'lightcav', x: 90, z: -110 },
        { type: 'lightcav', x: 160, z: -80, name: '輕騎（繞淺灘）', role: 'flank' },
        { type: 'sword', x: -50, z: -160 },
        { type: 'sword', x: 50, z: -160 },
        { type: 'spear', x: 0, z: -170 },
        { type: 'archer', x: -30, z: -190 },
        { type: 'archer', x: 30, z: -190 },
        { type: 'guard', x: -120, z: -120, general: 'caoren' },
      ],
    },
  ],
  stars: [
    { text: '堅守 5 分鐘', check: (w) => w.winner === 0 },
    { text: '接應趙雲回到南岸', check: (w) => w.regs.some((r) => r.general?.id === 'zhaoyun' && r.general.alive && r.mz > 25) },
    { text: '張飛部隊從未潰逃', check: (w) => w.winner === 0 && w.regs.some((r) => r.general?.id === 'zhangfei' && r.routs === 0 && !r.gone) },
  ],
  triggers: [
    {
      // 150 秒：關羽率水軍自漢津趕到
      when: (w) => w.t - ((w.flags.startT as number) ?? 0) > 150,
      run: (w) =>
        w.reinforce(
          0,
          [
            { type: 'guard', x: 235, z: 215, general: 'guanyu', name: '關羽援軍', facing: 315 },
            { type: 'sword', x: 205, z: 230, name: '江夏援軍', facing: 315 },
            { type: 'archer', x: 250, z: 245, name: '江夏弓手', facing: 315 },
          ],
          '關羽率江夏援軍趕到！',
        ),
    },
  ],
  advisor: { name: '劉備', portrait: 'hero/hero_liubei.jpg' },
  hints: [
    { at: -1, text: '翼德，曹軍必須<b>擠過長坂橋</b>！長槍兵在橋頭<b>堅守</b>擺拒馬，弓弩從兩側射擊橋上的敵軍。' },
    { at: 5, text: '趙雲還在<b>北岸</b>（左上）！選趙雲，右鍵點<b>南岸</b>——他會殺穿曹軍、從橋上回來。開「🏃 奔跑」比較快。' },
    { when: (w) => w.regs.some((r) => r.team === 1 && !r.gone && Math.hypot(r.mx, r.mz) < 45), text: '曹軍衝上橋了！選張飛，按「<b>⭐ 長坂怒吼</b>」——敵軍嚇得定身、士氣大降！' },
    { when: (w) => w.regs.some((r) => r.team === 1 && !r.gone && r.mx > 180 && r.mz > -20), text: '有曹軍騎兵<b>從東邊淺灘繞過來</b>了！森林裡的伏兵可以出擊截住他們。' },
  ],
};
