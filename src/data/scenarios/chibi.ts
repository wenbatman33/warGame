// 赤壁之戰・烏林（208 年）：黃蓋火船已點燃曹營，東風助火勢，孫劉聯軍登岸火燒連營
import type { Scenario } from '../scenario';

const campRow = [-230, -150, -70, 10, 90, 170];

export const CHIBI: Scenario = {
  id: 'chibi',
  title: '赤壁之戰',
  subtitle: '火燒烏林',
  year: '建安十三年（208 年）',
  image: 'battle/battle_chibi.jpg',
  intro: [
    '曹操率大軍南下，戰船以鐵索相連，軍中瘟疫流行，士卒疲病。',
    '黃蓋詐降，十艘火船乘東南風直衝曹營，「火烈風猛，船往如箭」，烈焰延及岸上營寨。',
    '都督，聯軍已在烏林登岸！趁東風正盛，火燒曹軍連營，擊潰慌亂的北軍！',
  ],
  goals: ['擊潰曹軍', '燒毀岸上的六座營寨', '東風由東往西吹：火勢向西蔓延較快'],
  tip: '弓兵開「🔥 火矢」射向營寨可點火；周瑜的「火燒連營」能直接引燃一片。曹軍染疫，士氣基礎值偏低。',
  time: 'night',
  wind: { x: -1, z: 0 },
  camera: { x: 40, z: 110, dist: 240, yaw: 0 },
  map: {
    play: 580,
    seed: 208,
    base: 3,
    hills: [
      { x: -60, z: -130, r: 60, h: 8, plateau: true },
      { x: 150, z: -120, r: 50, h: 7 },
      { x: -230, z: -170, r: 60, h: 12 },
    ],
    rivers: [
      {
        pts: [
          [-340, 222],
          [-120, 205],
          [80, 215],
          [340, 200],
        ],
        w: 70,
        depth: 3,
      },
    ],
    roads: [
      {
        pts: [
          [0, -290],
          [10, -150],
          [0, -40],
          [-10, 60],
          [0, 160],
        ],
        w: 7,
      },
      {
        pts: [
          [-280, 20],
          [-80, 10],
          [100, 25],
          [280, 15],
        ],
        w: 6,
      },
    ],
    forests: [
      { x: 230, z: -160, r: 70 },
      { x: -250, z: -40, r: 55 },
      { x: 60, z: -230, r: 50, density: 0.8 },
      { x: 260, z: 90, r: 40, density: 0.6 },
    ],
    clearings: [{ x: 0, z: -230, r: 45 }, { x: -170, z: -235, r: 30 }, { x: 0, z: 140, r: 50 }, ...campRow.map((x) => ({ x, z: 10, r: 20 }))],
  },
  teams: [
    {
      faction: 'wu',
      name: '聯軍',
      commander: 'zhouyu',
      hq: { x: 0, z: 150, stock: 380, name: '江岸大營' },
      depots: [{ x: 190, z: 160, stock: 700, name: '糧船' }],
      deploy: { x: 20, z: 110, w: 460, d: 110 },
      regiments: [
        { type: 'guard', x: 0, z: 125, general: 'zhouyu', role: 'reserve' },
        { type: 'guard', x: 110, z: 110, general: 'huanggai' },
        { type: 'guard', x: -130, z: 110, general: 'ganning' },
        { type: 'guard', x: 180, z: 105, general: 'guanyu', name: '關羽部（劉備軍）' },
        { type: 'sword', x: -60, z: 85, name: '江東刀盾' },
        { type: 'sword', x: 40, z: 85, name: '解煩兵' },
        { type: 'spear', x: -10, z: 88 },
        { type: 'spear', x: 120, z: 85, name: '荊州長槍' },
        { type: 'archer', x: -80, z: 115, name: '江東弓手' },
        { type: 'archer', x: 30, z: 115, name: '火弓營' },
        { type: 'archer', x: 140, z: 130, name: '水軍弓手' },
        { type: 'crossbow', x: -170, z: 95, name: '江東弩營' },
        { type: 'lightcav', x: 220, z: 120, name: '劉備騎兵' },
      ],
    },
    {
      faction: 'wei',
      name: '曹軍',
      commander: 'caocao',
      hq: { x: 0, z: -228, stock: 420, name: '曹操大營' },
      depots: [{ x: -170, z: -235, stock: 900, main: true, name: '烏林糧營' }, ...campRow.map((x, i) => ({ x, z: 10 + (i % 2) * 18, stock: 300, kind: 'camp' as const, name: `第${'一二三四五六'[i]}營` }))],
      ai: { plan: 'defend', aggression: 0.5, raid: false, startDelay: 30, attackAfter: 150 },
      regiments: [
        { type: 'guard', x: 0, z: -195, general: 'caocao', role: 'reserve', morale: 70 },
        { type: 'guard', x: -150, z: -60, general: 'caoren', morale: 65 },
        { type: 'guard', x: 140, z: -60, general: 'xiahoudun', morale: 65 },
        ...campRow.map((x, i) => ({ type: (i % 3 === 1 ? 'spear' : 'sword') as 'spear' | 'sword', x, z: -25 + (i % 2) * 18, morale: 52, name: `第${'一二三四五六'[i]}營守軍` })),
        { type: 'archer', x: -100, z: -75, morale: 52 },
        { type: 'archer', x: 60, z: -75, morale: 52 },
        { type: 'crossbow', x: -20, z: -90, morale: 55 },
        { type: 'halberd', x: 20, z: -130, morale: 60, name: '北軍精銳' },
        { type: 'lightcav', x: -250, z: -90, morale: 58 },
        { type: 'heavycav', x: 230, z: -100, morale: 70, name: '虎豹騎' },
        { type: 'spear', x: -170, z: -205, role: 'guard', morale: 55, name: '糧營守軍' },
      ],
    },
  ],
  // 江上的曹軍連環船：大多已經起火
  decor: Array.from({ length: 13 }, (_, i) => ({
    kind: 'ship' as const,
    x: -270 + i * 45 + (i % 2) * 6,
    z: 196 + (i % 3) * 7,
    angle: Math.PI / 2 + (i % 2 ? 0.08 : -0.06),
    team: 1,
    burning: i % 4 !== 3,
    burnt: i % 5 === 1,
  })),
  stars: [
    { text: '擊潰曹軍', check: (w) => w.winner === 0 },
    { text: '燒毀全部六座營寨', check: (w) => w.structs.filter((s) => s.kind === 'camp' && s.burnt).length >= 6 },
    { text: '開戰 9 分鐘內獲勝', check: (w) => w.winner === 0 && w.t - ((w.flags.startT as number) ?? 0) <= 540 },
  ],
  onStart: (w) => {
    // 黃蓋火船：最靠近江邊的兩座營已經起火
    const camps = w.structs.filter((s) => s.kind === 'camp').sort((a, b) => b.z - a.z);
    for (const c of camps.slice(0, 2)) {
      c.ignite = 1;
      c.fire = 0.9;
      w.events.push({ k: 'ignite', s: c.id });
      // 營中守軍被大火驚潰
      for (const r of w.regs) if (r.team === 1 && !r.gone && Math.hypot(r.mx - c.x, r.mz - c.z) < 45) w.rout(r);
    }
    w.events.push({ k: 'msg', text: '東風起！黃蓋火船直衝曹營', tone: 'gold' });
  },
  triggers: [
    {
      when: (w) => w.structs.filter((s) => s.kind === 'camp' && s.burnt).length >= 3,
      run: (w) => {
        w.events.push({ k: 'msg', text: '連營大火！北軍自相踐踏', tone: 'gold' });
        for (const r of w.regs) if (r.team === 1 && !r.gone) r.morale -= 10;
      },
    },
  ],
  advisor: { name: '諸葛亮', portrait: 'hero/hero_zhugeliang.jpg' },
  hints: [
    { at: -1, text: '都督，黃蓋的火船已點燃曹營！<b>東風由東往西</b>，火勢會沿著營寨往西蔓延。' },
    { at: 4, text: '選弓兵，按指令列的「<b>🔥 火矢</b>」，再右鍵點<b>曹軍營寨</b>——火矢落地就會點燃營寨。' },
    { at: 25, text: '周瑜的武將技「<b>火燒連營</b>」可以直接在一片區域放火，記得用在營寨密集處。' },
    { when: (w) => w.structs.filter((s) => s.kind === 'camp' && s.burnt).length >= 3, text: '曹軍營寨燒了一半！北軍已經<b>大亂</b>，全軍壓上！' },
  ],
};
