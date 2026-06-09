export class World {
  constructor(entities) {
    this.entities = entities;
    this.authoritative = true;      // false on P2P guest — skips puck physics
    this.onGoal = null;             // (result: 'goal-home' | 'goal-away') => void
    this.onResolveInteractions = null; // optional per-mode override
    this._goalLock = false;         // true while a goal celebration runs (puck sits in net)
  }

  update(dt) {
    for (const e of this.entities) e.update(dt, this);
    if (this.authoritative) this._resolveInteractions();
  }

  draw(ctx, cam) {
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (const e of this.entities) e.draw(ctx, cam);
  }

  get puck()    { return this.entities.find(e => e.isPuck)   ?? null; }
  get players() { return this.entities.filter(e => e.isPlayer); }
  get goalies() { return this.entities.filter(e => e.isGoalie); }

  _resolveInteractions() {
    if (this.onResolveInteractions) {
      this.onResolveInteractions(this);
      return;
    }

    const puck = this.puck;
    if (!puck) return;

    // Během oslavy gólu necháme puk dojet do sítě — žádné interakce ani re-detekce
    if (this._goalLock) return;

    for (const g of this.goalies) {
      for (const p of this.players) g.blockPlayer(p);
      for (const p of this.players) g.pokeCheck(p, puck);
    }

    // Cross-check + souboje těl (clona/box-out) mezi dvojicemi hráčů
    const players = this.players;
    for (let i = 0; i < players.length; i++)
      for (let j = 0; j < players.length; j++)
        if (i !== j) players[i].tryCrossCheck(players[j]);
    for (let i = 0; i < players.length; i++)
      for (let j = i + 1; j < players.length; j++)
        players[i].collideWith(players[j]);

    const carrier = this.players.find(p => p.hasPuck);
    if (carrier) {
      // STEAL — soupeř s holí na puku ho obere (puk je u nositelovy hole)
      for (const p of this.players) {
        if (p === carrier || p.team === carrier.team) continue;
        if (p.canSteal(puck)) { p.stealFrom(carrier, puck); break; }
      }
    } else {
      for (const g of this.goalies) g.blockPuck(puck, this);
      // Tečování letícího puku hokejkou hráče (dorážky/teče)
      for (const p of this.players) if (p.tryDeflect(puck)) break;
      // Goalie covers a slow loose puck sitting in the crease (no need to skate into it)
      for (const g of this.goalies) g.controlLoosePuck(puck);

      const goalieHolding = this.goalies.some(g => g.isHolding);
      if (!goalieHolding) {
        for (const p of this.players) {
          if (p.tryPickup(puck)) break;
        }
      }
    }

    // Gól vyhodnocuje fyzika puku (puck.goalScored); puk zůstává v síti, reset po oslavě
    if (puck.goalScored) {
      this._goalLock = true;
      this.onGoal?.(puck.goalScored);
    }
  }
}
