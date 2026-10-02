// 千軍令 — 音效引擎（對外 API）
// 全部 WebAudio 程式合成（語音除外）。訊號流：
//
//   一次性音效 → 音量 → 空氣吸收低通 → 聲像 ─→ sfxDry ─┐
//                    └→ 殘響送出 ───────────→ sfxWet ─┤→ 殘響(Convolver) ─┐
//   環境層 → ambDuck ───────────────────────→ sfxDry   │                  │
//   配樂 → musicDuck → musicDry ─────────────────────────────────────────┤
//   語音 → EQ → 壓縮 → voiceDry ─────────────────────────────────────────┤
//                                                       master → 壓縮(膠合) → 限幅 → 喇叭
//
// 未 unlock／瀏覽器不支援時，所有方法都安全地 no-op（設定值會先記住，unlock 後套用）。

import { Ambience } from './ambience';
import { type BankDef, SoundBank } from './bank';
import { MUSIC_HIT_RECIPES, Music } from './music';
import { AMB_EVENTS, type AmbEventId, SFX, SFX_SPEC } from './sfx';
import { type Kit, biquad, clamp, gainNode, makeImpulse, makeNoise, panner } from './synth';
import { type AmbienceLevels, MUSIC_MODES, type MusicMode, type SfxId, VOICE_IDS, type VoiceId } from './types';

export type { AmbienceLevels, MusicMode, SfxId, VoiceId } from './types';

// ─────────────────────────────────────────── 參數

const MAX_ACTIVE = 40; // 同時存在的一次性音效上限（超過時丟棄次要音效）
const VOICE_COOLDOWN = 1.5; // 語音冷卻（秒，從上一句開始算）
const REF_DIST = 40; // 這距離內不衰減（m）
const MAX_DIST = 1500; // 超過這距離不播
const AIR_DIST = 380; // 空氣吸收（高頻衰減）尺度（m）
const HEIGHT_W = 0.5; // 鏡頭高度計入距離的權重

/** 語音優先度：0＝回應（可被打斷、冷卻中直接丟棄）、1＝戰況播報（排隊）、2＝開戰／結算（可打斷、無視冷卻） */
const VOICE_PRI: Record<VoiceId, number> = {
  ack_move: 0,
  ack_attack: 0,
  ack_charge: 0,
  ack_retreat: 0,
  ack_hold: 0,
  enemy_depot_burning: 1,
  our_depot_burning: 1,
  enemy_depot_burnt: 1,
  our_depot_burnt: 1,
  general_down: 1,
  enemy_routing: 1,
  our_routing: 1,
  battle_start: 2,
  victory: 2,
  defeat: 2,
};

interface Buses {
  master: GainNode;
  sfxDry: GainNode;
  sfxWet: GainNode;
  ambDuck: GainNode;
  ambWet: GainNode;
  musicDry: GainNode;
  musicWet: GainNode;
  musicDuck: GainNode;
  musicDuckW: GainNode;
  voiceIn: GainNode;
  voiceDry: GainNode;
  voiceWet: GainNode;
}

interface SfxState {
  last: number;
  ends: number[];
  merged: number;
}

export interface AudioDebugInfo {
  supported: boolean;
  state: string;
  activeSfx: number;
  ambEvents: number;
  bankRendered: number;
  bankReady: boolean;
  music: MusicMode;
  voice: VoiceId | null;
  voicesLoaded: number;
  ambience: AmbienceLevels;
  listener: { x: number; z: number; height: number };
}

/** decodeAudioData 相容包裝（舊 Safari 只有 callback 版） */
function decode(ctx: BaseAudioContext, ab: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(ab, resolve, reject) as Promise<AudioBuffer> | undefined;
      p?.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private disabled = false;
  private primed = false;
  private kit: Kit | null = null;
  private bus: Buses | null = null;
  private bank = new SoundBank();
  private amb: Ambience | null = null;
  private mus: Music | null = null;
  private timer = 0;
  private hidden = false;
  private vol = { master: 0.85, music: 0.55, sfx: 0.9, voice: 1 };
  private listener = { x: 0, z: 0, h: 60 };
  private ambLevels: AmbienceLevels = { melee: 0, cavalry: 0, marching: 0, fire: 0 };
  private musicMode: MusicMode = 'none';
  private sfxState = new Map<SfxId, SfxState>();
  private voiceCache = new Map<VoiceId, Promise<AudioBuffer | null>>();
  private voicesLoaded = 0;
  private voiceNow: { id: VoiceId; pri: number; end: number; src: AudioBufferSourceNode | null } | null = null;
  private voiceLast = -99;
  private voiceToken = 0;
  private voicePending: { id: VoiceId; at: number } | null = null;

  // ─────────────────────────────────────── 生命週期

  /** 第一次使用者互動（pointerdown／keydown）時呼叫；之後每次互動再呼叫也無妨（會 resume 被系統暫停的 context） */
  unlock(): void {
    if (this.disabled) return;
    try {
      if (!this.ctx) {
        if (typeof window === 'undefined') return;
        const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const AC = w.AudioContext || w.webkitAudioContext;
        if (!AC) {
          this.disabled = true;
          return;
        }
        const ctx = new AC({ latencyHint: 'interactive' });
        this.ctx = ctx;
        this.build(ctx);
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running' && !this.hidden) void ctx.resume().catch(() => undefined);
      if (!this.primed) {
        // iOS：在使用者手勢內播一個靜音 buffer 才算真正解鎖
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
        this.primed = true;
      }
    } catch {
      this.disabled = true;
      this.teardown();
    }
  }

  /** 釋放（HMR 或離開遊戲時） */
  dispose(): void {
    this.teardown();
    this.disabled = false;
  }

  private teardown(): void {
    try {
      if (this.timer) window.clearInterval(this.timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
      this.amb?.dispose();
      this.mus?.dispose();
      void this.ctx?.close().catch(() => undefined);
    } catch {
      /* 忽略 */
    }
    this.timer = 0;
    this.ctx = null;
    this.kit = null;
    this.bus = null;
    this.amb = null;
    this.mus = null;
    this.primed = false;
    this.bank = new SoundBank();
    this.sfxState.clear();
    this.voiceCache.clear();
    this.voicesLoaded = 0;
    this.voiceNow = null;
  }

  private build(ctx: AudioContext): void {
    const noise = makeNoise(ctx, 4);
    const kit: Kit = { ctx, ...noise, rnd: Math.random };
    this.kit = kit;

    const master = gainNode(ctx, this.vol.master);
    const comp = ctx.createDynamicsCompressor(); // 膠合：讓大量音效疊在一起不爆
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.3;
    const limiter = ctx.createDynamicsCompressor(); // 限幅：最後一道防爆音
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    master.connect(comp).connect(limiter).connect(ctx.destination);

    // 程式產生的戰場殘響（含遠山回聲）
    const reverb = ctx.createConvolver();
    reverb.buffer = makeImpulse(ctx, 3.2, 2.6);
    const revIn = gainNode(ctx, 1);
    revIn.connect(reverb).connect(gainNode(ctx, 0.7)).connect(master);

    const sfxDry = gainNode(ctx, this.vol.sfx);
    const sfxWet = gainNode(ctx, this.vol.sfx);
    sfxDry.connect(master);
    sfxWet.connect(revIn);
    const ambDuck = gainNode(ctx, 1);
    const ambWet = gainNode(ctx, 1);
    ambDuck.connect(sfxDry);
    ambWet.connect(sfxWet);

    const musicDry = gainNode(ctx, this.vol.music);
    const musicWet = gainNode(ctx, this.vol.music);
    musicDry.connect(master);
    musicWet.connect(revIn);
    const musicDuck = gainNode(ctx, 1);
    const musicDuckW = gainNode(ctx, 1);
    musicDuck.connect(musicDry);
    musicDuckW.connect(musicWet);

    // 語音：去低頻、提一點清晰度、輕壓縮，再送一點殘響融入戰場
    const voiceIn = gainNode(ctx, 1);
    const vComp = ctx.createDynamicsCompressor();
    vComp.threshold.value = -22;
    vComp.ratio.value = 3;
    vComp.attack.value = 0.003;
    vComp.release.value = 0.15;
    const voiceDry = gainNode(ctx, this.vol.voice);
    const voiceWet = gainNode(ctx, this.vol.voice * 0.22);
    voiceIn.connect(biquad(ctx, 'highpass', 130, 0.7)).connect(biquad(ctx, 'peaking', 3000, 1, 3)).connect(vComp);
    vComp.connect(voiceDry).connect(master);
    vComp.connect(voiceWet).connect(revIn);

    this.bus = { master, sfxDry, sfxWet, ambDuck, ambWet, musicDry, musicWet, musicDuck, musicDuckW, voiceIn, voiceDry, voiceWet };

    this.amb = new Ambience(kit, this.bank, ambDuck, ambWet);
    this.amb.setLevels(this.ambLevels);
    this.amb.setHeight(this.listener.h);
    this.mus = new Music(kit, musicDuck, musicDuckW, this.bank);
    if (this.musicMode !== 'none') this.mus.setMode(this.musicMode, ctx.currentTime);

    this.timer = window.setInterval(this.tick, 50);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);

    void this.prerender(kit);
    window.setTimeout(() => this.preloadVoices(), 400);
  }

  /** 背景預渲染頻繁音效與環境細節事件的變體 */
  private async prerender(kit: Kit): Promise<void> {
    const order: Array<SfxId | AmbEventId> = ['clash', 'death', 'shout', 'gallop', 'crackle', 'step', 'rattle', 'arrow_hit', 'shield_hit', 'arrow_volley'];
    const defs: BankDef[] = [];
    for (const name of order) {
      if (name in AMB_EVENTS) {
        const e = AMB_EVENTS[name as AmbEventId];
        defs.push({ name, recipe: e.recipe, count: e.count, len: e.len });
      } else {
        const s = SFX_SPEC[name as SfxId];
        if (s.bank && s.len) defs.push({ name, recipe: SFX[name as SfxId], count: s.bank, len: s.len, stereo: s.stereo });
      }
    }
    for (const h of MUSIC_HIT_RECIPES) defs.splice(2, 0, { name: h.name, recipe: h.recipe, count: h.count, len: h.len });
    try {
      await this.bank.render(kit, defs);
    } catch {
      /* 失敗就全部走即時合成 */
    }
  }

  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const now = ctx.currentTime;
      this.amb?.tick(now);
      this.mus?.tick(now);
    } catch {
      /* 單次排程失敗不影響之後 */
    }
  };

  private onVisibility = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (document.hidden) {
        this.hidden = true;
        void ctx.suspend().catch(() => undefined);
      } else {
        this.hidden = false;
        void ctx.resume().catch(() => undefined);
      }
    } catch {
      /* 忽略 */
    }
  };

  // ─────────────────────────────────────── 音量／聽者

  setVolumes(v: { master?: number; music?: number; sfx?: number; voice?: number }): void {
    if (!v) return;
    const vol = this.vol;
    vol.master = clamp(num(v.master, vol.master), 0, 1);
    vol.music = clamp(num(v.music, vol.music), 0, 1);
    vol.sfx = clamp(num(v.sfx, vol.sfx), 0, 1);
    vol.voice = clamp(num(v.voice, vol.voice), 0, 1);
    const b = this.bus;
    const ctx = this.ctx;
    if (!b || !ctx) return;
    try {
      const now = ctx.currentTime;
      const set = (g: GainNode, x: number): void => {
        g.gain.setTargetAtTime(x, now, 0.03);
      };
      set(b.master, vol.master);
      set(b.sfxDry, vol.sfx);
      set(b.sfxWet, vol.sfx);
      set(b.musicDry, vol.music);
      set(b.musicWet, vol.music);
      set(b.voiceDry, vol.voice);
      set(b.voiceWet, vol.voice * 0.22);
    } catch {
      /* 忽略 */
    }
  }

  /** 鏡頭注視點（x, z）與鏡頭高度（m）；x 正向視為畫面右方 */
  setListener(x: number, z: number, height: number): void {
    const L = this.listener;
    L.x = num(x, L.x);
    L.z = num(z, L.z);
    L.h = Math.max(0, num(height, L.h));
    try {
      this.amb?.setHeight(L.h);
    } catch {
      /* 忽略 */
    }
  }

  /** 距離衰減、聲像、空氣吸收、遠處多一點殘響 */
  private spatial(x?: number, z?: number): { gain: number; pan: number; cut: number; far: number } {
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) {
      return { gain: 1, pan: 0, cut: 0, far: 0 };
    }
    const L = this.listener;
    const dx = x - L.x;
    const dz = z - L.z;
    const hh = L.h * HEIGHT_W;
    const d = Math.sqrt(dx * dx + dz * dz + hh * hh);
    if (d > MAX_DIST) return { gain: 0, pan: 0, cut: 0, far: 1 };
    const gain = Math.pow(REF_DIST / Math.max(REF_DIST, d), 0.9);
    const pan = clamp(dx / Math.max(d, 1), -1, 1) * 0.85;
    const cut = clamp(20000 * Math.exp(-d / AIR_DIST), 700, 20000);
    const far = clamp((d - REF_DIST) / 400, 0, 1);
    return { gain, pan, cut, far };
  }

  // ─────────────────────────────────────── 一次性音效

  play(id: SfxId, opts?: { x?: number; z?: number; volume?: number; rate?: number }): void {
    const ctx = this.ctx;
    const kit = this.kit;
    const bus = this.bus;
    if (!ctx || !kit || !bus || this.hidden || ctx.state === 'closed') return;
    const spec = SFX_SPEC[id];
    if (!spec) return;
    try {
      const now = ctx.currentTime;
      let st = this.sfxState.get(id);
      if (!st) {
        st = { last: -99, ends: [], merged: 0 };
        this.sfxState.set(id, st);
      }
      if (st.ends.length) st.ends = st.ends.filter((e) => e > now);
      // 節流：太密集或同時太多 → 合併（記一筆，下一次播放稍微大聲一點）
      if (now - st.last < spec.gap || st.ends.length >= spec.max || (spec.minor && this.activeCount(now) >= MAX_ACTIVE)) {
        st.merged++;
        return;
      }
      const sp = this.spatial(opts?.x, opts?.z);
      const vol = clamp(num(opts?.volume, 1), 0, 4) * spec.vol * sp.gain * (1 + Math.min(st.merged, 6) * 0.07);
      st.merged = 0;
      if (vol < 0.004) return;
      const rate = clamp(num(opts?.rate, 1), 0.25, 4);
      const t = now + 0.01;

      // 輸出鏈：音量 →（空氣吸收低通）→（聲像）→ 乾聲；另送殘響（越遠越濕）
      const nodes: AudioNode[] = [];
      const g = gainNode(ctx, vol);
      nodes.push(g);
      let tail: AudioNode = g;
      if (sp.cut > 0 && sp.cut < 15000) {
        const lp = biquad(ctx, 'lowpass', sp.cut, 0.7);
        tail.connect(lp);
        tail = lp;
        nodes.push(lp);
      }
      if (Math.abs(sp.pan) > 0.02) {
        const p = panner(ctx, sp.pan);
        tail.connect(p);
        tail = p;
        nodes.push(p);
      }
      tail.connect(bus.sfxDry);
      const send = gainNode(ctx, clamp(spec.wet + sp.far * 0.4, 0, 1));
      g.connect(send).connect(bus.sfxWet);
      nodes.push(send);

      let dur: number;
      const buf = spec.bank ? this.bank.get(id) : null;
      if (buf) {
        const s = ctx.createBufferSource();
        s.buffer = buf;
        const r = rate * (spec.minor ? 0.96 + Math.random() * 0.08 : 1);
        s.playbackRate.value = r;
        s.connect(g);
        s.start(t);
        dur = buf.duration / r;
        nodes.push(s);
      } else {
        dur = SFX[id](kit, g, t, rate);
      }
      st.last = now;
      st.ends.push(now + dur);
      window.setTimeout(() => {
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            /* 已斷開 */
          }
        }
      }, (dur + 0.8) * 1000);
    } catch {
      /* 靜默失敗，不影響遊戲 */
    }
  }

  private activeCount(now: number): number {
    let n = 0;
    for (const st of this.sfxState.values()) for (const e of st.ends) if (e > now) n++;
    return n;
  }

  // ─────────────────────────────────────── 環境層

  setAmbience(levels: AmbienceLevels): void {
    if (!levels) return;
    const a = this.ambLevels;
    a.melee = clamp(num(levels.melee, 0), 0, 1);
    a.cavalry = clamp(num(levels.cavalry, 0), 0, 1);
    a.marching = clamp(num(levels.marching, 0), 0, 1);
    a.fire = clamp(num(levels.fire, 0), 0, 1);
    try {
      this.amb?.setLevels(a);
    } catch {
      /* 忽略 */
    }
  }

  // ─────────────────────────────────────── 語音

  voice(id: VoiceId): void {
    const ctx = this.ctx;
    if (!ctx || !this.bus || this.hidden) return;
    const pri = VOICE_PRI[id];
    if (pri === undefined) return;
    try {
      const now = ctx.currentTime;
      const cur = this.voiceNow;
      if (cur && now < cur.end) {
        if (pri <= cur.pri) {
          if (pri >= 1) this.voicePending = { id, at: now }; // 播報排隊，回應直接丟棄
          return;
        }
        // 高優先打斷低優先（例如「遵命」被「大獲全勝」打斷）
        if (cur.src) {
          try {
            cur.src.stop();
          } catch {
            /* 已停止 */
          }
        }
      } else if (now - this.voiceLast < VOICE_COOLDOWN && pri < 2) {
        if (pri >= 1) {
          this.voicePending = { id, at: now };
          const wait = this.voiceLast + VOICE_COOLDOWN - now;
          window.setTimeout(() => {
            if (!this.voiceNow) this.flushPending();
          }, wait * 1000 + 30);
        }
        return;
      }
      const token = ++this.voiceToken;
      this.voiceLast = now;
      this.voiceNow = { id, pri, end: now + 3, src: null }; // 先佔位，避免載入期間重複觸發
      void this.loadVoice(id).then((buf) => {
        if (token !== this.voiceToken) return;
        const c = this.ctx;
        const b = this.bus;
        if (!buf || !c || !b || c.currentTime - now > 1.2) {
          this.voiceNow = null;
          return;
        }
        try {
          const src = c.createBufferSource();
          src.buffer = buf;
          const rate = pri === 0 ? 0.97 + Math.random() * 0.06 : 1; // 回應語音微變化，不那麼像錄音機
          src.playbackRate.value = rate;
          src.connect(b.voiceIn);
          const t = c.currentTime;
          src.start(t);
          this.voiceNow = { id, pri, end: t + buf.duration / rate, src };
          this.duck(true);
          src.onended = () => {
            src.disconnect();
            if (this.voiceNow?.src !== src) return;
            this.voiceNow = null;
            this.duck(false);
            this.flushPending();
          };
        } catch {
          this.voiceNow = null;
        }
      });
    } catch {
      /* 靜默 */
    }
  }

  private flushPending(): void {
    const p = this.voicePending;
    const ctx = this.ctx;
    if (!p || !ctx) return;
    this.voicePending = null;
    const now = ctx.currentTime;
    if (now - p.at > 4) return; // 過時的播報就不播了
    const wait = Math.max(0, this.voiceLast + VOICE_COOLDOWN - now);
    window.setTimeout(() => this.voice(p.id), wait * 1000 + 120);
  }

  /** 語音播放時壓低配樂與環境層 */
  private duck(on: boolean): void {
    const b = this.bus;
    const ctx = this.ctx;
    if (!b || !ctx) return;
    const now = ctx.currentTime;
    const tc = on ? 0.06 : 0.45;
    b.musicDuck.gain.setTargetAtTime(on ? 0.45 : 1, now, tc);
    b.musicDuckW.gain.setTargetAtTime(on ? 0.45 : 1, now, tc);
    b.ambDuck.gain.setTargetAtTime(on ? 0.6 : 1, now, tc);
    b.ambWet.gain.setTargetAtTime(on ? 0.6 : 1, now, tc);
  }

  private loadVoice(id: VoiceId): Promise<AudioBuffer | null> {
    let p = this.voiceCache.get(id);
    if (!p) {
      const ctx = this.ctx;
      if (!ctx || typeof fetch !== 'function') return Promise.resolve(null);
      const url = `${import.meta.env.BASE_URL}assets/voice/${id}.m4a`;
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((ab) => decode(ctx, ab))
        .then((buf) => {
          this.voicesLoaded++;
          return buf;
        })
        .catch(() => {
          // 載入失敗：10 秒後允許重試
          window.setTimeout(() => this.voiceCache.delete(id), 10000);
          return null;
        });
      this.voiceCache.set(id, p);
    }
    return p;
  }

  private preloadVoices(): void {
    if (!this.ctx) return;
    VOICE_IDS.forEach((id, i) => window.setTimeout(() => void this.loadVoice(id), i * 40));
  }

  // ─────────────────────────────────────── 配樂

  music(mode: MusicMode): void {
    if (!(MUSIC_MODES as readonly string[]).includes(mode)) return;
    this.musicMode = mode;
    const ctx = this.ctx;
    if (!ctx || !this.mus) return;
    try {
      this.mus.setMode(mode, ctx.currentTime);
    } catch {
      /* 忽略 */
    }
  }

  // ─────────────────────────────────────── 除錯

  /** DEV 用：目前狀態 */
  debugInfo(): AudioDebugInfo {
    const ctx = this.ctx;
    const now = ctx?.currentTime ?? 0;
    return {
      supported: !this.disabled,
      state: ctx ? ctx.state : 'locked',
      activeSfx: ctx ? this.activeCount(now) : 0,
      ambEvents: this.amb?.activeEvents() ?? 0,
      bankRendered: this.bank.rendered,
      bankReady: this.bank.ready,
      music: this.musicMode,
      voice: this.voiceNow && now < this.voiceNow.end ? this.voiceNow.id : null,
      voicesLoaded: this.voicesLoaded,
      ambience: this.amb?.levels() ?? { ...this.ambLevels },
      listener: { x: this.listener.x, z: this.listener.z, height: this.listener.h },
    };
  }
}

/** 單例 */
export const audio: AudioEngine = new AudioEngine();

// Vite HMR：模組替換時關掉舊的 AudioContext，避免兩套聲音疊在一起
if (import.meta.hot) import.meta.hot.dispose(() => audio.dispose());
