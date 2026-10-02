// 街亭之戰（228 年）：馬謖捨水上山，張郃圍山斷水
import type { Scenario } from '../scenario';

export const JIETING: Scenario = {
  id: 'jieting',
  title: '街亭之戰',
  subtitle: '圍山斷水',
  year: '建興六年（228 年）',
  image: 'battle/battle_jieting.jpg',
  intro: [
    '諸葛亮北伐，命馬謖守街亭要道。馬謖違背節度，捨水上山，自以為居高臨下。',
    '王平屢諫不從，只能率千人另紮營於山下。',
    '張郃將軍，蜀軍據山而守，強攻上坡吃虧——先奪取山腳的水源，斷其汲道，待蜀軍乾渴大亂，再一舉擊破！',
  ],
  goals: ['擊潰蜀軍', '佔領山腳的「水源」（周圍沒有蜀軍、我軍駐守 20 秒）', '蜀軍斷水後會下山拚死突圍'],
  tip: '仰攻上坡：近戰最多 −25%、蜀軍弓兵射程更遠。先斷水：蜀軍糧況立刻轉為吃緊、很快斷糧。王平部在西邊路口，小心他偷襲側翼。',
  time: 'day',
  camera: { x: 0, z: 170, dist: 250 },
  map: {
    play: 560,
    seed: 228,
    hills: [
      { x: 0, z: -70, r: 105, h: 20, plateau: true },
      { x: -40, z: -90, r: 50, h: 6 },
      { x: 230, z: 170, r: 50, h: 7 },
    ],
    rivers: [
      {
        pts: [
          [340, -30],
          [200, 30],
          [110, 75],
          [20, 115],
          [-120, 130],
          [-340, 160],
        ],
        w: 18,
        depth: 1.6,
        fords: [
          { t: 0.25, w: 30 },
          { t: 0.5, w: 30 },
          { t: 0.75, w: 30 },
        ],
      },
    ],
    roads: [
      {
        pts: [
          [-300, -40],
          [-180, 40],
          [-120, 90],
          [-60, 150],
          [0, 280],
        ],
        w: 7,
      },
      {
        pts: [
          [-180, 40],
          [-100, -10],
          [-40, -40],
          [0, -60],
        ],
        w: 5,
      },
    ],
    forests: [
      { x: -230, z: -150, r: 60 },
      { x: 220, z: -150, r: 60 },
      { x: 180, z: 220, r: 40, density: 0.7 },
      { x: -240, z: 200, r: 45, density: 0.7 },
    ],
    clearings: [
      { x: 0, z: -75, r: 70 },
      { x: 95, z: 62, r: 20 },
      { x: -175, z: 45, r: 25 },
      { x: 0, z: 200, r: 50 },
    ],
  },
  teams: [
    {
      faction: 'wei',
      name: '魏軍',
      commander: 'zhanghe',
      hq: { x: 0, z: 225, stock: 400, name: '魏軍大營' },
      depots: [{ x: 170, z: 245, stock: 700, name: '隴右糧道' }],
      deploy: { x: 0, z: 165, w: 460, d: 110 },
      regiments: [
        { type: 'guard', x: 0, z: 190, general: 'zhanghe' },
        { type: 'guard', x: -150, z: 170, general: 'guohuai' },
        { type: 'sword', x: -90, z: 150 },
        { type: 'sword', x: 10, z: 145 },
        { type: 'spear', x: 100, z: 150 },
        { type: 'spear', x: -40, z: 150 },
        { type: 'archer', x: -50, z: 180 },
        { type: 'archer', x: 60, z: 180 },
        { type: 'crossbow', x: 150, z: 175 },
        { type: 'lightcav', x: 200, z: 160 },
        { type: 'heavycav', x: -200, z: 165 },
        { type: 'halberd', x: 50, z: 150, name: '雍涼精兵' },
      ],
    },
    {
      faction: 'shu',
      name: '蜀軍',
      commander: 'masu',
      hq: { x: 0, z: -95, stock: 260, name: '南山大營' },
      depots: [{ x: 95, z: 62, stock: 100, kind: 'water', name: '水源' }],
      consume: 1.5,
      ai: { plan: 'hold', aggression: 0.4, raid: false, startDelay: 0 },
      regiments: [
        { type: 'guard', x: 0, z: -60, general: 'masu', role: 'hold' },
        { type: 'sword', x: -45, z: -20, role: 'hold' },
        { type: 'sword', x: 45, z: -25, role: 'hold' },
        { type: 'spear', x: 0, z: -15, role: 'hold' },
        { type: 'spear', x: -70, z: -60, role: 'hold' },
        { type: 'archer', x: -20, z: -45, role: 'hold' },
        { type: 'archer', x: 30, z: -50, role: 'hold' },
        { type: 'crossbow', x: 70, z: -60, role: 'hold', name: '諸葛連弩' },
        { type: 'sword', x: 0, z: -110, role: 'hold' },
        { type: 'spear', x: 85, z: 45, role: 'guard', name: '汲水隊', count: 90 },
        { type: 'guard', x: -175, z: 45, general: 'wangping', role: 'hold', name: '王平部' },
        { type: 'sword', x: -200, z: 55, role: 'hold', name: '王平部' },
      ],
    },
  ],
  stars: [
    { text: '擊潰蜀軍', check: (w) => w.winner === 0 },
    { text: '開戰 4 分鐘內奪取水源', check: (w) => typeof w.flags.waterT === 'number' && (w.flags.waterT as number) <= 240 },
    { text: '傷亡少於兩成五', check: (w) => w.winner === 0 && w.teams[0].dead + w.teams[0].fled < w.teams[0].initialStrength * 0.25 },
  ],
  triggers: [
    {
      // 斷水 45 秒後，蜀軍下山突圍
      when: (w) => typeof w.flags.waterT === 'number' && w.t - ((w.flags.startT as number) ?? 0) - (w.flags.waterT as number) > 45,
      run: (w) => {
        const ai = w.sc.teams[1].ai!;
        ai.plan = 'attack';
        for (const r of w.regs) if (r.team === 1 && !r.gone && r.ai.role === 'hold' && !r.general) r.ai.role = 'line';
        w.events.push({ k: 'msg', text: '蜀軍乾渴難耐，下山突圍！', tone: 'gold' });
      },
    },
  ],
  advisor: { name: '郭淮', portrait: 'hero/hero_guohuai.jpg' },
  hints: [
    { at: -1, text: '馬謖據山而守：<b>仰攻上坡吃虧</b>（近戰最多 −25%）。按「🗺 地形」看看山勢。' },
    { at: 5, text: '山腳東南的<b>水源</b>是蜀軍命脈。派兵趕走汲水隊、<b>駐守 20 秒</b>就能斷水！' },
    { when: (w) => typeof w.flags.waterT === 'number', text: '水源到手！蜀軍<b>斷水</b>，很快會撐不住。守住水源，等他們下山。' },
    { when: (w) => w.regs.some((r) => r.team === 1 && r.general?.id === 'wangping' && r.state === 'moving'), text: '<b>王平</b>出動了！注意西側路口。' },
  ],
};
