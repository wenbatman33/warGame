// 音效系統對外型別（由 audio.ts 重新匯出，遊戲端請從 'src/audio/audio' 匯入）

export type SfxId =
  | 'drum_start' // 開戰戰鼓（3–4 秒大鼓滾奏＋重擊）
  | 'drum_boost' // 擂鼓助威計策
  | 'horn_charge' // 衝鋒號角（低沉牛角號）
  | 'horn_retreat' // 撤退號
  | 'gong' // 鳴金（銅鑼）
  | 'clash' // 單次兵刃交擊
  | 'arrow_volley' // 一波箭雨放箭
  | 'arrow_hit' // 箭落地／命中
  | 'shield_hit' // 箭打在盾上
  | 'charge_impact' // 騎兵衝撞
  | 'death' // 倒地
  | 'war_cry' // 軍團吶喊
  | 'fire_ignite' // 點火
  | 'depot_burnt' // 糧倉焚毀
  | 'rout' // 軍團潰逃
  | 'general_down' // 武將陣亡
  | 'stratagem' // 施放計策
  | 'ui_click'
  | 'ui_select'
  | 'ui_order'
  | 'ui_card'
  | 'ui_error'
  | 'victory_sting'
  | 'defeat_sting'
  | 'star'; // 結算三星每顆星（用 rate 讓每顆星升高音：1、1.12、1.26）

export type VoiceId =
  | 'ack_move'
  | 'ack_attack'
  | 'ack_charge'
  | 'ack_retreat'
  | 'ack_hold'
  | 'enemy_depot_burning'
  | 'our_depot_burning'
  | 'enemy_depot_burnt'
  | 'our_depot_burnt'
  | 'general_down'
  | 'enemy_routing'
  | 'our_routing'
  | 'victory'
  | 'defeat'
  | 'battle_start';

export type MusicMode = 'none' | 'menu' | 'deploy' | 'battle' | 'climax' | 'victory' | 'defeat';

/** 環境層強度 0..1 */
export interface AmbienceLevels {
  melee: number;
  cavalry: number;
  marching: number;
  fire: number;
}

export const SFX_IDS: readonly SfxId[] = [
  'drum_start', 'drum_boost', 'horn_charge', 'horn_retreat', 'gong',
  'clash', 'arrow_volley', 'arrow_hit', 'shield_hit', 'charge_impact', 'death',
  'war_cry', 'fire_ignite', 'depot_burnt', 'rout', 'general_down', 'stratagem',
  'ui_click', 'ui_select', 'ui_order', 'ui_card', 'ui_error',
  'victory_sting', 'defeat_sting', 'star',
];

export const VOICE_IDS: readonly VoiceId[] = [
  'ack_move', 'ack_attack', 'ack_charge', 'ack_retreat', 'ack_hold',
  'enemy_depot_burning', 'our_depot_burning', 'enemy_depot_burnt', 'our_depot_burnt',
  'general_down', 'enemy_routing', 'our_routing', 'victory', 'defeat', 'battle_start',
];

export const MUSIC_MODES: readonly MusicMode[] = ['none', 'menu', 'deploy', 'battle', 'climax', 'victory', 'defeat'];
