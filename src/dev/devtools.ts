// DEV 微調工具（docs/05 §7）：網址加 ?dev=1，按 ` 鍵或右下齒輪開關
// 版面拖曳、鏡頭、光線、規則、兵種數值、狀態觸發、💾 匯出 JSON
import GUI from 'lil-gui';
import { RULES } from '../data/rules';
import { UNITS, type UnitTypeId } from '../data/units';
import type { Battle } from '../game/battle';
import { CAM } from '../input/camera';
import { LIGHT } from '../render/stage';
import { SState } from '../sim/soldiers';
import { applyLayout, currentLayout, LAYOUT, LAYOUTS, type LayoutKey } from '../ui/layout';

let gui: GUI | null = null;
let dragMode = false;

export function installDevtools(getBattle: () => Battle | null): void {
  const gear = document.createElement('div');
  gear.textContent = '⚙';
  gear.title = 'DEV 微調工具（` 鍵）';
  gear.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:60;width:34px;height:34px;border-radius:50%;background:#222c;border:2px solid #f7d36a;color:#f7d36a;display:grid;place-items:center;font-size:20px;cursor:pointer;user-select:none';
  document.body.appendChild(gear);
  const toggle = () => {
    if (gui) {
      gui.destroy();
      gui = null;
      setDrag(false);
    } else gui = build(getBattle);
  };
  gear.onclick = toggle;
  addEventListener('keydown', (e) => {
    if (e.key === '`' || e.key === 'F8') toggle();
  });
}

function setDrag(on: boolean): void {
  dragMode = on;
  for (const e of document.querySelectorAll<HTMLElement>('[data-layout]')) {
    e.style.outline = on ? '2px dashed #ff3bd4' : '';
    e.style.cursor = on ? 'move' : '';
    e.style.pointerEvents = on ? 'auto' : '';
  }
}

// 拖曳 HUD 元件改位移
addEventListener(
  'pointerdown',
  (e) => {
    if (!dragMode) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-layout]');
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const key = t.dataset.layout!;
    const it = LAYOUTS[currentLayout()][key];
    const sx = e.clientX - it.dx;
    const sy = e.clientY - it.dy;
    const move = (ev: PointerEvent) => {
      it.dx = Math.round(ev.clientX - sx);
      it.dy = Math.round(ev.clientY - sy);
      applyLayout(document);
      gui?.controllersRecursive().forEach((c) => c.updateDisplay());
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  },
  true,
);

function build(getBattle: () => Battle | null): GUI {
  const g = new GUI({ title: '千軍令 DEV 微調' });
  g.domElement.style.zIndex = '70';
  const b = getBattle();

  // 版面
  const lay = g.addFolder('📐 HUD 版面（拖曳元件或拉滑桿）');
  const state = { layout: currentLayout() as LayoutKey, drag: false };
  lay
    .add(state, 'layout', ['pc', 'tablet', 'mobile'])
    .name('目前版面')
    .onChange((v: LayoutKey) => {
      LAYOUT.force = v;
      applyLayout(document);
      rebuildLayout();
    });
  lay.add(state, 'drag').name('拖曳模式').onChange((v: boolean) => setDrag(v));
  const items = lay.addFolder('各元件');
  const rebuildLayout = () => {
    for (const c of [...items.children]) c.destroy();
    const set = LAYOUTS[state.layout];
    for (const [k, it] of Object.entries(set)) {
      const f = items.addFolder(k);
      f.add(it, 'dx', -600, 600, 1).onChange(() => applyLayout(document));
      f.add(it, 'dy', -400, 400, 1).onChange(() => applyLayout(document));
      f.add(it, 'scale', 0.4, 2, 0.01).onChange(() => applyLayout(document));
      f.add(it, 'opacity', 0, 1, 0.01).onChange(() => applyLayout(document));
      f.close();
    }
  };
  rebuildLayout();
  items.close();

  // 鏡頭
  const cam = g.addFolder('🎥 鏡頭');
  cam.add(CAM, 'fov', 20, 70, 1);
  cam.add(CAM, 'minDist', 10, 80, 1);
  cam.add(CAM, 'maxDist', 150, 800, 5);
  cam.add(CAM, 'pitchNear', 10, 80, 1).name('近距俯角');
  cam.add(CAM, 'pitchFar', 20, 89, 1).name('遠距俯角');
  cam.add(CAM, 'keyPanSpeed', 0.2, 3, 0.05);
  cam.add(CAM, 'edgePan').name('邊緣捲動');
  cam.close();

  // 光線
  const li = g.addFolder('💡 光線');
  const applyLight = () => getBattle()?.view.stage.applyLight();
  li.addColor(LIGHT, 'sunColor').onChange(applyLight);
  li.add(LIGHT, 'sunIntensity', 0, 6, 0.05).onChange(applyLight);
  li.add(LIGHT, 'sunAzimuth', 0, 360, 1);
  li.add(LIGHT, 'sunElevation', 5, 89, 1);
  li.addColor(LIGHT, 'skyColor').onChange(applyLight);
  li.addColor(LIGHT, 'groundColor').onChange(applyLight);
  li.add(LIGHT, 'hemiIntensity', 0, 4, 0.05).onChange(applyLight);
  li.add(LIGHT, 'exposure', 0.3, 2, 0.01).onChange(applyLight);
  li.addColor(LIGHT, 'fogColor').onChange(applyLight);
  li.add(LIGHT, 'fogNear', 50, 1500, 10).onChange(applyLight);
  li.add(LIGHT, 'fogFar', 200, 3000, 10).onChange(applyLight);
  li.close();

  // 規則
  const ru = g.addFolder('📜 規則數值（RULES）');
  for (const [k, v] of Object.entries(RULES)) {
    if (typeof v !== 'number') continue;
    const max = Math.max(1, Math.abs(v) * 4);
    ru.add(RULES, k as keyof typeof RULES, v < 0 ? -max : 0, max, max > 20 ? 1 : 0.01);
  }
  ru.close();

  // 兵種
  const un = g.addFolder('⚔ 兵種數值（UNITS）');
  for (const id of Object.keys(UNITS) as UnitTypeId[]) {
    const u = UNITS[id];
    const f = un.addFolder(u.name);
    f.add(u, 'hp', 10, 400, 1);
    f.add(u, 'atk', 0, 40, 0.5);
    f.add(u, 'def', 0, 30, 0.5);
    f.add(u, 'walk', 0.5, 12, 0.1);
    f.add(u, 'run', 1, 18, 0.1);
    f.add(u, 'charge', 0, 80, 1);
    f.add(u, 'rate', 0.4, 3, 0.05);
    f.add(u, 'morale', 10, 100, 1);
    if (u.ranged) {
      f.add(u.ranged, 'dmg', 1, 40, 0.5).name('遠程傷害');
      f.add(u.ranged, 'range', 30, 250, 1).name('射程');
      f.add(u.ranged, 'reload', 0.5, 12, 0.1).name('裝填');
    }
    f.close();
  }
  un.close();

  // 狀態觸發
  const tr = g.addFolder('🎬 狀態觸發');
  const act = {
    燒敵主糧倉: () => {
      const w = getBattle()?.world;
      const st = w?.structs.find((s) => s.team !== w.player && s.kind === 'depot' && !s.burnt && s.main) ?? w?.structs.find((s) => s.team !== w.player && s.kind === 'depot' && !s.burnt);
      if (w && st) w.burnDown(st);
    },
    點燃我軍糧倉: () => {
      const w = getBattle()?.world;
      const st = w?.structs.find((s) => s.team === w.player && s.kind !== 'water' && !s.burnt && s.fire === 0);
      if (w && st) {
        st.fire = 0.3;
        st.ignite = 1;
        w.events.push({ k: 'ignite', s: st.id });
      }
    },
    敵軍斷糧: () => {
      const w = getBattle()?.world;
      if (w?.teams[1].hq) w.teams[1].hq.stock = 0;
    },
    我軍斷糧: () => {
      const w = getBattle()?.world;
      if (w?.teams[0].hq) w.teams[0].hq.stock = 0;
    },
    敵軍全線潰逃: () => {
      const w = getBattle()?.world;
      if (w) for (const r of w.regs) if (r.team !== w.player && !r.gone && !r.routing) w.rout(r);
    },
    勝利結算: () => getBattle()?.world.finish(0),
    失敗結算: () => getBattle()?.world.finish(1),
    慢動作: () => {
      const bb = getBattle();
      if (bb) bb.slowmo = 3;
    },
    選取武將陣亡: () => {
      const bb = getBattle();
      if (!bb) return;
      for (const id of bb.controls.selected) {
        const r = bb.world.regs[id];
        if (r.general?.alive) bb.world.damage(r.general.soldier, 1e6, -1);
      }
    },
    揭露全部敵軍: () => {
      const w = getBattle()?.world;
      if (w) for (const r of w.regs) r.spottedT = w.t + 9999;
    },
    快轉30秒: () => getBattle()?.simulate(30),
  };
  for (const k of Object.keys(act)) tr.add(act, k as keyof typeof act);
  const ai = { 敵軍AI: true, 生成兵種: 'sword' as UnitTypeId, 生成隊伍: 1 };
  tr.add(ai, '敵軍AI').onChange((v: boolean) => {
    const bb = getBattle();
    if (bb) for (const c of bb.ai) (c as unknown as { next: number }).next = v ? 0 : 1e9;
  });
  tr.add(ai, '生成兵種', Object.keys(UNITS));
  tr.add(ai, '生成隊伍', { 我軍: 0, 敵軍: 1 });
  tr.add(
    {
      在鏡頭中心生成軍團: () => {
        const bb = getBattle();
        if (!bb) return;
        const w = bb.world;
        const r = w.spawnRegiment(ai.生成隊伍, { type: ai.生成兵種, x: bb.cam.target.x, z: bb.cam.target.z });
        w.teams[ai.生成隊伍].initialStrength += r.alive;
        w.hash.rebuild(w.s);
      },
    },
    '在鏡頭中心生成軍團',
  );
  tr.add(
    {
      全部士兵統計: () => {
        const w = getBattle()?.world;
        if (!w) return;
        let alive = 0;
        for (let i = 0; i < w.s.count; i++) if (w.s.state[i] === SState.Alive) alive++;
        alert(`活著 ${alive} / 總數 ${w.s.count}；draw calls ${getBattle()!.view.stage.renderer.info.render.calls}`);
      },
    },
    '全部士兵統計',
  );

  // 匯出
  g.add(
    {
      '💾 匯出 / 鎖定': () => {
        const data = { LAYOUT_PC: LAYOUTS.pc, LAYOUT_TABLET: LAYOUTS.tablet, LAYOUT_MOBILE: LAYOUTS.mobile, CAM, LIGHT, RULES, UNITS };
        const json = JSON.stringify(data, null, 2);
        navigator.clipboard?.writeText(json).catch(() => undefined);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'wargame-tuning.json';
        a.click();
        alert('已複製到剪貼簿並下載 wargame-tuning.json。把內容貼給 Claude，就會寫回原始碼。');
      },
    },
    '💾 匯出 / 鎖定',
  );
  void b;
  return g;
}
