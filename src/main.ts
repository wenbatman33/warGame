// 進入點
import './ui/style.css';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);

if (params.get('view') === 'models') {
  import('./dev/modelViewer').then((m) => m.startModelViewer(app));
} else {
  import('./game/boot').then((m) => m.boot(app));
}
