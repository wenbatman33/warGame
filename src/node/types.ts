// 地點地圖玩法（手指滑動指揮）的資料定義
import type { GeneralId } from '../data/generals';

/** 地點地形：決定能用什麼計策 */
export type NodeTerrain = 'plain' | 'forest' | 'grass' | 'hill' | 'ford' | 'pass' | 'hq' | 'depot';

export interface MapNode {
  id: string;
  name: string;
  x: number;
  z: number;
  terrain: NodeTerrain;
  /** 本陣、糧倉的歸屬 */
  team?: number;
}

/** 敵將性格：輕敵（必定上鉤、見敵就打）、普通、謹慎（不輕易上鉤、不冒進） */
export type Trait = 'rash' | 'normal' | 'cautious';

export type NodeUnitType = 'sword' | 'spear' | 'archer' | 'cav';

export interface NodeUnitSpec {
  id: string;
  team: number;
  name: string;
  general?: GeneralId;
  type: NodeUnitType;
  troops: number;
  node: string;
  /** 主帥：撤退或潰散＝全軍敗退 */
  commander?: boolean;
  trait?: Trait;
  morale?: number;
}

/** 計策卡：火攻（草木地點）、擂鼓（我軍士氣）、偵察（揭露伏兵） */
export type CardId = 'fire' | 'drums' | 'scout';

export interface NodeScenario {
  nodes: MapNode[];
  edges: [string, string][];
  units: NodeUnitSpec[];
  cards: CardId[];
  /** 開場軍令點 */
  startCommand?: number;
  /** 敵軍開場紮營秒數（期間不主動推進，被挑釁或被打才反應）；給玩家佈陣的時間 */
  enemyHold?: number;
}

export const TERRAIN_INFO: Record<NodeTerrain, { icon: string; name: string; desc: string }> = {
  plain: { icon: '🟫', name: '平地', desc: '沒有特別效果' },
  forest: { icon: '🌲', name: '森林', desc: '停在裡面會埋伏（敵軍看不見）；防守 +25%；可被火攻' },
  grass: { icon: '🌾', name: '蘆葦', desc: '可被火攻' },
  hill: { icon: '⛰', name: '高地', desc: '防守 +50%' },
  ford: { icon: '🌊', name: '渡口', desc: '在渡口的部隊戰力 −50%（半渡而擊）' },
  pass: { icon: '🚪', name: '隘口', desc: '防守 +50%' },
  hq: { icon: '🏯', name: '本陣', desc: '主帥所在；防守 +50%；被敵軍佔領就輸' },
  depot: { icon: '🍚', name: '糧倉', desc: '補給來源；部隊要能沿道路連回糧倉才有糧' },
};

export const CARD_INFO: Record<CardId, { icon: string; name: string; cost: number; desc: string }> = {
  fire: { icon: '🔥', name: '火攻', cost: 2, desc: '拖到森林或蘆葦地點：大火燒 20 秒，裡面的部隊持續損兵、士氣大跌' },
  drums: { icon: '🥁', name: '擂鼓', cost: 1, desc: '拖到我軍所在地點：士氣 +25、攻擊 +15%，15 秒' },
  scout: { icon: '👁', name: '偵察', cost: 1, desc: '拖到任一地點：揭露附近的伏兵 30 秒' },
};
