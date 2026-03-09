export const ENV = {
  WS_PROD: 'wss://flathockey.fun/ws2',
  WS_DEV: 'wss://flathockey.fun/ws2',
  WS_LOCAL: 'ws://localhost:8080/ws2',
  DEV_BUILD: import.meta.env.DEV || import.meta.env.VITE_DEV_BUILD === 'true'
};
