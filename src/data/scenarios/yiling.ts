// 夷陵之戰・火燒連營（222 年）：劉備連營七百里紮在林中，陸遜一把火燒盡
import type { Scenario } from '../scenario';

const camps: [number, number][] = [
  [-250, -40],
  [-180, -10],
  [-110, -45],
  [-40, -15],
  [30, -50],
  [100, -20],
  [170, -55],
  [240, -25],
];

export const YILING: Scenario = {
  id: 'yiling',
  title: '夷陵之戰',
  subtitle: '火燒連營七百里',
  year: '章武二年（222 年）',
  image: 'battle/battle_yiling.jpg',
  intro: [
    '關羽敗亡，劉備親率大軍東征伐吳，連營七百里，深入峽谷。',
    '時值盛夏，蜀軍苦於酷暑，將營寨紮於林木茂密之處。',
    '大都督陸遜按兵數月，今日時機已到：「以火攻拔之」——點燃連營，一營接一營燒過去！',
  ],
  goals: ['擊潰蜀軍', '燒毀蜀軍連營（共 8 座）', '營寨會互相延燒：燒一座，鄰營跟著著火'],
  tip: '弓兵右鍵點營寨會自動射火矢；陸遜的「火燒連營」直接點燃一片。沙摩柯的蠻兵很兇猛，用長槍與弓兵應付。',
  time: 'dusk',
  wind: { x: -0.8, z: -0.2 },
  camera: { x: 0, z: 130, dist: 250 },
  map: {
    play: 600,
    seed: 222,
    hills: [
      { x: -200, z: -170, r: 70, h: 14 },
      { x: 150, z: -180, r: 80, h: 16 },
      { x: 0, z: -210, r: 60, h: 10, plateau: true },
      { x: 220, z: 110, r: 50, h: 8 },
    ],
    ridges: [
      {
        pts: [
          [-300, -260],
          [0, -280],
          [300, -250],
        ],
        w: 50,
        h: 18,
      },
    ],
    rivers: [
      {
        pts: [
          [-340, 248],
          [-100, 232],
          [120, 245],
          [340, 230],
        ],
        w: 50,
      },
    ],
    roads: [
      {
        pts: [
          [-300, 30],
          [-150, 20],
          [0, 30],
          [150, 15],
          [300, 25],
        ],
        w: 7,
      },
      {
        pts: [
          [0, 200],
          [10, 100],
          [0, 30],
          [-10, -120],
          [0, -200],
        ],
        w: 6,
      },
    ],
    forests: [
      { x: -220, z: -40, r: 70 },
      { x: -100, z: -40, r: 70 },
      { x: 20, z: -40, r: 70 },
      { x: 140, z: -40, r: 70 },
      { x: 250, z: -40, r: 60 },
      { x: -120, z: 140, r: 45, density: 0.6 },
      { x: 130, z: 150, r: 40, density: 0.6 },
    ],
    clearings: [...camps.map(([x, z]) => ({ x, z, r: 16 })), { x: 0, z: -205, r: 40 }, { x: 0, z: 160, r: 50 }],
  },
  teams: [
    {
      faction: 'wu',
      name: '吳軍',
      commander: 'luxun',
      hq: { x: 0, z: 170, stock: 380, name: '猇亭大營' },
      depots: [{ x: -170, z: 200, stock: 700, name: '江邊糧倉' }],
      deploy: { x: 0, z: 120, w: 480, d: 110 },
      regiments: [
        { type: 'guard', x: 0, z: 140, general: 'luxun', role: 'reserve' },
        { type: 'guard', x: -150, z: 100, general: 'zhuran' },
        { type: 'guard', x: 150, z: 100, general: 'xusheng' },
        { type: 'sword', x: -70, z: 85 },
        { type: 'sword', x: 60, z: 85 },
        { type: 'spear', x: -10, z: 88 },
        { type: 'spear', x: 130, z: 82 },
        { type: 'archer', x: -110, z: 120, name: '火弓營' },
        { type: 'archer', x: -20, z: 118, name: '火弓營' },
        { type: 'archer', x: 80, z: 120, name: '火弓營' },
        { type: 'archer', x: 190, z: 110 },
        { type: 'cav', x: -220, z: 110 },
      ],
    },
    {
      faction: 'shu',
      name: '蜀軍',
      commander: 'liubei',
      hq: { x: 0, z: -205, stock: 400, name: '劉備大營' },
      depots: camps.map(([x, z], i) => ({ x, z, stock: 300, kind: 'camp' as const, name: `蜀營${'一二三四五六七八'[i]}` })),
      ai: { plan: 'defend', aggression: 0.5, raid: true, startDelay: 40, attackAfter: 200 },
      regiments: [
        { type: 'guard', x: 0, z: -170, general: 'liubei', role: 'reserve' },
        { type: 'guard', x: 90, z: -90, general: 'fengxi' },
        { type: 'guard', x: -120, z: -95, general: 'shamoke', name: '五溪蠻兵', morale: 85 },
        { type: 'spear', x: -150, z: -80, name: '五溪蠻兵', morale: 80 },
        ...camps.map(([x, z], i) => ({ type: (['sword', 'spear', 'sword', 'archer', 'sword', 'spear', 'archer', 'sword'] as const)[i], x, z: z - 28, count: 90, name: `蜀營${'一二三四五六七八'[i]}守軍`, morale: 62 })),
        { type: 'cav', x: 230, z: -110, role: 'raider' as const },
        { type: 'archer', x: 30, z: -110, name: '蜀中連弩' },
        { type: 'spear', x: -40, z: -130 },
      ],
    },
  ],
  stars: [
    { text: '擊潰蜀軍', check: (w) => w.winner === 0 },
    { text: '燒毀 6 座以上蜀營', check: (w) => w.structs.filter((s) => s.kind === 'camp' && s.burnt).length >= 6 },
    { text: '劉備大營焚毀或劉備陣亡', check: (w) => w.structs.some((s) => s.kind === 'hq' && s.team === 1 && s.burnt) || w.regs.some((r) => r.general?.id === 'liubei' && !r.general.alive && !r.general.fled) },
  ],
  triggers: [
    {
      when: (w) => w.structs.filter((s) => s.kind === 'camp' && s.burnt).length >= 4,
      run: (w) => {
        w.events.push({ k: 'msg', text: '火燒連營！蜀軍四十餘營盡毀', tone: 'gold' });
        w.teams[1].panicUntil = w.t + 60;
        w.events.push({ k: 'panic', team: 1 });
      },
    },
  ],
  advisor: { name: '陸遜', portrait: 'hero/hero_luxun.jpg' },
  hints: [
    { at: -1, text: '蜀軍營寨都紮在<b>林中</b>，營與營相連。點燃一座，火會<b>延燒</b>到鄰營！' },
    { at: 4, text: '選弓兵後<b>右鍵點蜀營</b>：弓兵會自動射火矢。陸遜的「火燒連營」可以一次點燃一片。' },
    { when: (w) => w.regs.some((r) => r.team === 1 && r.general?.id === 'shamoke' && r.engagedWith.size > 0), text: '沙摩柯的<b>蠻兵</b>非常兇猛！用長槍頂住，弓兵從後面放箭。' },
    { when: (w) => w.structs.filter((s) => s.kind === 'camp' && s.burnt).length >= 4, text: '連營已燒掉一半，<b>蜀軍軍心大亂</b>！全軍壓上！' },
  ],
};
