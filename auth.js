import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  upsertDiscordUser, upsertEmailUser, getUserById,
  createMagicToken, consumeMagicToken, cleanExpiredTokens,
} from './db.js';

const router = express.Router();

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
  DISCORD_SPONSOR_ROLE_ID,
  RESEND_API_KEY,
  EMAIL_FROM = 'noreply@flathockey.fun',
  JWT_SECRET,
  BASE_URL = 'https://flathockey.fun',
} = process.env;

const JWT_COOKIE = 'fh_session';
const JWT_TTL    = 60 * 60 * 24 * 30; // 30 dní

// ── Helpers ───────────────────────────────────────────────────────────────────

function signJwt(user_id) {
  return jwt.sign({ sub: user_id }, JWT_SECRET, { expiresIn: JWT_TTL });
}

function setCookie(res, token) {
  res.cookie(JWT_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: JWT_TTL * 1000,
  });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[JWT_COOKIE];
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
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
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/discord/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || !oauthStates.has(state)) {
    return res.redirect(`${BASE_URL}/?auth_error=invalid_state`);
  }
  oauthStates.delete(state);

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('no access_token');

    const authHeader = `Bearer ${tokenData.access_token}`;

    // Get user info
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: authHeader },
    });
    const discordUser = await userRes.json();

    // Check sponsor role
    let is_sponsor = false;
    if (DISCORD_SPONSOR_ROLE_ID) {
      try {
        const memberRes = await fetch(
          `https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`,
          { headers: { Authorization: authHeader } }
        );
        if (memberRes.ok) {
          const member = await memberRes.json();
          is_sponsor = member.roles?.includes(DISCORD_SPONSOR_ROLE_ID) ?? false;
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
    res.redirect(`${BASE_URL}/?auth_error=discord_failed`);
  }
});

// ── Email magic link ───────────────────────────────────────────────────────────

// Rate limit: max 3 magic links / email / 10 min
const magicRateLimit = new Map();
setInterval(() => {
  const cut = Date.now() - 600_000;
  for (const [k, v] of magicRateLimit) if (v.ts < cut) magicRateLimit.delete(k);
}, 60_000);

router.post('/email/request', express.json(), async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'invalid_email' });
  }
  const key = email.toLowerCase();
  const rl = magicRateLimit.get(key);
  if (rl && rl.count >= 3 && Date.now() - rl.ts < 600_000) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  magicRateLimit.set(key, { count: (rl?.count || 0) + 1, ts: rl?.ts || Date.now() });

  const display_name = key.split('@')[0];
  const user_id = upsertEmailUser(key, display_name);
  const token = createMagicToken(user_id);
  const link = `${BASE_URL}/auth/email/verify?token=${token}`;

  if (RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: key,
        subject: 'Přihlášení do FlatHockey',
        html: `
          <p>Ahoj!</p>
          <p>Klikni na odkaz níže pro přihlášení do FlatHockey. Platí 15 minut.</p>
          <p><a href="${link}" style="font-size:18px;font-weight:bold">Přihlásit se</a></p>
          <p style="color:#888;font-size:12px">Pokud jsi o přihlášení nežádal/a, tento email ignoruj.</p>
        `,
      }),
    }).catch(err => console.error('Resend error:', err));
  } else {
    console.log('[magic link]', link);
  }

  res.json({ ok: true });
});

router.get('/email/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect(`${BASE_URL}/?auth_error=missing_token`);
  const user_id = consumeMagicToken(token);
  if (!user_id) return res.redirect(`${BASE_URL}/?auth_error=invalid_token`);
  setCookie(res, signJwt(user_id));
  res.redirect(`${BASE_URL}/?auth_ok=1`);
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

router.post('/logout', (req, res) => {
  res.clearCookie(JWT_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

// Periodicky čistí expirované magic tokeny
setInterval(cleanExpiredTokens, 3_600_000);

export default router;
