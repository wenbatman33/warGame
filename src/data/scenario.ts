// 劇本格式：地圖、雙方兵力、糧倉、部署區、三星條件、觸發事件
import type { MapSpec } from '../map/mapgen';
import type { AiRole, Formation } from '../sim/regiment';
import type { World } from '../sim/world';
import type { FactionId } from './factions';
import type { GeneralId } from './generals';
import type { UnitTypeId } from './units';

export interface RegimentSpec {
  type: UnitTypeId;
  x: number;
  z: number;
  /** 朝向（度）：0＝朝 +Z（南），180＝朝 -Z（北） */
  facing?: number;
  width?: number;
  count?: number;
  general?: GeneralId;
  name?: string;
  role?: AiRole;
  hidden?: boolean;
  morale?: number;
  formation?: Formation;
  hold?: boolean;
  /** 部署階段可以移動（玩家方預設 true） */
  fixed?: boolean;
}

export interface DepotSpec {
  x: number;
  z: number;
  stock?: number;
  main?: boolean;
  name?: string;
  kind?: 'depot' | 'camp' | 'water';
}

export interface TeamSpec {
  faction: FactionId;
  name: string;
  hq?: { x: number; z: number; stock?: number; name?: string };
  depots: DepotSpec[];
  regiments: RegimentSpec[];
  /** 部署區（矩形，中心＋寬深） */
  deploy?: { x: number; z: number; w: number; d: number };
  /** 主帥（陣亡＝全軍重挫；commanderLoss=true 時直接戰敗） */
  commander?: GeneralId;
  commanderLoss?: boolean;
  /** AI 戰略 */
  ai?: { plan: 'attack' | 'defend' | 'hold'; aggression?: number; raid?: boolean; startDelay?: number; /** 防守方在開戰幾秒後轉為全面進攻 */ attackAfter?: number };
  /** 糧草消耗倍率 */
  consume?: number;
}

export interface StarSpec {
  text: string;
  check: (w: World) => boolean;
}

export interface TriggerSpec {
  /** 只觸發一次 */
  when: (w: World) => boolean;
  run: (w: World) => void;
}

export interface HintSpec {
  /** 開戰後秒數（負數＝部署階段就顯示） */
  at?: number;
  when?: (w: World) => boolean;
  /** when 條件在部署階段也判斷（教學用） */
  deploy?: boolean;
  text: string;
}

export interface Scenario {
  id: string;
  title: string;
  subtitle: string;
  year: string;
  /** 簡報段落 */
  intro: string[];
  /** 目標條列 */
  goals: string[];
  tip?: string;
  image?: string;
  map: MapSpec;
  teams: [TeamSpec, TeamSpec];
  stars: [StarSpec, StarSpec, StarSpec];
  triggers?: TriggerSpec[];
  /** 軍師提示 */
  hints?: HintSpec[];
  /** 開戰瞬間執行（例：赤壁開場前營已起火） */
  onStart?: (w: World) => void;
  /** 風向（單位向量）：營寨火勢順風蔓延較快 */
  wind?: { x: number; z: number };
  /** 軍師（提示頭像） */
  advisor?: { name: string; portrait: string };
  /** 堅守到時間（秒）即勝利 */
  holdTime?: number;
  camera?: { x: number; z: number; dist?: number; yaw?: number };
  /** 天色：day／dusk／night */
  time?: 'day' | 'dusk' | 'night';
  /** 天氣：雨（弓弩與火攻減弱、泥濘）、霧（視野縮短、箭矢散布變大） */
  weather?: 'clear' | 'rain' | 'fog';
  /** 地圖上的文字標記 */
  labels?: { x: number; z: number; text: string }[];
  /** 場景裝飾（不影響模擬）：例如赤壁江上燃燒的連環船 */
  decor?: { kind: 'ship'; x: number; z: number; angle: number; team: number; burning?: boolean; burnt?: boolean }[];
  /** 橋（結構物，可通行） */
  bridges?: { x: number; z: number; angle: number; length: number }[];
}
