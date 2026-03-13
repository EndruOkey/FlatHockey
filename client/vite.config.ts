import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function readGitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

function resolveBasePath(): string {
  const raw = process.env.VITE_APP_BASE?.trim();
  if (!raw) return './';
  if (raw === './' || raw === '/') return raw;

  let normalized = raw.startsWith('/') ? raw : `/${raw}`;
  if (!normalized.endsWith('/')) normalized += '/';
  return normalized;
}

export default defineConfig({
  base: resolveBasePath(),
  define: {
    __FH_GIT_HASH__: JSON.stringify(readGitHash()),
    __FH_BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  build: {
    sourcemap: false
  },
  server: {
    host: true,
    port: 5173
  }
});
