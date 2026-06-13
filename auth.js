import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { upsertDiscordUser, getUserById, getProfile, saveProfile, getStats } from './db.js';

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

export function verifySession(token) {
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, e().JWT_SECRET);
    return sub;
  } catch { return null; }
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[JWT_COOKIE];
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const { sub } = jwt.verify(token, e().JWT_SECRET);
    req.userId = sub;
    next();
  } catch {
    res.clearCookie(JWT_COOKIE);
    res.status(401).json({ error: 'invalid_session' });
  }
}

// ── Discord OAuth ─────────────────────────────────────────────────────────────

// CSRF state store (in-memory, expires in 10 min)
const oauthStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates) if (v < now) oauthStates.delete(k);
}, 60_000);

router.get('/discord', (_req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now() + 600_000);
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
  if (!code || !state || !oauthStates.has(state)) {
    return res.redirect(`${BASE_URL}/?auth_error=invalid_state`);
  }
  oauthStates.delete(state);

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

    const user_id = upsertDiscordUser({
      discord_id: discordUser.id,
      display_name: discordUser.global_name || discordUser.username,
      avatar_url,
      is_sponsor,
    });

    setCookie(res, signJwt(user_id));
    res.redirect(`${BASE_URL}/?auth_ok=1`);
  } catch (err) {
    console.error('Discord OAuth error:', err);
    res.redirect(`${e().BASE_URL || 'https://flathockey.fun'}/?auth_error=discord_failed`);
  }
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
