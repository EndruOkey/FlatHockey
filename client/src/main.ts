import { Application } from 'pixi.js';
import { Game } from './game/Game';

const app = new Application();

await app.init({
  resizeTo:        window,
  backgroundColor: 0x0a1929,
  antialias:       true,
  resolution:      Math.min(window.devicePixelRatio ?? 1, 2),
  autoDensity:     true,
});

document.getElementById('app')!.appendChild(app.canvas);

new Game(app);
