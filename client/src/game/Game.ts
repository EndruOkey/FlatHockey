import { Application, Container, Text } from 'pixi.js';
import { Camera }      from './camera/Camera';
import { Rink }        from './world/Rink';
import { PlayerView }  from './entities/PlayerView';
import { PuckView }    from './entities/PuckView';
import { InputHandler } from './input/InputHandler';
import { WsClient }    from './net/WsClient';
import { COLORS }      from '../config/constants';
import type { SnapshotMsg } from '@flathockey/shared';

export class Game {
  private app:    Application;
  private camera: Camera;
  private ws:     WsClient;
  private input:  InputHandler;

  // Scene graph
  private world  = new Container(); // world-space container
  private rink:    Rink;
  private puck:    PuckView;
  private players  = new Map<string, PlayerView>();

  // HUD (screen-space)
  private hudText: Text;

  // State
  private clientId:  string | null = null;
  private latestSnap: SnapshotMsg | null = null;
  private playerOrder: string[] = []; // track join order for team assignment

  constructor(app: Application) {
    this.app    = app;
    this.camera = new Camera(app);
    this.ws     = new WsClient();
    this.input  = new InputHandler(app.canvas as HTMLCanvasElement);

    // World → screen via camera
    this.camera.applyTo(this.world);
    app.stage.addChild(this.world);

    window.addEventListener('resize', () => {
      this.camera.resize(this.app.screen.width, this.app.screen.height);
      this.camera.applyTo(this.world);
    });

    // Static rink
    this.rink = new Rink();
    this.world.addChild(this.rink.container);

    // Puck (above rink, below players)
    this.puck = new PuckView();
    this.world.addChild(this.puck.container);

    // HUD (screen-space, not part of world)
    this.hudText = new Text({
      text: 'Connecting...',
      style: { fontSize: 13, fill: COLORS.hud, fontFamily: 'monospace', dropShadow: true, dropShadowDistance: 1, dropShadowAlpha: 0.5 },
    });
    this.hudText.position.set(12, 10);
    app.stage.addChild(this.hudText);

    // Wire up WS
    this.ws.onStatus   = (msg) => { this.hudText.text = msg; };
    this.ws.onWelcome  = (id)  => { this.clientId = id; this.hudText.text = ''; };
    this.ws.onSnapshot = (snap) => { this.latestSnap = snap; };

    this.ws.connect();
    app.ticker.add(this.tick.bind(this));
  }

  private tick(ticker: { deltaMS: number }) {
    const dtMs  = ticker.deltaMS;

    // Build & send input
    if (this.clientId && this.latestSnap) {
      const local = this.latestSnap.players.find(p => p.id === this.clientId);
      if (local) {
        const inp = this.input.buildInput(local.x, local.y, this.camera, dtMs);
        this.ws.sendInput(inp, dtMs);
      }
    }

    // Apply snapshot
    if (this.latestSnap) this.applySnapshot(this.latestSnap);
  }

  private applySnapshot(snap: SnapshotMsg) {
    const seen = new Set<string>();

    for (const p of snap.players) {
      seen.add(p.id);

      // Track join order for team color assignment
      if (!this.playerOrder.includes(p.id)) {
        this.playerOrder.push(p.id);
      }

      // Create view if new
      if (!this.players.has(p.id)) {
        const isLocal  = p.id === this.clientId;
        const teamColor = this.resolveTeamColor(p.id);
        const view = new PlayerView(isLocal, teamColor);
        this.world.addChild(view.container);
        this.players.set(p.id, view);
      }

      // Update
      const view = this.players.get(p.id)!;
      view.setTeamColor(this.resolveTeamColor(p.id));
      view.update(p);
    }

    // Remove gone players
    for (const [id, view] of this.players) {
      if (!seen.has(id)) {
        this.world.removeChild(view.container);
        this.players.delete(id);
        const idx = this.playerOrder.indexOf(id);
        if (idx !== -1) this.playerOrder.splice(idx, 1);
      }
    }

    // Update puck
    if (snap.puck && snap.puck.x != null) {
      this.puck.update(snap.puck);
    }
  }

  /** Alternate team colors by join order — odd = team A, even = team B */
  private resolveTeamColor(id: string): number {
    const idx = this.playerOrder.indexOf(id);
    return idx % 2 === 0 ? COLORS.teamA : COLORS.teamB;
  }
}
