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
      const shoot = (data as any).shoot ? 1 : 0;
      const movementModelRaw = typeof (data as any).movementModel === 'string' ? (data as any).movementModel : undefined;
      const movementModel = movementModelRaw === 'skateSteering' || movementModelRaw === 'desiredHeadingTraction'
        ? movementModelRaw
        : undefined;
      const aimAngle = typeof data.aimAngle === 'number' ? data.aimAngle : undefined;
      const aimAngleRaw = typeof (data as any).aimAngleRaw === 'number' ? (data as any).aimAngleRaw : undefined;
      const aimDistance01Raw = typeof (data as any).aimDistance01 === 'number' ? (data as any).aimDistance01 : undefined;
      const aimDistance01 = typeof aimDistance01Raw === 'number'
        ? Math.max(0, Math.min(1, aimDistance01Raw))
        : undefined;
      const bodyTurnRaw = typeof (data as any).bodyTurn === 'number' ? (data as any).bodyTurn : undefined;
      const bodyTurn = typeof bodyTurnRaw === 'number'
        ? Math.max(-1, Math.min(1, bodyTurnRaw))
        : undefined;

      return {
        type: 'input',
        clientId: data.clientId,
        seq: Math.max(0, Math.floor(data.seq)),
        moveX,
        moveY,
        movementModel,
        sprint,
        brake,
        shoot,
        aimAngle,
        aimAngleRaw,
        aimDistance01,
        bodyTurn
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
