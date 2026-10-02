// HUD 版面（LAYOUT_PC / LAYOUT_MOBILE / LAYOUT_TABLET）：每個 data-layout 元件的位移與縮放，DEV 工具可拖曳調整並匯出
export interface LayoutItem {
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
}
export type LayoutSet = Record<string, LayoutItem>;
export type LayoutKey = 'pc' | 'tablet' | 'mobile';

const item = (scale = 1, dx = 0, dy = 0): LayoutItem => ({ dx, dy, scale, opacity: 1 });

export const LAYOUT_PC: LayoutSet = {
  reginfo: item(),
  cmdr: item(),
  top: item(),
  topRight: item(),
  bottom: item(),
  cmdbar: item(),
  deploy: item(),
  menu: item(),
};
export const LAYOUT_TABLET: LayoutSet = {
  reginfo: item(),
  cmdr: item(0.9),
  top: item(0.9),
  topRight: item(0.85),
  bottom: item(0.95),
  cmdbar: item(0.95),
  deploy: item(0.9),
  menu: item(0.9),
};
export const LAYOUT_MOBILE: LayoutSet = {
  reginfo: item(),
  cmdr: item(0.78),
  top: item(0.8),
  topRight: item(0.7),
  bottom: item(0.85),
  cmdbar: item(0.82, 0, -6),
  deploy: item(0.8),
  menu: item(0.75),
};

export const LAYOUTS: Record<LayoutKey, LayoutSet> = { pc: LAYOUT_PC, tablet: LAYOUT_TABLET, mobile: LAYOUT_MOBILE };

/** DEV 工具可強制指定版面 */
export const LAYOUT = { force: null as LayoutKey | null };

export function currentLayout(): LayoutKey {
  if (LAYOUT.force) return LAYOUT.force;
  const w = innerWidth;
  const h = innerHeight;
  const coarse = matchMedia('(pointer:coarse)').matches;
  if (Math.min(w, h) < 500) return 'mobile';
  if (coarse || w < 1100) return 'tablet';
  return 'pc';
}

export function applyLayout(root: ParentNode): void {
  const set = LAYOUTS[currentLayout()];
  for (const e of root.querySelectorAll<HTMLElement>('[data-layout]')) {
    const it = set[e.dataset.layout!];
    if (!it) continue;
    e.style.translate = `${it.dx}px ${it.dy}px`;
    e.style.scale = String(it.scale);
    e.style.opacity = String(it.opacity);
  }
}
