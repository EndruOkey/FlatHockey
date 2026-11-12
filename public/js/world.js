import { makeRng } from './rng.js';
import { PLAYER } from './constants.js';

export class World {
  constructor(entities, seed = 1) {
    this.seed = seed >>> 0;
    this.rng  = makeRng(this.seed);   // jediný zdroj náhody simulace
    this.tick = 0;                    // počet ticků world.update (deterministické časování)
    this.entities = entities;
    this._attachRng();
    this.authoritative = true;      // false on P2P guest — skips puck physics
    this.onGoal    = null;          // (result) => void
    this.onWhistle = null;          // ({ reason, team? }) => void
    this.onResolveInteractions = null;
    this._goalLock    = false;
    this._whistleCool = 0;          // prevent whistle spam
  }

  _attachRng() { for (const e of this.entities) e.rng = this.rng; }

  // FÉROVÉ POŘADÍ o puk (2026-11-09): kdo má čepel nejblíž puku, zkouší první (obrání / tečování / převzetí).
  // Dřív pevné pořadí seznamu = při souběhu vždy vyhrál dřív přidaný tým (domácí; balanc 120 zápasů 1,98×).
  // Shodu vzdálenosti rozhodne rotace podle ticku — deterministické, bez zvýhodnění strany.
  _fair(puck) {
    this._ft = (this._ft || 0) + 1;
    const n = this.players.length, off = this._ft % Math.max(1, n);
    return this.players.map((p, i) => ({ p, d: Math.hypot(p.stickTip.x - puck.x, p.stickTip.y - puck.y), r: (i - off + n) % n }))
      .sort((a, b) => (a.d - b.d) || (a.r - b.r)).map(o => o.p);
  }

  // SOUBOJ HOLÍ (deterministický): čepel soupeře na puku sbírá tlak z relativní rychlosti čepel×puk.
  // Kontrola nosiče klesá s rychlostí jízdy a delší holí. Puk vyskočí ve směru tahu útočníkovy čepele.
  _stickFight(carrier, puck, dt) {
    const pvx = carrier.vx, pvy = carrier.vy;
    const spd = Math.hypot(carrier.vx, carrier.vy), reach = carrier._dispReach ?? PLAYER.stickLen;
    const ctrl = PLAYER.fightCtrl * (1 - 0.4 * Math.min(1, spd / 165)) * (1 + 0.6 * Math.max(0, 1 - reach / PLAYER.stickLen));
    const graceOk = (carrier._possT ?? 99) >= PLAYER.stealGrace;
    for (const p of this._fair(puck)) {
      if (p === carrier || p.team === carrier.team) continue;
      const tip = p.stickTip, prev = p._tipPrev;
      if (graceOk && p.canSteal(puck, carrier)) {
        const tvx = prev ? (tip.x - prev.x) / dt : 0, tvy = prev ? (tip.y - prev.y) / dt : 0;
        const rx = tvx - pvx, ry = tvy - pvy, rel = Math.hypot(rx, ry);
        p._press = (p._press || 0) + (rel + PLAYER.fightBase) * dt;
        if (p._press > ctrl) {
          p.stealFrom(carrier, puck);
          const k = rel > 1 ? 1 / rel : 0, dir = carrier.carryAngle ?? 0;
          puck.vx = pvx + (k ? rx * k : Math.cos(dir)) * 90; puck.vy = pvy + (k ? ry * k : Math.sin(dir)) * 90;
          for (const q of this.players) q._press = 0;
          break;
        }
      } else p._press = Math.max(0, (p._press || 0) - PLAYER.fightDecay * dt);
    }
  }

  update(dt) {
    this.tick++;
    this._attachRng();   // entity přidané po konstrukci (hráči, boti)
    { const pl = this.players; for (const p of pl) p._others = pl; }   // hokejka se zastaví o tělo / hokejku ostatních (stickTip)
    for (const e of this.entities) e.update(dt, this);
    if (this.authoritative) this._resolveInteractions(dt);
    for (const p of this.players) { const t = p.stickTip; p._tipPrev = { x: t.x, y: t.y }; }   // rychlost čepele pro souboj holí
    if (this._whistleCool > 0) this._whistleCool -= dt;
  }

  draw(ctx, cam) {
    ctx.fillStyle = '#07090f';
    ctx.fillRect(0, 0, ctx.canvas.cssW || ctx.canvas.width, ctx.canvas.cssH || ctx.canvas.height);
    for (const e of this.entities) e.draw(ctx, cam);
    for (const e of this.entities) e.drawFront?.(ctx, cam, this.puck, this.entities.filter(g => g.netX != null && g.inX != null));   // přední vrstva branky (Rink.drawFront)
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
    for (const p of players) p._puckRef = puck;   // crosscheck potřebuje puk (odstrčí ho nositeli z hole)
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
        if (d < g.radius + (p.radius ?? 7) + 2) {   // jen SKUTEČNÝ dotyk (dřív +12 px = píšťalka i bez kontaktu → hráč „fauloval" omylem u brankoviště)
          this.whistle('goalie-interference', p.team);
        }
      }
    }

    const carrier = this.players.find(p => p.hasPuck);
    if (carrier) {
      if (PLAYER.fight) this._stickFight(carrier, puck, dt);
      else if ((carrier._possT ?? 99) >= PLAYER.stealGrace) for (const p of this._fair(puck)) {
        if (p === carrier || p.team === carrier.team) continue;
        if (p.canSteal(puck, carrier)) { p.stealFrom(carrier, puck); break; }   // (iteruje _fair: nejbližší čepel první)
      }
    } else {
      for (const g of this.goalies) g.blockPuck(puck, this);
      for (const p of this._fair(puck)) if (p.tryDeflect(puck)) break;
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
        for (const p of this._fair(puck)) {
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
