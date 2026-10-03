// 戰役清單與戰役地圖節點位置（百分比）
import type { Scenario } from '../scenario';
import { BAIMA } from './baima';
import { BOWANG } from './bowang';
import { CHANGBAN } from './changban';
import { CHIBI } from './chibi';
import { DINGJUN } from './dingjun';
import { GUANDU } from './guandu';
import { HEFEI } from './hefei';
import { HULAO } from './hulao';
import { JIETING } from './jieting';
import { YILING } from './yiling';

export interface CampaignEntry {
  id: string;
  name: string;
  year: string;
  /** 戰役地圖上的位置（%） */
  x: number;
  y: number;
  scenario: Scenario | null;
  image: string;
}

export const CAMPAIGN: CampaignEntry[] = [
  { id: 'baima', name: '白馬之圍（教學）', year: '200', x: 60, y: 21, scenario: BAIMA, image: 'battle/battle_baima.jpg' },
  { id: 'hulao', name: '虎牢關之戰', year: '190', x: 40, y: 27, scenario: HULAO, image: 'battle/battle_hulao.jpg' },
  { id: 'guandu', name: '官渡之戰', year: '200', x: 50, y: 33, scenario: GUANDU, image: 'battle/battle_guandu.jpg' },
  { id: 'bowang', name: '博望坡之戰（新玩法）', year: '202', x: 53, y: 44, scenario: BOWANG, image: 'battle/battle_bowang.jpg' },
  { id: 'changban', name: '長坂坡之戰', year: '208', x: 44, y: 53, scenario: CHANGBAN, image: 'battle/battle_changban.jpg' },
  { id: 'chibi', name: '赤壁之戰', year: '208', x: 61, y: 63, scenario: CHIBI, image: 'battle/battle_chibi.jpg' },
  { id: 'hefei', name: '合肥之戰', year: '215', x: 78, y: 41, scenario: HEFEI, image: 'battle/battle_hefei.jpg' },
  { id: 'dingjun', name: '定軍山之戰', year: '219', x: 26, y: 43, scenario: DINGJUN, image: 'battle/battle_dingjun.jpg' },
  { id: 'yiling', name: '夷陵之戰', year: '222', x: 21, y: 63, scenario: YILING, image: 'battle/battle_yiling.jpg' },
  { id: 'jieting', name: '街亭之戰', year: '228', x: 16, y: 25, scenario: JIETING, image: 'battle/battle_jieting.jpg' },
];
