import { createPhaserGame } from './game/phaserGame';

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app');

console.info('[FH_CLIENT_STARTUP] ENTRY', {
  ts: new Date().toISOString(),
  href: window.location.href,
  pathname: window.location.pathname
});

try {
  createPhaserGame(app);
} catch (error) {
  console.error('[FH_CLIENT_STARTUP] FATAL', {
    ts: new Date().toISOString(),
    error: error instanceof Error ? error.stack ?? error.message : String(error)
  });
  app.textContent = 'FlatHockey failed to start.';
  throw error;
}
