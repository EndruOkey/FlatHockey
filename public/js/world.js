export class World {
  constructor(entities) {
    this.entities = entities;
    this.authoritative = true;      // false on P2P guest — skips puck physics
    this.onGoal    = null;          // (result) => void
    this.onWhistle = null;          // ({ reason, team? }) => void
    this.onResolveInteractions = null;
    this._goalLock    = false;
    this._whistleCool = 0;          // prevent whistle spam
  }

  update(dt) {
    for (const e of this.entities) e.update(dt, this);
    if (this.authoritative) this._resolveInteractions(dt);
    if (this._whistleCool > 0) this._whistleCool -= dt;
  }

  draw(ctx, cam) {
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const e of this.entities) e.draw(ctx, cam);
  }

  get puck()    { return this.entities.find(e => e.isPuck)   ?? null; }
  get players() { return this.entities.filter(e => e.isPlayer); }
  get goalies() { return this.entities.filter(e => e.isGoalie); }

  // Trigger a whistle (rules/sandbox) — debounced
  whistle(reason, team) {
    if (this._whistleCool > 0 || this._goalLock) return;
    this._whistleCool = 2.0;
    this.onWhistle?.({ reason, team });
  }

  _resolveInteractions(dt = 0) {
    if (this.onResolveInteractions) {
      this.onResolveInteractions(this);
      return;
    }

    const puck = this.puck;
    if (!puck) return;
    if (this._goalLock) return;

    for (const g of this.goalies) {
      for (const p of this.players) g.blockPlayer(p);
      for (const p of this.players) g.pokeCheck(p, puck);
    }

    // Cross-check + kolize mezi hráči
    const players = this.players;
    for (let i = 0; i < players.length; i++)
      for (let j = 0; j < players.length; j++)
        if (i !== j) players[i].tryCrossCheck(players[j]);
    for (let i = 0; i < players.length; i++)
      for (let j = i + 1; j < players.length; j++)
        players[i].collideWith(players[j]);

    // Najíždění do golmana crosscheckem → whistle
    for (const p of players) {
      if (!p.crossCheck || p._crossCheckCool > 0.4) continue;  // čerstvý crosscheck
      for (const g of this.goalies) {
        if (p.team === g.team) continue;
        const d = Math.hypot(p.x - g.x, p.y - g.y);
        if (d < (p.radius ?? 7) + 12) {
          this.whistle('goalie-interference', p.team);
        }
      }
    }

    const carrier = this.players.find(p => p.hasPuck);
    if (carrier) {
      for (const p of this.players) {
        if (p === carrier || p.team === carrier.team) continue;
        if (p.canSteal(puck)) { p.stealFrom(carrier, puck); break; }
      }
    } else {
      for (const g of this.goalies) g.blockPuck(puck, this);
      for (const p of this.players) if (p.tryDeflect(puck)) break;
      for (const g of this.goalies) g.controlLoosePuck(puck);

      // Golman drží puk → odpískat po 3.5 s (i bez rules → auto-release + whistle efekt)
      for (const g of this.goalies) {
        if (g.isHolding && g._holdingTotal !== undefined) {
          g._holdingTotal += dt;
          if (g._holdingTotal >= 3.5) {
            g._holdingTotal = 0;
            this.whistle('goalie-hold', g.team);
          }
        } else if (g.isHolding) {
          g._holdingTotal = 0;
        } else {
          g._holdingTotal = 0;
        }
      }

      const goalieHolding = this.goalies.some(g => g.isHolding);
      if (!goalieHolding) {
        for (const p of this.players) {
          if (p.tryPickup(puck)) break;
        }
      }
    }

    if (puck.goalScored) {
      this._goalLock = true;
      this.onGoal?.(puck.goalScored);
    }
  }
}
