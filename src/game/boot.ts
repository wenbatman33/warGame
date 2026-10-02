// 開機：讀設定 → 主選單（網址參數可直接進戰役：?battle=guandu&skip=1）
import { audio } from '../audio/audio';
import { CAMPAIGN } from '../data/scenarios/index';
import { App } from './app';
import type { Battle } from './battle';
import { loadAll } from './settings';

export function boot(container: HTMLElement): void {
  loadAll();
  const params = new URLSearchParams(location.search);
  const unlock = () => audio.unlock();
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
  const app = new App(container);
  (window as unknown as { app: App }).app = app;
  if (params.has('dev')) import('../dev/devtools').then((m) => m.installDevtools(() => app.battle as Battle | null));
  const id = params.get('battle') ?? (params.has('skip') ? 'guandu' : null);
  const entry = CAMPAIGN.find((e) => e.id === id && e.scenario);
  if (entry) app.startBattle(entry.scenario!, entry.image);
  else app.showMenu();
}
