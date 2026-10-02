// 預渲染音色庫：頻繁觸發的短音效（兵刃、倒地、箭…）與環境細節事件，
// 在 unlock 後用 OfflineAudioContext 跑同一份配方，各渲染數個隨機變體存成 AudioBuffer。
// 之後播放只需要 1 個 BufferSource，大量同時觸發也很省；渲染完成前由即時合成頂替。

import type { Kit } from './synth';
import type { Recipe } from './sfx';

export interface BankDef {
  name: string;
  recipe: Recipe;
  count: number;
  len: number;
  stereo?: boolean;
}

export class SoundBank {
  private map = new Map<string, AudioBuffer[]>();
  private last = new Map<string, number>();
  ready = false;
  rendered = 0;

  /** 隨機取一個變體（避免連續兩次同一個）；尚未渲染回傳 null */
  get(name: string): AudioBuffer | null {
    const arr = this.map.get(name);
    if (!arr || arr.length === 0) return null;
    let i = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && i === this.last.get(name)) i = (i + 1) % arr.length;
    this.last.set(name, i);
    return arr[i];
  }

  has(name: string): boolean {
    const arr = this.map.get(name);
    return !!arr && arr.length > 0;
  }

  /** 依序離線渲染所有定義（每個之間讓出主執行緒，不卡畫面） */
  async render(base: Kit, defs: BankDef[]): Promise<void> {
    const OAC: typeof OfflineAudioContext | undefined =
      typeof OfflineAudioContext !== 'undefined'
        ? OfflineAudioContext
        : (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OAC) return;
    const sr = base.ctx.sampleRate;
    for (const d of defs) {
      for (let i = 0; i < d.count; i++) {
        try {
          const off = new OAC(d.stereo ? 2 : 1, Math.ceil(sr * d.len), sr);
          const k: Kit = { ...base, ctx: off };
          d.recipe(k, off.destination, 0.002, 1);
          const buf = await off.startRendering();
          let arr = this.map.get(d.name);
          if (!arr) {
            arr = [];
            this.map.set(d.name, arr);
          }
          arr.push(buf);
          this.rendered++;
        } catch {
          // 不支援離線渲染：維持即時合成
        }
        await new Promise<void>((res) => setTimeout(res, 0));
      }
    }
    this.ready = true;
  }
}
