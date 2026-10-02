// 主帥計策（軍令卡，docs/04 §2）
export type StratagemId = 'drums' | 'firearrows' | 'march' | 'scout' | 'retreat' | 'rockfall';

export interface StratagemDef {
  id: StratagemId;
  name: string;
  cost: number;
  /** area＝選地點；own＝選己方軍團 */
  target: 'area' | 'own';
  radius: number;
  icon: string;
  desc: string;
}

export const STRATAGEMS: Record<StratagemId, StratagemDef> = {
  drums: { id: 'drums', name: '擂鼓助威', cost: 3, target: 'area', radius: 40, icon: '🥁', desc: '範圍內友軍士氣 +25、攻擊 +15%，20 秒' },
  firearrows: { id: 'firearrows', name: '火矢齊射', cost: 4, target: 'area', radius: 25, icon: '🔥', desc: '火箭雨覆蓋目標：傷害、士氣 −10，點燃糧倉與營寨' },
  march: { id: 'march', name: '急行軍', cost: 2, target: 'own', radius: 0, icon: '💨', desc: '一個軍團 20 秒內速度 +40%、不耗體力' },
  scout: { id: 'scout', name: '斥候', cost: 1, target: 'area', radius: 120, icon: '👁️', desc: '揭露範圍內敵軍 30 秒（含森林伏兵）' },
  retreat: { id: 'retreat', name: '鳴金收兵', cost: 2, target: 'own', radius: 0, icon: '🔔', desc: '一個軍團立刻有序撤回本陣，15 秒內不會潰逃' },
  rockfall: { id: 'rockfall', name: '落石', cost: 3, target: 'area', radius: 15, icon: '🪨', desc: '只能用在斜坡：滾石重創坡下敵軍並擊倒' },
};

export const STRATAGEM_ORDER: StratagemId[] = ['drums', 'firearrows', 'march', 'scout', 'retreat', 'rockfall'];
