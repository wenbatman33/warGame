// 合肥之戰・逍遙津（215 年）：張遼以八百死士突擊十萬吳軍，直取孫權
import type { Scenario } from '../scenario';

export const HEFEI: Scenario = {
  id: 'hefei',
  title: '合肥之戰',
  subtitle: '威震逍遙津',
  year: '建安二十年（215 年）',
  image: 'battle/battle_hefei.jpg',
  intro: [
    '孫權親率十萬大軍圍攻合肥，城中守軍僅七千。',
    '張遼夜募八百死士，天明披甲持戟，大呼自名，衝入吳陣，直至孫權麾下。',
    '吳軍久攻不下，正沿淝水撤往逍遙津。將軍，趁吳軍分散撤退，以寡擊眾——拿下孫權，吳軍必潰！',
  ],
  goals: ['擊潰吳軍，或擊殺孫權（孫權陣亡＝吳軍全面潰敗）', '孫權在東南方的逍遙津橋頭', '善用張遼「威震逍遙」：35 m 內敵軍士氣 −35'],
  tip: '吳軍人多但分散、士氣不高。別跟大軍正面消耗：用重騎衝鋒＋張遼武將技連鎖打崩，再直撲橋頭的孫權。',
  time: 'day',
  camera: { x: -120, z: -100, dist: 230, yaw: -2.36 },
  map: {
    play: 560,
    seed: 215,
    hills: [
      { x: -40, z: -60, r: 55, h: 7, plateau: true },
      { x: 120, z: -170, r: 60, h: 9 },
      { x: -200, z: 120, r: 60, h: 10 },
    ],
    rivers: [
      {
        pts: [
          [-340, 230],
          [-120, 190],
          [60, 160],
          [180, 110],
          [260, 40],
          [340, -60],
        ],
        w: 30,
        fords: [{ t: 0.2, w: 22 }],
      },
    ],
    roads: [
      {
        pts: [
          [-190, -200],
          [-100, -100],
          [0, -10],
          [100, 60],
          [175, 125],
          [230, 175],
          [300, 260],
        ],
        w: 7,
      },
    ],
    forests: [
      { x: 60, z: -60, r: 40, density: 0.7 },
      { x: -230, z: 0, r: 50 },
      { x: 230, z: -60, r: 50 },
      { x: -80, z: 200, r: 40, density: 0.7 },
    ],
    clearings: [
      { x: -190, z: -205, r: 45 },
      { x: 200, z: 150, r: 30 },
      { x: -40, z: 20, r: 30 },
      { x: 60, z: 70, r: 25 },
    ],
  },
  bridges: [{ x: 196, z: 132, angle: 0.75, length: 52 }],
  teams: [
    {
      faction: 'wei',
      name: '魏軍',
      commander: 'zhangliao',
      hq: { x: -190, z: -205, stock: 400, name: '合肥城' },
      depots: [{ x: -250, z: -250, stock: 600, name: '城中糧倉' }],
      deploy: { x: -150, z: -130, w: 200, d: 120 },
      regiments: [
        { type: 'guard', x: -130, z: -120, general: 'zhangliao', name: '張遼八百死士', morale: 95, facing: 45 },
        { type: 'heavycav', x: -160, z: -105, name: '死士重騎', morale: 92, facing: 45 },
        { type: 'heavycav', x: -100, z: -140, name: '死士重騎', morale: 92, facing: 45 },
        { type: 'guard', x: -200, z: -130, general: 'lidian', facing: 45 },
        { type: 'guard', x: -150, z: -160, general: 'yuejin', facing: 45 },
        { type: 'sword', x: -210, z: -90, name: '合肥守軍', facing: 45 },
        { type: 'spear', x: -230, z: -150, name: '合肥長槍', facing: 45 },
        { type: 'archer', x: -200, z: -170, name: '城頭弓手', facing: 45 },
      ],
    },
    {
      faction: 'wu',
      name: '吳軍',
      commander: 'sunquan',
      commanderLoss: true,
      hq: { x: 230, z: 190, stock: 420, name: '吳軍大營' },
      depots: [
        { x: -60, z: 40, stock: 300, kind: 'camp', name: '吳軍前營' },
        { x: 60, z: 90, stock: 300, kind: 'camp', name: '吳軍中營' },
      ],
      ai: { plan: 'defend', aggression: 0.5, raid: false, startDelay: 15 },
      regiments: [
        { type: 'guard', x: 185, z: 105, general: 'sunquan', role: 'hold', morale: 72, facing: 225 },
        { type: 'guard', x: 150, z: 80, general: 'lingtong', role: 'hold', morale: 80, facing: 225 },
        { type: 'sword', x: 160, z: 120, role: 'hold', name: '孫權親衛', morale: 70, facing: 225 },
        { type: 'guard', x: -20, z: 0, general: 'ganning', morale: 72, facing: 225 },
        { type: 'guard', x: 70, z: 40, general: 'lumeng', morale: 70, facing: 225 },
        { type: 'sword', x: -70, z: -20, morale: 58, facing: 225 },
        { type: 'sword', x: -10, z: -40, morale: 58, facing: 225 },
        { type: 'spear', x: -100, z: 20, morale: 55, facing: 225 },
        { type: 'spear', x: 30, z: 0, morale: 55, facing: 225 },
        { type: 'archer', x: -40, z: 30, morale: 52, facing: 225 },
        { type: 'archer', x: 40, z: 60, morale: 52, facing: 225 },
        { type: 'sword', x: 90, z: 110, morale: 55, facing: 225 },
        { type: 'spear', x: 110, z: 60, morale: 55, facing: 225 },
        { type: 'crossbow', x: 120, z: 130, morale: 55, facing: 225 },
        { type: 'sword', x: 0, z: 100, morale: 55, facing: 225 },
        { type: 'lightcav', x: -60, z: 90, morale: 58, facing: 225 },
        { type: 'archer', x: 200, z: 170, role: 'hold', morale: 55, facing: 225 },
      ],
    },
  ],
  stars: [
    { text: '擊潰吳軍', check: (w) => w.winner === 0 },
    { text: '擊殺孫權', check: (w) => w.regs.some((r) => r.general?.id === 'sunquan' && !r.general.alive && !r.general.fled) },
    { text: '傷亡少於三成', check: (w) => w.winner === 0 && w.teams[0].dead + w.teams[0].fled < w.teams[0].initialStrength * 0.3 },
  ],
  triggers: [
    {
      // 張遼殺入陣中：吳軍震恐
      when: (w) => w.regs.some((r) => r.general?.id === 'zhangliao' && r.engagedWith.size > 0),
      run: (w) => {
        w.events.push({ k: 'msg', text: '「張遼來也！」吳軍聞之膽寒', tone: 'gold' });
        for (const r of w.regs) if (r.team === 1 && !r.gone) r.morale -= 6;
      },
    },
  ],
  advisor: { name: '李典', portrait: 'hero/hero_lidian.jpg' },
  hints: [
    { at: -1, text: '將軍，我軍只有八團，吳軍將近二十團。<b>不要正面硬拚</b>：以重騎衝鋒＋武將技連鎖打崩敵軍士氣。' },
    { at: 5, text: '選張遼，按指令列的「<b>⭐ 威震逍遙</b>」——35 m 內敵軍士氣 −35，衝進敵陣中央再放！' },
    { at: 40, text: '孫權在東南方<b>逍遙津橋頭</b>。孫權一死，吳軍全面潰敗！' },
    { when: (w) => w.regs.some((r) => r.team === 0 && r.stamina < 25 && r.unit.mounted), text: '騎兵<b>體力不足</b>了，先拉開休息一下再衝鋒。' },
  ],
};
