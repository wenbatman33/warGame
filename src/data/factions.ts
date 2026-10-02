// 勢力：顏色、旗號字、名稱
export type FactionId = 'wei' | 'yuan' | 'shu' | 'wu' | 'dong';

export interface FactionDef {
  id: FactionId;
  name: string;
  color: string;
  /** UI 用的深色 */
  dark: string;
  /** 旗面字 */
  flag: string;
}

export const FACTIONS: Record<FactionId, FactionDef> = {
  wei: { id: 'wei', name: '魏', color: '#2f6fe0', dark: '#163a7a', flag: '曹' },
  yuan: { id: 'yuan', name: '袁', color: '#e8b21e', dark: '#7a5a0a', flag: '袁' },
  shu: { id: 'shu', name: '蜀', color: '#2fa84f', dark: '#14552a', flag: '劉' },
  wu: { id: 'wu', name: '吳', color: '#d8402f', dark: '#701c12', flag: '孫' },
  dong: { id: 'dong', name: '董', color: '#7a4bc4', dark: '#3b1f66', flag: '董' },
};
