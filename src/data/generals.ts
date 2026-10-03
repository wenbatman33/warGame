// 武將（docs/04 §1）
import type { ModelKey } from '../models/soldier';
import type { FactionId } from './factions';

export type GeneralId =
  | 'caocao'
  | 'xuchu'
  | 'zhangliao'
  | 'zhanghe'
  | 'xiahoudun'
  | 'caoren'
  | 'yuanshao'
  | 'chunyuqiong'
  | 'gaolan'
  | 'liubei'
  | 'guanyu'
  | 'zhangfei'
  | 'zhaoyun'
  | 'masu'
  | 'wangping'
  | 'sunquan'
  | 'ganning'
  | 'lingtong'
  | 'luxun'
  | 'zhouyu'
  | 'huanggai'
  | 'lidian'
  | 'yuejin'
  | 'lumeng'
  | 'zhuran'
  | 'xusheng'
  | 'fengxi'
  | 'shamoke'
  | 'guohuai'
  | 'xunyou'
  | 'yanliang'
  | 'lvbu'
  | 'dongzhuo'
  | 'huaxiong'
  | 'huangzhong'
  | 'xiahouyuan'
  | 'fazheng';

export type AbilityId =
  | 'rally' // 號令：範圍士氣大增
  | 'berserk' // 親衛攻擊大增、防禦下降
  | 'terror' // 範圍敵軍士氣重挫＋自身加速
  | 'peerless' // 天下無雙：範圍士氣重挫＋攻擊大增
  | 'swift' // 移動加速、不受側擊
  | 'steady' // 範圍內士氣不降
  | 'cleave' // 前方扇形重擊
  | 'roar' // 範圍敵軍士氣重挫＋定身
  | 'unstoppable' // 不受士氣影響＋加速
  | 'fortify' // 防禦大增
  | 'raid' // 縱火加速＋移動加速
  | 'fury' // 攻擊加成
  | 'firestorm'; // 指定地點火攻

export interface AbilityDef {
  id: AbilityId;
  name: string;
  cd: number;
  desc: string;
  /** 是否要選目標地點 */
  targeted?: boolean;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  rally: { id: 'rally', name: '號令全軍', cd: 90, desc: '120 m 內友軍士氣 +30（士氣高＝攻擊高、受傷少）' },
  berserk: { id: 'berserk', name: '虎痴裸衣', cd: 60, desc: '20 秒內親衛攻擊 ×1.6、防禦 ×0.7' },
  terror: { id: 'terror', name: '威震逍遙', cd: 75, desc: '35 m 內敵軍士氣 −35；親衛速度 +30%，15 秒' },
  peerless: { id: 'peerless', name: '天下無雙', cd: 70, desc: '30 m 內敵軍士氣 −25；親衛攻擊 ×1.5、速度 +15%，15 秒' },
  swift: { id: 'swift', name: '巧變', cd: 60, desc: '20 秒內移動 +40%、不受側擊懲罰' },
  steady: { id: 'steady', name: '剛烈', cd: 70, desc: '25 秒內親衛與 40 m 內友軍士氣不下降' },
  cleave: { id: 'cleave', name: '青龍偃月', cd: 60, desc: '前方 20 m 扇形重擊，擊倒並士氣 −25' },
  roar: { id: 'roar', name: '長坂怒吼', cd: 75, desc: '45 m 內敵軍士氣 −30、定身 3 秒' },
  unstoppable: { id: 'unstoppable', name: '七進七出', cd: 80, desc: '20 秒內親衛不受士氣影響、速度 +40%' },
  fortify: { id: 'fortify', name: '堅守', cd: 60, desc: '25 秒內 40 m 內友軍防禦 +40%' },
  raid: { id: 'raid', name: '百騎劫營', cd: 70, desc: '20 秒內親衛縱火速度 ×3、速度 +40%' },
  fury: { id: 'fury', name: '奮戰', cd: 60, desc: '20 秒內親衛攻擊 +40%' },
  firestorm: { id: 'firestorm', name: '火燒連營', cd: 90, desc: '指定地點起火，火勢沿森林與營寨蔓延', targeted: true },
};

export interface GeneralDef {
  id: GeneralId;
  name: string;
  faction: FactionId;
  /** 武／統／智 */
  war: number;
  lead: number;
  int: number;
  model: ModelKey;
  ability: AbilityId | null;
  title: string;
}

export const GENERALS: Record<GeneralId, GeneralDef> = {
  caocao: { id: 'caocao', name: '曹操', faction: 'wei', war: 72, lead: 98, int: 92, model: 'gen_sword', ability: 'rally', title: '魏武帝' },
  xuchu: { id: 'xuchu', name: '許褚', faction: 'wei', war: 96, lead: 65, int: 30, model: 'gen_glaive', ability: 'berserk', title: '虎痴' },
  zhangliao: { id: 'zhangliao', name: '張遼', faction: 'wei', war: 92, lead: 93, int: 78, model: 'gen_ji', ability: 'terror', title: '威震逍遙津' },
  zhanghe: { id: 'zhanghe', name: '張郃', faction: 'wei', war: 89, lead: 85, int: 70, model: 'gen_spear', ability: 'swift', title: '巧變' },
  xiahoudun: { id: 'xiahoudun', name: '夏侯惇', faction: 'wei', war: 90, lead: 85, int: 60, model: 'gen_spear', ability: 'steady', title: '盲夏侯' },
  caoren: { id: 'caoren', name: '曹仁', faction: 'wei', war: 85, lead: 88, int: 65, model: 'gen_sword', ability: 'fortify', title: '天人將軍' },
  yuanshao: { id: 'yuanshao', name: '袁紹', faction: 'yuan', war: 70, lead: 85, int: 70, model: 'gen_sword', ability: 'rally', title: '四世三公' },
  chunyuqiong: { id: 'chunyuqiong', name: '淳于瓊', faction: 'yuan', war: 70, lead: 60, int: 50, model: 'gen_glaive', ability: null, title: '烏巢守將' },
  gaolan: { id: 'gaolan', name: '高覽', faction: 'yuan', war: 82, lead: 70, int: 55, model: 'gen_spear', ability: 'fury', title: '河北名將' },
  liubei: { id: 'liubei', name: '劉備', faction: 'shu', war: 73, lead: 80, int: 75, model: 'gen_sword', ability: 'rally', title: '昭烈帝' },
  guanyu: { id: 'guanyu', name: '關羽', faction: 'shu', war: 97, lead: 92, int: 75, model: 'gen_glaive', ability: 'cleave', title: '武聖' },
  zhangfei: { id: 'zhangfei', name: '張飛', faction: 'shu', war: 98, lead: 60, int: 30, model: 'gen_spear', ability: 'roar', title: '燕人張翼德' },
  zhaoyun: { id: 'zhaoyun', name: '趙雲', faction: 'shu', war: 96, lead: 90, int: 76, model: 'gen_spear', ability: 'unstoppable', title: '常山趙子龍' },
  masu: { id: 'masu', name: '馬謖', faction: 'shu', war: 60, lead: 60, int: 82, model: 'gen_fan', ability: null, title: '參軍' },
  wangping: { id: 'wangping', name: '王平', faction: 'shu', war: 75, lead: 80, int: 60, model: 'gen_sword', ability: 'fortify', title: '無當飛軍' },
  sunquan: { id: 'sunquan', name: '孫權', faction: 'wu', war: 67, lead: 80, int: 80, model: 'gen_sword', ability: 'rally', title: '吳大帝' },
  ganning: { id: 'ganning', name: '甘寧', faction: 'wu', war: 94, lead: 80, int: 60, model: 'gen_glaive', ability: 'raid', title: '錦帆賊' },
  lingtong: { id: 'lingtong', name: '凌統', faction: 'wu', war: 88, lead: 70, int: 50, model: 'gen_ji', ability: 'fury', title: '虎臣' },
  luxun: { id: 'luxun', name: '陸遜', faction: 'wu', war: 69, lead: 96, int: 95, model: 'gen_fan', ability: 'firestorm', title: '大都督' },
  zhouyu: { id: 'zhouyu', name: '周瑜', faction: 'wu', war: 71, lead: 96, int: 96, model: 'gen_sword', ability: 'firestorm', title: '美周郎' },
  huanggai: { id: 'huanggai', name: '黃蓋', faction: 'wu', war: 83, lead: 75, int: 60, model: 'gen_glaive', ability: 'steady', title: '苦肉計' },
  lidian: { id: 'lidian', name: '李典', faction: 'wei', war: 78, lead: 82, int: 72, model: 'gen_spear', ability: 'fortify', title: '破虜將軍' },
  yuejin: { id: 'yuejin', name: '樂進', faction: 'wei', war: 88, lead: 75, int: 50, model: 'gen_sword', ability: 'fury', title: '先登' },
  lumeng: { id: 'lumeng', name: '呂蒙', faction: 'wu', war: 82, lead: 88, int: 85, model: 'gen_sword', ability: 'swift', title: '吳下阿蒙' },
  zhuran: { id: 'zhuran', name: '朱然', faction: 'wu', war: 80, lead: 85, int: 70, model: 'gen_spear', ability: 'fortify', title: '江陵守將' },
  xusheng: { id: 'xusheng', name: '徐盛', faction: 'wu', war: 85, lead: 80, int: 65, model: 'gen_ji', ability: 'fury', title: '疑城之計' },
  fengxi: { id: 'fengxi', name: '馮習', faction: 'shu', war: 75, lead: 70, int: 55, model: 'gen_sword', ability: null, title: '前部督' },
  shamoke: { id: 'shamoke', name: '沙摩柯', faction: 'shu', war: 90, lead: 55, int: 25, model: 'gen_glaive', ability: 'berserk', title: '五溪蠻王' },
  guohuai: { id: 'guohuai', name: '郭淮', faction: 'wei', war: 78, lead: 85, int: 75, model: 'gen_spear', ability: 'steady', title: '雍州刺史' },
  huangzhong: { id: 'huangzhong', name: '黃忠', faction: 'shu', war: 95, lead: 80, int: 60, model: 'gen_glaive', ability: 'fury', title: '老當益壯' },
  xiahouyuan: { id: 'xiahouyuan', name: '夏侯淵', faction: 'wei', war: 90, lead: 85, int: 60, model: 'gen_sword', ability: 'swift', title: '虎步關右' },
  fazheng: { id: 'fazheng', name: '法正', faction: 'shu', war: 30, lead: 75, int: 94, model: 'gen_fan', ability: 'rally', title: '翼侯' },
  lvbu: { id: 'lvbu', name: '呂布', faction: 'dong', war: 100, lead: 70, int: 30, model: 'gen_ji', ability: 'peerless', title: '人中呂布' },
  dongzhuo: { id: 'dongzhuo', name: '董卓', faction: 'dong', war: 70, lead: 75, int: 60, model: 'gen_sword', ability: 'rally', title: '相國' },
  huaxiong: { id: 'huaxiong', name: '華雄', faction: 'dong', war: 88, lead: 60, int: 30, model: 'gen_glaive', ability: 'fury', title: '西涼猛將' },
  yanliang: { id: 'yanliang', name: '顏良', faction: 'yuan', war: 92, lead: 70, int: 40, model: 'gen_glaive', ability: 'fury', title: '河北名將' },
  xunyou: { id: 'xunyou', name: '荀攸', faction: 'wei', war: 30, lead: 70, int: 95, model: 'gen_fan', ability: null, title: '謀主' },
};
