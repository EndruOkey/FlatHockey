import { Container, Graphics } from 'pixi.js';
import { RINK, LINES, GOAL, FACEOFF_DOTS, COLORS } from '../../config/constants';

export class Rink {
  readonly container = new Container();

  constructor() {
    this.draw();
  }

  private draw() {
    const g = new Graphics();

    const L = RINK.left, R = RINK.right, T = RINK.top, B = RINK.bottom;
    const cr = RINK.cornerRadius;

    // --- Ice surface ---
    g.roundRect(L, T, RINK.width, RINK.height, cr).fill(COLORS.ice);

    // --- Creases (before goal lines so they're under lines) ---
    this.drawCrease(g, LINES.goalLeft,  -1); // left goal, opens toward center (+x)
    this.drawCrease(g, LINES.goalRight,  1); // right goal, opens toward center (-x)

    // --- Center circle ---
    g.circle(0, 0, LINES.centerCircleRadius)
      .stroke({ color: COLORS.centerLine, width: 2, alpha: 0.85 });

    // --- Center dot ---
    g.circle(0, 0, 5).fill(COLORS.centerLine);

    // --- Center line (red, dashed) ---
    this.drawDashedLine(g, 0, T + cr * 0.4, 0, B - cr * 0.4, COLORS.centerLine, 3, 14, 8);

    // --- Blue lines ---
    g.rect(LINES.blueLeft - 3,  T, 6, RINK.height).fill(COLORS.blueLine);
    g.rect(LINES.blueRight - 3, T, 6, RINK.height).fill(COLORS.blueLine);

    // --- Goal lines ---
    g.rect(LINES.goalLeft  - 1, T, 2, RINK.height).fill({ color: COLORS.goalLine, alpha: 0.9 });
    g.rect(LINES.goalRight - 1, T, 2, RINK.height).fill({ color: COLORS.goalLine, alpha: 0.9 });

    // --- Faceoff dots ---
    for (const [x, y] of FACEOFF_DOTS) {
      g.circle(x, y, LINES.faceoffCircleRadius)
        .stroke({ color: COLORS.dot, width: 1.5, alpha: 0.7 });
      g.circle(x, y, 5).fill(COLORS.dot);

      // NHL-style hash marks inside faceoff circles
      const fr = LINES.faceoffCircleRadius;
      const hashH = 14;
      const hashX = fr * 0.68;
      g.moveTo(x - hashX, y - hashH / 2).lineTo(x - hashX, y + hashH / 2)
        .stroke({ color: COLORS.dot, width: 2, alpha: 0.65 });
      g.moveTo(x + hashX, y - hashH / 2).lineTo(x + hashX, y + hashH / 2)
        .stroke({ color: COLORS.dot, width: 2, alpha: 0.65 });
    }

    // --- Goals ---
    this.drawGoal(g, LINES.goalLeft,  -1); // left net opens right
    this.drawGoal(g, LINES.goalRight,  1); // right net opens left

    // --- Boards (rink border) ---
    g.roundRect(L, T, RINK.width, RINK.height, cr)
      .stroke({ color: COLORS.boards, width: 6 });

    this.container.addChild(g);
  }

  /** D-shaped crease in front of goal.
   *  side: -1 = left goal (crease extends right), +1 = right goal (crease extends left) */
  private drawCrease(g: Graphics, goalX: number, side: number) {
    const r = LINES.creaseRadius;
    const openDir = -side; // crease opens toward center
    const cx = goalX + openDir * r;
    g.ellipse(cx, 0, r, r * 0.72)
      .fill({ color: COLORS.crease, alpha: COLORS.creaseAlpha });
    g.ellipse(cx, 0, r, r * 0.72)
      .stroke({ color: COLORS.blueLine, width: 1.2, alpha: 0.6 });
  }

  /** Net behind goal line */
  private drawGoal(g: Graphics, goalX: number, side: number) {
    const hw = GOAL.width / 2;
    const depth = GOAL.depth * side; // extends away from center

    // Back of net (opposite side from center)
    const netX = goalX + depth;

    // Net frame
    g.moveTo(goalX, -hw)
      .lineTo(netX, -hw)
      .lineTo(netX,  hw)
      .lineTo(goalX,  hw)
      .stroke({ color: 0xffffff, width: 2.5, alpha: 0.9 });

    // Net fill
    g.rect(
      Math.min(goalX, netX),
      -hw,
      Math.abs(depth),
      GOAL.width
    ).fill({ color: 0xffffff, alpha: 0.08 });

    // Net mesh lines (horizontal)
    const meshStep = 10;
    for (let y = -hw + meshStep; y < hw; y += meshStep) {
      g.moveTo(goalX, y).lineTo(netX, y)
        .stroke({ color: 0xffffff, width: 0.6, alpha: 0.25 });
    }
    // Net mesh (vertical)
    const meshStepX = Math.abs(depth) / 3;
    for (let i = 1; i <= 2; i++) {
      const mx = goalX + (depth / 3) * i;
      g.moveTo(mx, -hw).lineTo(mx, hw)
        .stroke({ color: 0xffffff, width: 0.6, alpha: 0.25 });
    }

    // Goal posts (red circles at corners)
    g.circle(goalX, -hw, GOAL.postR).fill(0xdd0000);
    g.circle(goalX,  hw, GOAL.postR).fill(0xdd0000);
  }

  /** Manual dashed line — Pixi v8 has no native dash support */
  private drawDashedLine(
    g: Graphics,
    x1: number, y1: number,
    x2: number, y2: number,
    color: number,
    width: number,
    dashLen = 18,
    gapLen = 14
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const nx = dx / len;
    const ny = dy / len;
    let pos = 0;
    let drawing = true;

    while (pos < len) {
      const segLen = Math.min(drawing ? dashLen : gapLen, len - pos);
      if (drawing) {
        const ax = x1 + nx * pos;
        const ay = y1 + ny * pos;
        const bx = ax + nx * segLen;
        const by = ay + ny * segLen;
        g.moveTo(ax, ay).lineTo(bx, by)
          .stroke({ color, width, alpha: 0.85 });
      }
      pos += segLen;
      drawing = !drawing;
    }
  }
}
