import { createPhaserGame } from './game/phaserGame';

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app');
createPhaserGame(app);
