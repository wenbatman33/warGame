// 渲染舞台：renderer、場景、CoC 式暖色光、天空、霧、陰影跟隨鏡頭
import * as THREE from 'three';

export type Quality = 'high' | 'medium' | 'low';

export const LIGHT = {
  sunColor: '#fff0d4',
  sunIntensity: 2.7,
  sunAzimuth: 225, // 度：光從西南方照過來（陰影往東北）
  sunElevation: 48,
  skyColor: '#c4e4ff',
  groundColor: '#7a8f45',
  hemiIntensity: 1.25,
  exposure: 1.0,
  fogColor: '#cfe3ee',
  fogNear: 380,
  fogFar: 1100,
};

export type TimeOfDay = 'day' | 'dusk' | 'night';

/** 天色預設：白天（CoC 式晴朗）／黃昏（官渡）／夜晚（夜襲） */
export const TIME_PRESETS: Record<TimeOfDay, Partial<typeof LIGHT> & { sky: [string, string, string] }> = {
  day: { sky: ['#5ea8e8', '#a9d4f5', '#e6f2f6'] },
  dusk: {
    sunColor: '#ffbf8a',
    sunIntensity: 2.9,
    sunAzimuth: 250,
    sunElevation: 24,
    skyColor: '#f6d2ac',
    groundColor: '#6a6a40',
    hemiIntensity: 1.3,
    exposure: 1.05,
    fogColor: '#e6b48e',
    fogNear: 320,
    fogFar: 1000,
    sky: ['#4b5d9a', '#e39a72', '#f6d2a0'],
  },
  night: {
    sunColor: '#a9bcff',
    sunIntensity: 1.1,
    sunAzimuth: 200,
    sunElevation: 38,
    skyColor: '#3a4d7a',
    groundColor: '#1a2018',
    hemiIntensity: 0.75,
    exposure: 1.15,
    fogColor: '#1a2440',
    fogNear: 220,
    fogFar: 820,
    sky: ['#070c1e', '#18264a', '#2a3a5e'],
  },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  quality: Quality;
  private shadowBox = 160;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHT.exposure;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 3000);

    this.sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity);
    this.sun.castShadow = quality !== 'low';
    const sz = quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sz, sz);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(LIGHT.skyColor, LIGHT.groundColor, LIGHT.hemiIntensity);
    this.scene.add(this.hemi);

    this.scene.fog = new THREE.Fog(LIGHT.fogColor, LIGHT.fogNear, LIGHT.fogFar);
    this.scene.background = makeSkyTexture(TIME_PRESETS.day.sky);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => this.resize();

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** 套用天色預設 */
  setTimeOfDay(t: TimeOfDay): void {
    const { sky, ...rest } = TIME_PRESETS[t];
    Object.assign(LIGHT, DAY_LIGHT, rest);
    this.scene.background = makeSkyTexture(sky);
    this.applyLight();
  }

  /** 套用 LIGHT 參數（DEV 工具調整後呼叫） */
  applyLight(): void {
    this.sun.color.set(LIGHT.sunColor);
    this.sun.intensity = LIGHT.sunIntensity;
    this.hemi.color.set(LIGHT.skyColor);
    this.hemi.groundColor.set(LIGHT.groundColor);
    this.hemi.intensity = LIGHT.hemiIntensity;
    this.renderer.toneMappingExposure = LIGHT.exposure;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(LIGHT.fogColor);
    fog.near = LIGHT.fogNear;
    fog.far = LIGHT.fogFar;
  }

  /** 陰影相機跟著鏡頭注視點；範圍隨縮放變化 */
  updateShadow(target: THREE.Vector3, viewRadius: number): void {
    const box = THREE.MathUtils.clamp(viewRadius * 1.25, 60, 420);
    const az = THREE.MathUtils.degToRad(LIGHT.sunAzimuth);
    const el = THREE.MathUtils.degToRad(LIGHT.sunElevation);
    const dist = 400;
    // 對齊陰影貼圖像素，避免移動鏡頭時陰影邊緣閃爍
    const texel = (box * 2) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    this.sun.position.set(tx + Math.cos(el) * Math.sin(az) * dist, Math.sin(el) * dist, tz + Math.cos(el) * Math.cos(az) * dist);
    this.sun.target.position.set(tx, 0, tz);
    if (Math.abs(box - this.shadowBox) > 1) {
      this.shadowBox = box;
      const cam = this.sun.shadow.camera;
      cam.left = -box;
      cam.right = box;
      cam.top = box;
      cam.bottom = -box;
      cam.near = 10;
      cam.far = dist * 2;
      cam.updateProjectionMatrix();
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

const DAY_LIGHT = { ...LIGHT };

/** 天空：上深下淺的漸層 */
function makeSkyTexture(stops: [string, string, string]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, stops[0]);
  grad.addColorStop(0.55, stops[1]);
  grad.addColorStop(1, stops[2]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
