import type { ClientMessage } from './messages';

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as Partial<ClientMessage>;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return null;

    if (data.type === 'input') {
      if (typeof data.clientId !== 'string') return null;
      if (typeof data.seq !== 'number') return null;
      if (typeof (data as any).throttle !== 'number' || typeof (data as any).steer !== 'number') return null;
      if (typeof data.brake !== 'number') return null;

      const throttle = (data as any).throttle < 0 ? -1 : (data as any).throttle > 0 ? 1 : 0;
      const steer = (data as any).steer < 0 ? -1 : (data as any).steer > 0 ? 1 : 0;
      const brake = data.brake ? 1 : 0;
      const shoot = (data as any).shoot ? 1 : 0;
      const aimAngle = typeof data.aimAngle === 'number' ? data.aimAngle : undefined;

      return {
        type: 'input',
        clientId: data.clientId,
        seq: Math.max(0, Math.floor(data.seq)),
        throttle,
        steer,
        brake,
        shoot,
        aimAngle
      };
    }

    if (data.type === 'debug:setMovementTuning') {
      // allow any object; server will further validate/ignore when not allowed
      return {
        type: 'debug:setMovementTuning',
        config: (data as any).config || {}
      } as ClientMessage;
    }

    if (data.type === 'net:ping') {
      if (typeof (data as any).nonce !== 'number') return null;
      return {
        type: 'net:ping',
        nonce: Math.max(0, Math.floor((data as any).nonce))
      } as ClientMessage;
    }

    if (data.type === 'join') {
      const room = typeof (data as any).room === 'string' ? (data as any).room : 'pond-1';
      const name = typeof (data as any).name === 'string' ? (data as any).name : undefined;
      return {
        type: 'join',
        room,
        name
      } as ClientMessage;
    }

    return null;
  } catch {
    return null;
  }
}
