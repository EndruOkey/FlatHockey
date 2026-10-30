import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { loginDiscordUser, getUserById, getProfile, saveProfile, getStats, getUserIdByIdentity, createGuestUser, userHasIdentity, isGuestUser, setGuestName, createLinkCode, redeemLinkCode, loginCrazyGamesUser } from './db.js';

const router = express.Router();

// env vars čteme lazy uvnitř handlerů — ESM hoisting způsobuje undefined při top-level destructuringu
const e = () => process.env;

const JWT_COOKIE = 'fh_session';
const JWT_TTL    = 60 * 60 * 24 * 30; // 30 dní

// ── Helpers ───────────────────────────────────────────────────────────────────

function signJwt(user_id) {
  return jwt.sign({ sub: user_id }, e().JWT_SECRET, { expiresIn: JWT_TTL });
}

function setCookie(res, token) {
  res.cookie(JWT_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: JWT_TTL * 1000,
  });
}

const DEVICE_TTL = 60 * 60 * 24 * 365 * 5; // 5 let

/** Token zařízení: kind:'device', did = identita zařízení (provider 'device'). Účet se hledá přes identities,
 *  takže token přežije sloučení hosta do Discord účtu (identita se jen přepojí). */
export function signDeviceToken(did, userId) {
  return jwt.sign({ sub: userId, kind: 'device', did }, e().JWT_SECRET, { expiresIn: DEVICE_TTL });
}

/** Vrátí userId z cookie JWT (bez kind) nebo z device tokenu (přes identities); jinak null. */
export function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const c = jwt.verify(token, e().JWT_SECRET);
    if (c.kind === 'device') {
      const uid = typeof c.did === 'string' ? getUserIdByIdentity('device', c.did) : null;
      return uid && getUserById(uid) ? uid : null;
    }
    return c.sub ?? null;
  } catch { return null; }
}

/** Ověřený device token → { userId, did } nebo null (pro OAuth state). */
export function verifyDeviceToken(token) {
  try {
    const c = jwt.verify(token, e().JWT_SECRET);
    if (c.kind !== 'device' || typeof c.did !== 'string') return null;
    const userId = getUserIdByIdentity('device', c.did);
    return userId ? { userId, did: c.did } : null;
  } catch { return null; }
}

/** Nový hostující účet + podepsaný token. */
export function createGuestAccount() {
  const did = crypto.randomUUID();
  const userId = createGuestUser(did);
  return { userId, token: signDeviceToken(did, userId) };
}

export function bearerToken(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  return m ? m[1] : null;
}

/** Bearer má přednost; cookie jen když bearer chybí. */
export function requireAuth(req, res, next) {
  const bearer = bearerToken(req);
  if (bearer) {
    const uid = verifySession(bearer);
    if (!uid) return res.status(401).json({ error: 'invalid_token' });
    req.userId = uid; req.viaBearer = true;
    return next();
  }
  const token = req.cookies?.[JWT_COOKIE];
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  const uid = verifySession(token);
  if (!uid) { res.clearCookie(JWT_COOKIE); return res.status(401).json({ error: 'invalid_session' }); }
  req.userId = uid;
  next();
}

// ── Podepsaný OAuth state: nonce + (ověřený) host z tohoto zařízení ───────────
const b64u = (b) => Buffer.from(b).toString('base64url');
const stateMac = (data) => crypto.createHmac('sha256', e().JWT_SECRET + '::oauth-state').update(data).digest('base64url');
export function signOAuthState(nonce, guestId, exp = Date.now() + 600_000) {
  const data = b64u(JSON.stringify({ n: nonce, g: guestId || null, x: exp }));
  return data + '.' + stateMac(data);
}
export function verifyOAuthState(state, now = Date.now()) {
  if (typeof state !== 'string') return null;
  const [data, mac, extra] = state.split('.');
  if (!data || !mac || extra !== undefined) return null;
  const want = Buffer.from(stateMac(data)), got = Buffer.from(mac);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (typeof p.n !== 'string' || !(p.x > now)) return null;
    return { nonce: p.n, guestId: p.g ?? null };
  } catch { return null; }
}

// ── Discord OAuth ─────────────────────────────────────────────────────────────

// CSRF state store (in-memory, expires in 10 min)
const oauthStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates) if (v < now) oauthStates.delete(k);
}, 60_000);

router.get('/discord', (req, res) => {
  // ?dt = device token hosta; ověříme ho a jeho userId zapečeme do podepsaného state
  const dev = typeof req.query.dt === 'string' ? verifyDeviceToken(req.query.dt) : null;
  const nonce = crypto.randomBytes(16).toString('hex');
  oauthStates.set(nonce, Date.now() + 600_000);
  const state = signOAuthState(nonce, dev && isGuestUser(dev.userId) ? dev.userId : null);
  const params = new URLSearchParams({
    client_id: e().DISCORD_CLIENT_ID,
    redirect_uri: e().DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  const BASE_URL = e().BASE_URL || 'https://flathockey.fun';
  const st = verifyOAuthState(state);
  if (!code || !st || !oauthStates.has(st.nonce)) {
    return res.redirect(`${BASE_URL}/?auth_error=invalid_state`);
  }
  oauthStates.delete(st.nonce);

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: e().DISCORD_CLIENT_ID,
        client_secret: e().DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: e().DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('no access_token');

    const authHeader = `Bearer ${tokenData.access_token}`;

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: authHeader },
    });
    if (!userRes.ok) throw new Error(`Discord /users/@me ${userRes.status}`);
    const discordUser = await userRes.json();
    if (!discordUser.id) throw new Error('Discord user missing id');

    let is_sponsor = false;
    const sponsorRoleId = e().DISCORD_SPONSOR_ROLE_ID?.trim();
    const guildId = e().DISCORD_GUILD_ID?.trim();
    if (sponsorRoleId && guildId) {
      try {
        const memberRes = await fetch(
          `https://discord.com/api/users/@me/guilds/${guildId}/member`,
          { headers: { Authorization: authHeader } }
        );
        if (memberRes.ok) {
          const member = await memberRes.json();
          is_sponsor = member.roles?.includes(sponsorRoleId) ?? false;
        }
      } catch { /* guild check nepovinný */ }
    }

    const avatar_url = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.webp?size=64`
      : null;

    const user_id = loginDiscordUser({
      discord_id: discordUser.id,
      display_name: discordUser.global_name || discordUser.username,
      avatar_url,
      is_sponsor,
    }, st.guestId);

    setCookie(res, signJwt(user_id));
    res.redirect(`${BASE_URL}/?auth_ok=1`);
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.redirect(`${e().BASE_URL || 'https://flathockey.fun'}/?auth_error=discord_failed`);
  }
});

// ── CrazyGames: výměna CG JWT (RS256, JWKS) za náš device token ──────────────
const CG_JWKS_DEFAULT = 'https://userportal.crazygames.com/.well-known/jwks.json';
let _jwks = null, _jwksUrl = null;
/** Ověří CG token (RS256, podpis přes JWKS, exp, volitelně gameId z env CG_GAME_ID). Vrací payload nebo null. */
export async function verifyCrazyGamesToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  try {
    const url = e().CG_JWKS_URL || CG_JWKS_DEFAULT;
    if (!_jwks || _jwksUrl !== url) { _jwks = createRemoteJWKSet(new URL(url)); _jwksUrl = url; }
    const { payload } = await jwtVerify(token, _jwks, { algorithms: ['RS256'] });
    if (typeof payload.userId !== 'string' || !payload.userId || payload.userId.length > 128) return null;
    const gid = e().CG_GAME_ID?.trim();
    if (gid && String(payload.gameId) !== gid) return null;
    return payload;
  } catch { return null; }
}

router.post('/crazygames', async (req, res) => {
  const p = await verifyCrazyGamesToken(req.body?.token);
  if (!p) return res.status(401).json({ error: 'invalid_cg_token' });
  try {
    const bt = bearerToken(req);
    const dev = bt ? verifyDeviceToken(bt) : null;
    const r = loginCrazyGamesUser(p.userId, p.username, p.profilePictureUrl, dev?.userId ?? null);
    res.json({ token: signDeviceToken(r.did, r.userId), created: r.created });
  } catch (err) { console.error('crazygames login failed', err); res.status(500).json({ error: 'db_error' }); }
});

// ── Session API ───────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  const user = getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: user.id,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    is_sponsor: !!user.is_sponsor,
    kind: userHasIdentity(user.id, 'discord') || userHasIdentity(user.id, 'crazygames') ? 'account' : 'guest',
    tier: user.is_sponsor ? 'sponsor' : 'registered',
  });
});

router.get('/profile', requireAuth, (req, res) => {
  const prof = getProfile(req.userId);
  if (!prof) return res.status(404).json({ error: 'not_found' });
  res.json(prof);
});

router.post('/profile', requireAuth, (req, res) => {
  const allowed = ['helmet','gloves','tape','trail','stick','tape_style','helmet_type','visor','handed','number'];
  const fields = {};
  for (const k of allowed) if (req.body?.[k] !== undefined) fields[k] = req.body[k];
  if (Object.keys(fields).length) saveProfile(req.userId, fields);
  if (typeof req.body?.display_name === 'string') setGuestName(req.userId, req.body.display_name);   // jen hosté
  res.json({ ok: true });
});

router.get('/stats', requireAuth, (req, res) => {
  const stats = getStats(req.userId);
  if (!stats) return res.status(404).json({ error: 'not_found' });
  res.json(stats);
});

router.post('/logout', (req, res) => {
  res.clearCookie(JWT_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

export default router;

// ── Link kód: /api/link/* (mountuje server.js) ───────────────────────────────
export const linkRouter = express.Router();
linkRouter.post('/code', requireAuth, (req, res) => {
  try { res.json(createLinkCode(req.userId)); }
  catch { res.status(500).json({ error: 'db_error' }); }
});
linkRouter.post('/redeem', requireAuth, (req, res) => {
  try {
    const r = redeemLinkCode(req.body?.code, req.userId);
    if (!r.ok) return res.status(r.error === 'discord_required' ? 403 : 400).json(r);
    res.json(r);
  } catch { res.status(500).json({ error: 'db_error' }); }
});
