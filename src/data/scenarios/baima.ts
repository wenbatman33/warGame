// 白馬之圍（教學關，200 年）：關羽斬顏良——一步步學會選取、移動、拉戰線、射擊、武將技、燒糧
import type { Scenario } from '../scenario';

const flag = (k: string) => (w: { flags: Record<string, number | boolean> }) => !!w.flags[k];

export const BAIMA: Scenario = {
  id: 'baima',
  title: '白馬之圍',
  subtitle: '教學・關羽斬顏良',
  year: '建安五年（200 年）',
  image: 'battle/battle_baima.jpg',
  intro: [
    '袁紹遣大將顏良圍攻白馬，曹操親率輕騎救援。',
    '此時關羽暫歸曹營，望見顏良麾蓋，策馬直入萬眾之中，刺顏良於馬下。',
    '這是一場小規模的教學戰：跟著軍師的提示，學會指揮軍團的基本操作。',
  ],
  goals: ['跟著軍師提示操作', '斬殺或逼退顏良（敵軍主帥）＝袁軍全軍敗退', '燒掉袁軍糧倉，或站上袁軍糧道切斷補給'],
  tip: '士兵不會潰逃，兩軍正面對打是等值消耗。要贏就靠：兵種相剋（槍剋騎、騎剋弓、弓剋槍）、側擊背襲、斷敵糧道。戰鬥中隨時可以按空白鍵暫停。',
  time: 'day',
  camera: { x: 0, z: 70, dist: 170 },
  map: {
    play: 380,
    seed: 2001,
    hills: [
      { x: -90, z: 10, r: 40, h: 7, plateau: true },
      { x: 110, z: -60, r: 40, h: 6 },
    ],
    roads: [
      {
        pts: [
          [0, 200],
          [0, 60],
          [10, -60],
          [0, -200],
        ],
        w: 6,
      },
    ],
    forests: [
      { x: 130, z: 60, r: 40 },
      { x: -140, z: -110, r: 40 },
    ],
    clearings: [{ x: 0, z: 145, r: 35 }, { x: 0, z: -145, r: 35 }, { x: 90, z: -120, r: 25 }],
  },
  teams: [
    {
      faction: 'wei',
      name: '曹軍',
      commander: 'guanyu',
      commanderLoss: false,
      hq: { x: 0, z: 150, stock: 400, name: '曹營' },
      depots: [{ x: -110, z: 172, stock: 500, name: '曹軍糧車' }],
      deploy: { x: 0, z: 85, w: 260, d: 90 },
      regiments: [
        { type: 'guard', x: 60, z: 95, general: 'guanyu', name: '關羽（暫歸曹營）' },
        { type: 'sword', x: -30, z: 70, name: '刀盾兵' },
        { type: 'spear', x: 20, z: 72, name: '長槍兵' },
        { type: 'archer', x: -5, z: 100, name: '弓兵' },
        { type: 'cav', x: -110, z: 90, name: '輕騎兵' },
      ],
    },
    {
      faction: 'yuan',
      name: '袁軍',
      commander: 'yanliang',
      hq: { x: 0, z: -150, stock: 360, name: '顏良營' },
      depots: [{ x: 90, z: -120, stock: 500, main: true, name: '袁軍糧倉' }],
      ai: { plan: 'defend', aggression: 0.4, raid: false, startDelay: 40, attackAfter: 150 },
      regiments: [
        { type: 'guard', x: 0, z: -95, general: 'yanliang', name: '顏良部', morale: 70 },
        { type: 'sword', x: -40, z: -60, morale: 60 },
        { type: 'spear', x: 30, z: -62, morale: 60 },
        { type: 'archer', x: -5, z: -85, morale: 55 },
        { type: 'sword', x: 90, z: -100, role: 'guard', count: 80, name: '糧倉守軍', morale: 50 },
      ],
    },
  ],
  onStart: (w) => {
    // 史實：關羽刺顏良於馬下
    w.duelFate = (a, b) => ((a === 'guanyu' && b === 'yanliang') || (a === 'yanliang' && b === 'guanyu') ? { winner: 'guanyu', killed: true } : null);
  },
  plan: [
    { text: '部署糧道', how: '開戰前：拖曳地圖上的 <b>🍚</b> 標記，或在下方面板選「官道／前線捷徑／後方小路」決定補給路線。', done: (w) => !!w.flags.did_route || w.started },
    { text: '守住正面', how: '開戰後選<b>刀盾兵、長槍兵</b> → 按「🛡 固守」。正面對打是等值消耗，別急著衝。', done: (w) => w.regs.some((r) => r.team === 0 && r.engagedWith.size > 0) },
    { text: '關羽斬顏良', how: '選<b>關羽</b> → 右鍵點<b>顏良</b>（敵軍主帥）。關羽靠近他就會單挑，主帥一死袁軍全軍敗退。', done: (w) => w.winner === 0 },
  ],
  stars: [
    { text: '擊潰袁軍', check: (w) => w.winner === 0 },
    { text: '關羽斬顏良', check: (w) => w.regs.some((r) => r.general?.id === 'yanliang' && !r.general.alive && !r.general.fled) },
    { text: '燒掉袁軍糧倉', check: (w) => w.teams[1].depotsBurnt > 0 },
  ],
  advisor: { name: '荀攸', portrait: 'hero/hero_xunyou.jpg' },
  hints: [
    { at: -1, text: '主公，先學選取：<b>左鍵點一下我軍的軍團</b>（或下方的卡片、頭上的徽章）。' },
    { when: flag('did_select'), deploy: true, text: '很好！現在<b>右鍵點地面</b>，軍團就會移動過去。' },
    { when: flag('did_move'), deploy: true, text: '進階：選好軍團後<b>右鍵按住拖曳</b>，可以拉出一條戰線（拖曳長度＝陣寬、方向＝朝向）。也可以先 Shift 多選再拉。' },
    { when: flag('did_line'), deploy: true, text: '最重要的一步：<b>部署糧道</b>。地上的流動虛線是我軍糧道（糧車 → 曹營）。在下方面板選「官道／前線捷徑／後方小路」，或直接<b>拖曳地圖上的 🍚 標記</b>自訂路線——靠前線補給延伸、但容易被切斷。' },
    { when: flag('did_route'), deploy: true, text: '佈陣完成就按下方「<b>⚔ 開戰</b>」（或 Enter）。開戰後可以隨時按<b>空白鍵暫停</b>。' },
    { at: 3, text: '選<b>弓兵</b>，<b>右鍵點敵軍</b>就會進入射程放箭。弓兵怕近戰，記得放在步兵後面。' },
    { when: (w) => !!w.flags.did_attack, text: '兩軍正面對打是<b>等值消耗</b>。用<b>刀盾兵</b>頂住正面（正面很硬），再派<b>騎兵</b>繞到側面或背後——側面傷害 ×1.4、背後 ×2！' },
    { when: (w) => w.regs.some((r) => r.team === 0 && r.engagedWith.size > 0), text: '<b>兵種相剋</b>：長槍剋騎兵、騎兵剋弓兵、弓兵剋長槍、刀盾近身剋長槍。用對的兵種打對的敵人，消耗就會一面倒。' },
    { when: (w) => w.t - ((w.flags.startT as number) ?? 0) > 40, text: '顏良是<b>敵軍主帥</b>：主帥<b>撤退或陣亡＝全軍敗退</b>。讓<b>關羽</b>靠近顏良就會單挑——史實上，關羽刺顏良於馬下！' },
    { when: flag('did_ability'), text: '右下角是<b>計策卡</b>：花軍令點施放。試試「<b>擂鼓助威</b>」——點卡片再點地圖上的我軍。' },
    { when: (w) => w.t - ((w.flags.startT as number) ?? 0) > 90, text: '地上的流動虛線是<b>袁軍糧道</b>（糧倉 → 顏良營）。派騎兵<b>燒掉糧倉</b>，或<b>站上糧道</b>（附近沒有敵軍）8 秒切斷它——袁軍存糧耗盡就會斷糧：士氣低落、受到傷害 +35%。' },
  ],
};
