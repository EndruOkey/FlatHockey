const WS_URL = process.env.WS_URL ?? 'ws://localhost:8080/ws2';
const PROTO = Number(process.env.WS_PROTO ?? 5);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function summarizeMessage(msg, clientId) {
  if (!msg || typeof msg !== 'object') {
    return { type: 'unknown' };
  }
  if (msg.type === 'snapshot') {
    const me = Array.isArray(msg.players) ? msg.players.find((player) => player.id === clientId) : null;
    return {
      type: msg.type,
      tick: msg.tick,
      serverTick: msg.serverTick,
      puckState: msg.puck?.state,
      puckOwnerId: msg.puck?.ownerId,
      myStickState: me?.stickState,
      myStickTimer: me?.stickTimer
    };
  }
  return {
    type: msg.type,
    room: msg.room ?? msg.roomId,
    code: msg.code
  };
}

async function createSession(label) {
  const state = {
    label,
    openedAt: null,
    closedAt: null,
    clientId: null,
    closeCode: null,
    closeReason: '',
    closeWasClean: null,
    lastReceived: null,
    lastSent: null,
    unexpectedClose: false
  };

  const ws = new WebSocket(WS_URL);
  state.ws = ws;

  ws.addEventListener('open', () => {
    state.openedAt = nowIso();
    console.log(`[MATRIX] OPEN label=${label} ts=${state.openedAt}`);
    send({
      type: 'hello',
      proto: PROTO,
      clientBuild: 'ws-matrix',
      name: `matrix-${label}`
    });
    setTimeout(() => send({ type: 'join', mode: 'pond', room: 'pond-1' }), 25);
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.type === 'welcome') {
      state.clientId = msg.clientId;
    }
    state.lastReceived = summarizeMessage(msg, state.clientId);
  });

  ws.addEventListener('close', (event) => {
    state.closedAt = nowIso();
    state.closeCode = event.code;
    state.closeReason = event.reason;
    state.closeWasClean = event.wasClean;
    state.unexpectedClose = event.code !== 1000;
    console.log(
      `[MATRIX] CLOSE label=${label} code=${event.code} reason=${event.reason} wasClean=${event.wasClean} lastSent=${JSON.stringify(state.lastSent)} lastReceived=${JSON.stringify(state.lastReceived)}`
    );
  });

  ws.addEventListener('error', (event) => {
    console.log(`[MATRIX] ERROR label=${label} type=${event.type}`);
  });

  function send(payload) {
    if (ws.readyState !== WebSocket.OPEN) return;
    state.lastSent = summarizeMessage(payload, state.clientId);
    if (payload.type === 'input') {
      state.lastSent.seq = payload.seq;
      state.lastSent.detail = [
        `move=(${payload.moveX ?? 0},${payload.moveY ?? 0})`,
        payload.pass ? 'pass' : null,
        payload.drop ? 'drop' : null,
        payload.poke ? 'poke' : null
      ]
        .filter(Boolean)
        .join(' ');
    }
    ws.send(JSON.stringify(payload));
  }

  async function waitForClientId(timeoutMs = 2000) {
    const start = Date.now();
    while (!state.clientId) {
      if (Date.now() - start > timeoutMs) throw new Error(`client id timeout for ${label}`);
      await delay(25);
    }
  }

  async function waitForHold(timeoutMs = 7000) {
    const start = Date.now();
    while (Date.now() - start <= timeoutMs) {
      if (state.lastReceived?.type === 'snapshot' && state.lastReceived.puckOwnerId === state.clientId) {
        return true;
      }
      await delay(25);
    }
    return false;
  }

  async function close(reason = 'done') {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, reason);
    }
    const start = Date.now();
    while (state.closedAt === null && Date.now() - start < 1500) {
      await delay(25);
    }
  }

  return {
    state,
    send,
    waitForClientId,
    waitForHold,
    close
  };
}

async function runCase(name, run) {
  const session = await createSession(name);
  await session.waitForClientId();
  try {
    await run(session);
  } catch (error) {
    console.error(`[MATRIX] CASE_ERROR name=${name}`, error);
  } finally {
    await session.close(name);
  }
  return {
    case: name,
    closeCode: session.state.closeCode,
    closeReason: session.state.closeReason,
    closeWasClean: session.state.closeWasClean,
    unexpectedClose: session.state.unexpectedClose,
    lastSent: session.state.lastSent,
    lastReceived: session.state.lastReceived
  };
}

async function sendInputBurst(session, frames) {
  for (const frame of frames) {
    session.send(frame);
    await delay(frame.delayMs ?? 120);
  }
}

async function main() {
  const results = [];

  results.push(await runCase('connect_only', async () => {
    await delay(800);
  }));

  results.push(await runCase('idle_only', async (session) => {
    await sendInputBurst(session, [
      { type: 'input', seq: 1, moveX: 0, moveY: 0, aimAngle: 0, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 300 },
      { type: 'input', seq: 2, moveX: 0, moveY: 0, aimAngle: 0, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 300 }
    ]);
    await delay(600);
  }));

  results.push(await runCase('movement_only', async (session) => {
    await sendInputBurst(session, [
      { type: 'input', seq: 1, moveX: 1, moveY: 1, aimAngle: 0.5, shoot: false, pass: false, drop: false, poke: false, stop: false },
      { type: 'input', seq: 2, moveX: 1, moveY: 1, aimAngle: 0.5, shoot: false, pass: false, drop: false, poke: false, stop: false },
      { type: 'input', seq: 3, moveX: 0, moveY: 0, aimAngle: 0.5, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 300 }
    ]);
  }));

  results.push(await runCase('pass_only', async (session) => {
    await sendInputBurst(session, [
      { type: 'input', seq: 1, moveX: 0, moveY: 0, aimAngle: 0.25, shoot: false, pass: true, drop: false, poke: false, stop: false, delayMs: 180 },
      { type: 'input', seq: 2, moveX: 0, moveY: 0, aimAngle: 0.25, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 400 }
    ]);
  }));

  results.push(await runCase('drop_only', async (session) => {
    await sendInputBurst(session, [
      { type: 'input', seq: 1, moveX: 0, moveY: 0, aimAngle: 0.25, shoot: false, pass: false, drop: true, poke: false, stop: false, delayMs: 180 },
      { type: 'input', seq: 2, moveX: 0, moveY: 0, aimAngle: 0.25, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 400 }
    ]);
  }));

  results.push(await runCase('poke_only', async (session) => {
    await sendInputBurst(session, [
      { type: 'input', seq: 1, moveX: 0, moveY: 0, aimAngle: 0.25, shoot: false, pass: false, drop: false, poke: true, stop: false, delayMs: 180 },
      { type: 'input', seq: 2, moveX: 0, moveY: 0, aimAngle: 0.25, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 400 }
    ]);
  }));

  results.push(await runCase('held_puck_movement', async (session) => {
    let seq = 1;
    const moveTowardPuck = setInterval(() => {
      session.send({
        type: 'input',
        seq: seq++,
        moveX: 1,
        moveY: 1,
        aimAngle: 0.75,
        shoot: false,
        pass: false,
        drop: false,
        poke: false,
        stop: false
      });
    }, 90);

    const held = await session.waitForHold();
    clearInterval(moveTowardPuck);

    if (!held) {
      console.log('[MATRIX] held_puck_movement could not acquire puck within timeout');
      return;
    }

    await sendInputBurst(session, [
      { type: 'input', seq: seq++, moveX: -1, moveY: 0, aimAngle: 0.2, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 180 },
      { type: 'input', seq: seq++, moveX: 0, moveY: -1, aimAngle: 1.4, shoot: false, pass: false, drop: false, poke: false, stop: false, delayMs: 180 },
      { type: 'input', seq: seq++, moveX: 0, moveY: 0, aimAngle: 1.4, shoot: false, pass: false, drop: true, poke: false, stop: false, delayMs: 250 }
    ]);
  }));

  results.push(await runCase('reconnect_after_disconnect', async (session) => {
    await delay(300);
    await session.close('reconnect_step_1');
    const reconnect = await createSession('reconnect_after_disconnect_second');
    await reconnect.waitForClientId();
    await delay(600);
    results.push({
      case: 'reconnect_after_disconnect_second',
      closeCode: reconnect.state.closeCode,
      closeReason: reconnect.state.closeReason,
      closeWasClean: reconnect.state.closeWasClean,
      unexpectedClose: reconnect.state.unexpectedClose,
      lastSent: reconnect.state.lastSent,
      lastReceived: reconnect.state.lastReceived
    });
    await reconnect.close('reconnect_step_2');
  }));

  console.log('[MATRIX] SUMMARY');
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error('[MATRIX] FATAL', error);
  process.exitCode = 1;
});
