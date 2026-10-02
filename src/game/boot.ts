// 開機：目前直接進入戰役（M5 會換成主選單）
import { audio } from '../audio/audio';
import { GUANDU } from '../data/scenarios/guandu';
import type { Quality } from '../render/stage';
import { Battle } from './battle';

export function boot(container: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const quality = (params.get('q') as Quality) ?? (matchMedia('(pointer:coarse)').matches ? 'medium' : 'high');
  const unlock = () => audio.unlock();
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
  let current: Battle | null = null;
  if (params.has('dev')) import('../dev/devtools').then((m) => m.installDevtools(() => current));
  const start = () => {
    const b = new Battle(container, GUANDU, {
      quality,
      difficulty: (params.get('diff') as 'easy' | 'normal' | 'hard') ?? 'normal',
      skipDeploy: params.has('skip'),
      onExit: () => start(),
    });
    current = b;
    (window as unknown as { battle: Battle }).battle = b;
  };
  start();
}
