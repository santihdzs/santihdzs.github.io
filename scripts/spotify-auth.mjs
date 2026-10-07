#!/usr/bin/env node
// one time spotify authorization (pkce) for the now playing worker. node 20+, no dependencies.
// prints the refresh token to this terminal and never writes it anywhere.
// usage: SPOTIFY_CLIENT_ID=... node scripts/spotify-auth.mjs [--port 8888] [--no-open]
// the app's redirect uri must be exactly http://127.0.0.1:<port>/callback (spotify rejects "localhost").

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const CLIENT_ID = option('--client-id') ?? process.env.SPOTIFY_CLIENT_ID;
const PORT = Number(option('--port') ?? 8888);
// testing hook only: point the token exchange at a local stand in
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_URL ?? 'https://accounts.spotify.com';
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = 'user-read-currently-playing user-read-recently-played';
const TIMEOUT_MS = 5 * 60 * 1000;

if (!CLIENT_ID) {
  console.error('set SPOTIFY_CLIENT_ID (or pass --client-id) to your spotify app client id.');
  process.exit(1);
}

const base64url = (buf) => buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
// 64 characters from the allowed set (letters, digits, - and _), inside the 43 to 128 rule
const verifier = base64url(randomBytes(48));
const challenge = base64url(createHash('sha256').update(verifier).digest());
const state = base64url(randomBytes(16));

const authorize = new URL(`${ACCOUNTS}/authorize`);
authorize.search = new URLSearchParams({
  response_type: 'code',
  client_id: CLIENT_ID,
  scope: SCOPES,
  redirect_uri: REDIRECT,
  code_challenge_method: 'S256',
  code_challenge: challenge,
  state,
}).toString();

const page = (title, text) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px ui-monospace,monospace;background:#06080b;color:#e8ecef;padding:3rem"><p>${text}</p></body>`;

function finish(server, code, message) {
  if (message) console.log(message);
  server.close();
  clearTimeout(timer);
  process.exitCode = code;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400, { 'content-type': 'text/html' }).end(page('error', 'state mismatch, run the helper again.'));
    finish(server, 1, 'state mismatch: the callback did not come from this run.');
    return;
  }
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (error || !code) {
    res.writeHead(400, { 'content-type': 'text/html' }).end(page('error', 'authorization was not granted.'));
    finish(server, 1, `authorization failed: ${error ?? 'no code returned'}`);
    return;
  }
  try {
    const tokenRes = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier }),
    });
    const data = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !data.refresh_token) {
      res.writeHead(502, { 'content-type': 'text/html' }).end(page('error', 'the token exchange failed, see the terminal.'));
      finish(server, 1, `token exchange failed (${tokenRes.status}${data.error ? `, ${data.error}` : ''}).`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(page('done', 'done. you can close this tab and go back to the terminal.'));
    finish(
      server,
      0,
      [
        '',
        'refresh token (store it as a worker secret, then clear your terminal scrollback):',
        '',
        data.refresh_token,
        '',
        '  cd worker && npx wrangler secret put SPOTIFY_REFRESH_TOKEN',
        '',
        `granted scopes: ${data.scope ?? 'unknown'}`,
        'spotify refresh tokens expire after 6 months; run this helper again before then.',
      ].join('\n')
    );
  } catch (err) {
    res.writeHead(502, { 'content-type': 'text/html' }).end(page('error', 'could not reach spotify.'));
    finish(server, 1, `could not reach spotify: ${err.message}`);
  }
});

const timer = setTimeout(() => finish(server, 1, 'timed out after 5 minutes without a callback.'), TIMEOUT_MS);

server.on('error', (err) => {
  console.error(`could not listen on 127.0.0.1:${PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`listening on ${REDIRECT}\nopen this url and approve access:\n\n${authorize}\n`);
  if (args.includes('--no-open')) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(opener, [authorize.toString()], () => {});
});
