import type { ClientMessage } from './messages';

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as Partial<ClientMessage>;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return null;

    if (data.type === 'input') {
      if (typeof data.clientId !== 'string') return null;
      if (typeof data.seq !== 'number') return null;
      const shoot = (data as any).shoot ? 1 : 0;
      const aimAngle = typeof data.aimAngle === 'number' ? data.aimAngle : undefined;

      return {
        type: 'input',
        clientId: data.clientId,
        seq: Math.max(0, Math.floor(data.seq)),
        shoot,
        aimAngle
      };
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
