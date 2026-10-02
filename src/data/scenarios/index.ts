// 戰役清單與戰役地圖節點位置（百分比）
import type { Scenario } from '../scenario';
import { BAIMA } from './baima';
import { CHIBI } from './chibi';
import { GUANDU } from './guandu';
import { HEFEI } from './hefei';
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
  { id: 'guandu', name: '官渡之戰', year: '200', x: 50, y: 33, scenario: GUANDU, image: 'battle/battle_guandu.jpg' },
  { id: 'chibi', name: '赤壁之戰', year: '208', x: 61, y: 63, scenario: CHIBI, image: 'battle/battle_chibi.jpg' },
  { id: 'hefei', name: '合肥之戰', year: '215', x: 78, y: 41, scenario: HEFEI, image: 'battle/battle_hefei.jpg' },
  { id: 'yiling', name: '夷陵之戰', year: '222', x: 21, y: 63, scenario: YILING, image: 'battle/battle_yiling.jpg' },
  { id: 'jieting', name: '街亭之戰', year: '228', x: 16, y: 25, scenario: JIETING, image: 'battle/battle_jieting.jpg' },
];
