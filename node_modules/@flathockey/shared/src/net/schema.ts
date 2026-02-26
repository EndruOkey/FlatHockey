import type { ClientMessage } from './messages';

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const data = JSON.parse(raw) as Partial<ClientMessage>;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return null;

    if (data.type === 'input') {
      if (typeof data.clientId !== 'string') return null;
      if (typeof data.seq !== 'number') return null;
      if (typeof data.moveX !== 'number' || typeof data.moveY !== 'number') return null;
      if (typeof data.sprint !== 'number' || typeof data.brake !== 'number') return null;

      const moveX = data.moveX < 0 ? -1 : data.moveX > 0 ? 1 : 0;
      const moveY = data.moveY < 0 ? -1 : data.moveY > 0 ? 1 : 0;
      const sprint = data.sprint ? 1 : 0;
      const brake = data.brake ? 1 : 0;
      const aimAngle = typeof data.aimAngle === 'number' ? data.aimAngle : undefined;

      return {
        type: 'input',
        clientId: data.clientId,
        seq: Math.max(0, Math.floor(data.seq)),
        moveX,
        moveY,
        sprint,
        brake,
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

    return null;
  } catch {
    return null;
  }
}
