// 官渡之戰・火燒烏巢（200 年）——招牌劇本：頂住數倍袁軍，派奇兵穿林燒烏巢
import type { Scenario } from '../scenario';

export const GUANDU: Scenario = {
  id: 'guandu',
  title: '官渡之戰',
  subtitle: '火燒烏巢',
  year: '建安五年（200 年）',
  image: 'battle/battle_guandu',
  intro: [
    '袁紹擁兵十萬南下，曹操僅以數萬之眾據守官渡。兩軍相持數月，曹軍糧草將盡。',
    '袁紹謀士許攸來投，獻上奇策：袁軍萬車糧草囤於烏巢，守將淳于瓊嗜酒輕敵。',
    '主公，請頂住袁軍正面攻勢，同時派騎兵穿過東側密林，火燒烏巢！',
  ],
  goals: ['逼退或斬殺袁紹（敵軍主帥），或殲滅袁軍九成', '火燒烏巢：袁軍糧道斷絕 → 存糧耗盡後斷糧，受到傷害 +35%', '守住我軍糧道（許都糧道 → 官渡大營），別讓烏桓突騎切斷'],
  tip: '袁軍兵多，正面硬拚只會等值消耗、越打越虧。守住河岸「半渡而擊」（涉水或剛上岸的敵軍受傷 +60%、攻擊 −40%），派騎兵與許褚走東邊淺灘、穿過密林直撲烏巢。長槍兵擋騎兵、弓兵射長槍、騎兵打弓兵。',
  time: 'dusk',
  camera: { x: 0, z: 150, dist: 230, yaw: 0 },
  map: {
    play: 560,
    seed: 200,
    hills: [
      { x: -120, z: 70, r: 55, h: 9, plateau: true },
      { x: 110, z: -110, r: 60, h: 8, plateau: true },
      { x: 250, z: -110, r: 50, h: 12 },
      { x: -230, z: -60, r: 70, h: 14 },
      { x: 60, z: 260, r: 60, h: 6 },
    ],
    rivers: [
      {
        pts: [
          [-330, -10],
          [-180, -30],
          [-60, -5],
          [60, -30],
          [170, -10],
          [330, -40],
        ],
        w: 24,
        fords: [
          { t: 0.2, w: 26 },
          { t: 0.47, w: 36 },
          { t: 0.9, w: 26 },
        ],
      },
    ],
    roads: [
      {
        pts: [
          [-40, -280],
          [-30, -150],
          [-10, -60],
          [5, -20],
          [10, 80],
          [0, 230],
          [0, 300],
        ],
        w: 7,
      },
      {
        pts: [
          [215, -205],
          [120, -215],
          [20, -235],
          [-40, -240],
        ],
        w: 6,
      },
      {
        pts: [
          [-170, 245],
          [-80, 230],
          [0, 215],
        ],
        w: 6,
      },
    ],
    forests: [
      // 東側密林：通往烏巢的隱蔽小徑
      { x: 245, z: 45, r: 62 },
      { x: 240, z: -70, r: 62 },
      { x: 175, z: -135, r: 34, density: 0.85 },
      { x: -250, z: 140, r: 60 },
      { x: -60, z: -150, r: 30, density: 0.6 },
      { x: 120, z: 150, r: 40, density: 0.7 },
    ],
    clearings: [
      { x: 0, z: 210, r: 45 },
      { x: -40, z: -235, r: 45 },
      { x: 215, z: -205, r: 40 },
      { x: -165, z: 245, r: 30 },
      { x: -200, z: -250, r: 30 },
    ],
  },
  teams: [
    {
      faction: 'wei',
      name: '曹軍',
      commander: 'caocao',
      hq: { x: 0, z: 215, stock: 420, name: '官渡大營' },
      depots: [{ x: -165, z: 248, stock: 900, name: '許都糧道' }],
      deploy: { x: 0, z: 125, w: 440, d: 150 },
      regiments: [
        { type: 'guard', x: 0, z: 185, general: 'caocao', role: 'reserve' },
        { type: 'guard', x: 140, z: 170, general: 'xuchu', name: '許褚虎衛' },
        { type: 'sword', x: -70, z: 120, name: '青州兵' },
        { type: 'sword', x: 40, z: 120, name: '中軍刀盾' },
        { type: 'spear', x: -15, z: 122, name: '長槍營' },
        { type: 'spear', x: 95, z: 124, name: '右翼長槍' },
        { type: 'archer', x: -40, z: 150, name: '弓手營' },
        { type: 'archer', x: 60, z: 150, name: '強弓營' },
        { type: 'archer', x: -110, z: 80, name: '弩營' },
        { type: 'cav', x: 170, z: 140, name: '輕騎甲' },
        { type: 'cav', x: 200, z: 150, name: '輕騎乙' },
        { type: 'cav', x: -170, z: 140, name: '虎豹騎' },
      ],
    },
    {
      faction: 'yuan',
      name: '袁軍',
      commander: 'yuanshao',
      hq: { x: -40, z: -238, stock: 420, name: '袁紹大營' },
      depots: [
        { x: 218, z: -208, stock: 1600, main: true, name: '烏巢' },
        { x: -205, z: -255, stock: 500, name: '陽武糧屯' },
      ],
      consume: 1.6,
      // 兩軍相持：袁紹先試探，約 1 分鐘後才全面渡河
      ai: { plan: 'attack', aggression: 0.6, raid: true, startDelay: 60 },
      regiments: [
        { type: 'guard', x: -40, z: -200, general: 'yuanshao', role: 'reserve' },
        { type: 'guard', x: 80, z: -130, general: 'zhanghe', name: '張郃部' },
        { type: 'guard', x: -150, z: -120, general: 'gaolan', name: '高覽部' },
        { type: 'sword', x: -120, z: -80, name: '冀州刀盾' },
        { type: 'sword', x: -40, z: -85 },
        { type: 'sword', x: 40, z: -85 },
        { type: 'spear', x: 0, z: -110, name: '大戟士' },
        { type: 'spear', x: -80, z: -110, name: '大戟士' },
        { type: 'spear', x: -160, z: -95 },
        { type: 'archer', x: -60, z: -135 },
        { type: 'archer', x: 30, z: -135 },
        { type: 'archer', x: 60, z: -150, name: '先登弩士' },
        { type: 'cav', x: -220, z: -150, role: 'raider', name: '烏桓突騎' },
        { type: 'cav', x: 110, z: -150 },
        { type: 'cav', x: -200, z: -110 },
        // 烏巢守軍：淳于瓊嗜酒輕敵，士氣低落
        { type: 'guard', x: 200, z: -185, general: 'chunyuqiong', name: '淳于瓊部', role: 'guard', morale: 55 },
        { type: 'sword', x: 240, z: -190, count: 60, role: 'guard', name: '烏巢守軍', morale: 50 },
      ],
    },
  ],
  plan: [
    { text: '部署糧道', how: '開戰前：拖曳地圖上的 <b>🍚</b> 標記，或在下方面板選「官道／前線捷徑／後方小路」決定補給路線。', done: (w) => !!w.flags.did_route || w.started },
    { text: '守住中央淺灘', how: '選步兵 → <b>右鍵拖曳</b>在河岸南側拉戰線 → 按「🛡 固守」。袁軍涉水、剛上岸時受傷 +60%、攻擊 −40%——<b>就在河邊打</b>，別過河。', done: (w) => (w.started ? w.t - ((w.flags.startT as number) ?? 0) : 0) > 75 },
    { text: '奇兵燒烏巢', how: '選<b>騎兵與許褚</b> → 右鍵點東北的<b>烏巢</b>（走東邊淺灘、穿過森林）。燒掉後袁軍糧道斷絕。', done: (w) => w.structs.some((s) => s.name === '烏巢' && s.burnt) },
    { text: '袁軍斷糧後總攻', how: '等袁軍變成「斷糧」（受傷 +35%）→ 選全軍按「⚔ 推進」，逼退袁紹就贏。', done: (w) => w.winner === 0 },
  ],
  stars: [
    { text: '擊潰袁軍', check: (w) => w.winner === 0 },
    { text: '開戰 6 分鐘內焚燒烏巢', check: (w) => typeof w.flags.wuchaoT === 'number' && (w.flags.wuchaoT as number) <= 360 },
    { text: '我軍糧倉未失、傷亡少於五成', check: (w) => w.winner === 0 && w.teams[0].depotsBurnt === 0 && w.teams[0].dead + w.teams[0].fled < w.teams[0].initialStrength * 0.5 },
  ],
  triggers: [
    {
      // 烏巢焚毀 → 張郃、高覽倒戈
      when: (w) => w.structs.some((s) => s.name === '烏巢' && s.burnt),
      run: (w) => {
        w.flags.wuchaoT = w.t - (w.flags.startT as number);
        w.events.push({ k: 'msg', text: '烏巢糧草盡焚！袁軍軍心大亂', tone: 'gold' });
        const defectors = w.regs.filter((r) => r.team === 1 && !r.gone && (r.general?.id === 'zhanghe' || r.general?.id === 'gaolan'));
        if (defectors.length) {
          setTimeout(() => w.events.push({ k: 'msg', text: '張郃、高覽率部歸降曹公！', tone: 'good' }), 0);
          for (const r of defectors) w.defect(r.id);
        }
      },
    },
  ],
  advisor: { name: '荀攸', portrait: 'hero/hero_xunyou.jpg' },
  hints: [
    { at: -1, text: '主公，<b>右鍵按住拖曳</b>可以拉出戰線。把步兵沿<b>河岸南側</b>排開——袁軍渡河時「半渡而擊」，受傷 +60%！按右上「🗺 地形」看淺灘在哪。' },
    { at: 6, text: '東邊淺灘外有一片<b>密林</b>，可以掩護騎兵。派<b>騎兵與許褚</b>往東、再往北，直撲<b>烏巢</b>！（右鍵點糧倉＝縱火）' },
    { when: (w) => w.regs.some((r) => r.team === 1 && !r.gone && r.terrain.wet), text: '袁軍正在<b>涉水</b>！趁他們半渡，弓弩齊射、步兵壓上！' },
    { when: (w) => w.structs.some((s) => s.name === '烏巢' && s.fire > 0 && !s.burnt), text: '烏巢起火了！<b>守住火場</b>，別讓袁軍回來救火。' },
    { when: (w) => w.regs.some((r) => r.team === 0 && !r.gone && r.morale < 40), text: '有部隊士氣低落（受到傷害變重）。讓<b>曹操</b>靠近鼓舞、或用計策「<b>擂鼓助威</b>」穩住軍心。' },
    { when: (w) => w.structs.some((s) => s.team === 0 && s.attackedT > 0 && w.t - s.attackedT < 3), text: '袁軍在<b>劫我糧道</b>！快派兵回防，糧倉一燒我軍也會軍心大亂。' },
    { when: (w) => w.teams[1].panicUntil > w.t, text: '袁軍<b>軍心大亂</b>！糧道已斷，存糧正在倒數——守住戰線，等他們斷糧再全線壓上！' },
    { when: (w) => w.structs.some((s) => s.team === 0 && s.route.length > 1 && s.cutT > 0), text: '敵軍騎兵站上了<b>我軍糧道</b>！8 秒內不趕走就會被切斷——派騎兵或長槍兵過去。' },
    { when: (w) => w.teams[1].supply === 'starving', text: '袁軍<b>斷糧</b>了！他們攻擊 −20%、受到傷害 +35%。全線壓上，直取袁紹！' },
  ],
  labels: [
    { x: 218, z: -208, text: '烏巢' },
    { x: 0, z: 215, text: '官渡' },
  ],
};
