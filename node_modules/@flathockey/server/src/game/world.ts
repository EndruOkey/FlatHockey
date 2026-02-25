import Matter from 'matter-js';
import { COLLISION } from '@flathockey/shared/constants/collision';

export const RINK = {
  left: -1000,
  right: 1000,
  top: -550,
  bottom: 550,
  goalHalfHeight: 120,
  creaseDepth: 100
};

export function createWorld() {
  const engine = Matter.Engine.create({ gravity: { x: 0, y: 0 } });
  const world = engine.world;

  const wallThickness = 40;
  const midGoalGapTop = -RINK.goalHalfHeight;
  const midGoalGapBottom = RINK.goalHalfHeight;

  const walls = [
    Matter.Bodies.rectangle(0, RINK.top - wallThickness / 2, RINK.right - RINK.left + wallThickness * 2, wallThickness, {
      isStatic: true,
      label: 'wall-top',
      collisionFilter: { category: COLLISION.RINK, mask: COLLISION.PLAYER | COLLISION.PUCK }
    }),
    Matter.Bodies.rectangle(0, RINK.bottom + wallThickness / 2, RINK.right - RINK.left + wallThickness * 2, wallThickness, {
      isStatic: true,
      label: 'wall-bottom',
      collisionFilter: { category: COLLISION.RINK, mask: COLLISION.PLAYER | COLLISION.PUCK }
    }),
    Matter.Bodies.rectangle(RINK.left - wallThickness / 2, (RINK.top + midGoalGapTop) / 2, wallThickness, midGoalGapTop - RINK.top, {
      isStatic: true,
      label: 'wall-left-top',
      collisionFilter: { category: COLLISION.RINK, mask: COLLISION.PLAYER | COLLISION.PUCK }
    }),
    Matter.Bodies.rectangle(RINK.left - wallThickness / 2, (midGoalGapBottom + RINK.bottom) / 2, wallThickness, RINK.bottom - midGoalGapBottom, {
      isStatic: true,
      label: 'wall-left-bottom',
      collisionFilter: { category: COLLISION.RINK, mask: COLLISION.PLAYER | COLLISION.PUCK }
    }),
    Matter.Bodies.rectangle(RINK.right + wallThickness / 2, (RINK.top + midGoalGapTop) / 2, wallThickness, midGoalGapTop - RINK.top, {
      isStatic: true,
      label: 'wall-right-top',
      collisionFilter: { category: COLLISION.RINK, mask: COLLISION.PLAYER | COLLISION.PUCK }
    }),
    Matter.Bodies.rectangle(RINK.right + wallThickness / 2, (midGoalGapBottom + RINK.bottom) / 2, wallThickness, RINK.bottom - midGoalGapBottom, {
      isStatic: true,
      label: 'wall-right-bottom',
      collisionFilter: { category: COLLISION.RINK, mask: COLLISION.PLAYER | COLLISION.PUCK }
    })
  ];

  const creases = [
    Matter.Bodies.rectangle(RINK.left + RINK.creaseDepth / 2, 0, RINK.creaseDepth, RINK.goalHalfHeight * 2.2, {
      isStatic: true,
      isSensor: true,
      label: 'crease-A',
      collisionFilter: { category: COLLISION.CREASE, mask: COLLISION.PUCK }
    }),
    Matter.Bodies.rectangle(RINK.right - RINK.creaseDepth / 2, 0, RINK.creaseDepth, RINK.goalHalfHeight * 2.2, {
      isStatic: true,
      isSensor: true,
      label: 'crease-B',
      collisionFilter: { category: COLLISION.CREASE, mask: COLLISION.PUCK }
    })
  ];

  Matter.Composite.add(world, [...walls, ...creases]);

  return { engine, world, walls, creases };
}
