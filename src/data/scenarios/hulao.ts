// 虎牢關之戰（190 年）：關東聯軍討董卓——三英戰呂布
import type { Scenario } from '../scenario';

const SANYING = ['liubei', 'guanyu', 'zhangfei'];

export const HULAO: Scenario = {
  id: 'hulao',
  title: '虎牢關之戰',
  subtitle: '三英戰呂布',
  year: '初平元年（190 年）',
  image: 'battle/battle_hulao.jpg',
  intro: [
    '董卓挾天子、亂朝綱，關東諸侯起兵討伐，兵臨虎牢關下。',
    '關上呂布騎赤兔、持方天畫戟，連斬聯軍數將，「人中呂布，馬中赤兔」，無人能敵。',
    '玄德公，與雲長、翼德三人合擊呂布，再一舉攻破虎牢關！',
  ],
  goals: ['擊潰董卓軍，或攻破虎牢關（我軍在關前停留且無守軍）', '三英戰呂布：讓劉備、關羽、張飛中的兩人同時靠近呂布', '小心呂布：武力 100，單挑幾乎無敵'],
  tip: '谷地狹長、兩側是山：別把軍團塞在谷底被西涼騎兵衝散。讓劉關張一起行動，合圍呂布。',
  time: 'dusk',
  camera: { x: 0, z: 150, dist: 230 },
  map: {
    play: 520,
    seed: 1900,
    ridges: [
      {
        pts: [
          [-140, -270],
          [-120, -90],
          [-150, 90],
          [-160, 270],
        ],
        w: 55,
        h: 24,
      },
      {
        pts: [
          [140, -270],
          [120, -90],
          [150, 90],
          [165, 270],
        ],
        w: 55,
        h: 24,
      },
    ],
    hills: [{ x: 0, z: -40, r: 40, h: 4, plateau: true }],
    roads: [
      {
        pts: [
          [0, 280],
          [0, 100],
          [10, -60],
          [0, -230],
        ],
        w: 8,
      },
    ],
    forests: [
      { x: -60, z: 120, r: 35, density: 0.7 },
      { x: 70, z: 40, r: 30, density: 0.7 },
    ],
    clearings: [{ x: 0, z: -215, r: 40 }, { x: 0, z: 222, r: 40 }, { x: -50, z: -245, r: 25 }],
  },
  teams: [
    {
      faction: 'han',
      name: '聯軍',
      commander: 'liubei',
      hq: { x: 0, z: 222, stock: 400, name: '聯軍大營' },
      depots: [{ x: 60, z: 245, stock: 700, name: '聯軍糧倉' }],
      deploy: { x: 0, z: 145, w: 220, d: 120 },
      regiments: [
        { type: 'guard', x: -40, z: 120, general: 'liubei' },
        { type: 'guard', x: 0, z: 115, general: 'guanyu' },
        { type: 'guard', x: 40, z: 120, general: 'zhangfei' },
        { type: 'guard', x: 0, z: 185, general: 'caocao', name: '曹操（聯軍）', role: 'reserve' },
        { type: 'sword', x: -45, z: 95 },
        { type: 'sword', x: 45, z: 95 },
        { type: 'spear', x: 0, z: 95 },
        { type: 'spear', x: -80, z: 110 },
        { type: 'archer', x: -30, z: 150 },
        { type: 'archer', x: 30, z: 150 },
        { type: 'heavycav', x: 80, z: 140, name: '聯軍鐵騎' },
      ],
    },
    {
      faction: 'dong',
      name: '董卓軍',
      commander: 'dongzhuo',
      hq: { x: 0, z: -222, stock: 420, name: '虎牢關' },
      depots: [{ x: -50, z: -248, stock: 800, name: '關內糧倉' }],
      ai: { plan: 'attack', aggression: 0.8, raid: false, startDelay: 20 },
      regiments: [
        { type: 'guard', x: 0, z: -190, general: 'dongzhuo', role: 'reserve' },
        { type: 'guard', x: 0, z: -70, general: 'lvbu', name: '呂布并州鐵騎', morale: 95 },
        { type: 'guard', x: -60, z: -90, general: 'huaxiong' },
        { type: 'guard', x: 60, z: -95, general: 'zhangliao', name: '張遼（呂布麾下）' },
        { type: 'heavycav', x: -40, z: -110, name: '西涼鐵騎' },
        { type: 'heavycav', x: 40, z: -110, name: '西涼鐵騎' },
        { type: 'horsearcher', x: -80, z: -120, name: '西涼騎射' },
        { type: 'horsearcher', x: 80, z: -120, name: '西涼騎射' },
        { type: 'halberd', x: 0, z: -130 },
        { type: 'sword', x: -40, z: -150 },
        { type: 'sword', x: 40, z: -150 },
        { type: 'archer', x: 0, z: -170 },
        { type: 'crossbow', x: -30, z: -200, role: 'guard', name: '關上弩手' },
      ],
    },
  ],
  stars: [
    { text: '擊潰董卓軍或攻破虎牢關', check: (w) => w.winner === 0 },
    { text: '三英戰呂布', check: (w) => !!w.flags.sanying },
    { text: '傷亡少於四成五', check: (w) => w.winner === 0 && w.teams[0].dead + w.teams[0].fled < w.teams[0].initialStrength * 0.45 },
  ],
  triggers: [
    {
      // 劉關張任兩人同時靠近呂布 → 三英戰呂布：呂布重傷敗走
      when: (w) => {
        const lv = w.regs.find((r) => r.general?.id === 'lvbu' && r.general.alive);
        if (!lv) return false;
        const s = w.s;
        const li = lv.general!.soldier;
        const near = w.regs.filter((r) => r.general?.alive && SANYING.includes(r.general.id) && Math.hypot(s.x[r.general.soldier] - s.x[li], s.z[r.general.soldier] - s.z[li]) < 18);
        return near.length >= 2;
      },
      run: (w) => {
        const lv = w.regs.find((r) => r.general?.id === 'lvbu')!;
        w.flags.sanying = true;
        w.s.hp[lv.general!.soldier] *= 0.4;
        lv.morale -= 35;
        w.commandRetreat([lv.id]);
        for (const r of w.regs) if (!r.gone) r.morale = r.team === 0 ? Math.min(100, r.morale + 15) : r.morale - 10;
        w.events.push({ k: 'msg', text: '三英戰呂布！呂布力戰不支，撥馬回關', tone: 'gold' });
      },
    },
  ],
  advisor: { name: '曹操', portrait: 'hero/hero_caocao.jpg' },
  hints: [
    { at: -1, text: '玄德，呂布武力天下無雙，<b>一對一單挑</b>勝算渺茫。讓<b>劉備、關羽、張飛</b>一起行動（Shift 多選三人）。' },
    { at: 15, text: '西涼鐵騎衝鋒很兇：<b>長槍兵堅守</b>擺拒馬，弓兵躲在後面。' },
    { when: (w) => w.regs.some((r) => r.general?.id === 'lvbu' && r.engagedWith.size > 0), text: '呂布殺入陣中！快讓<b>劉關張中的兩人靠近他</b>——三英合擊！' },
  ],
};
