// dev only: runs scripts/spotify-auth.mjs against a fake accounts server, checks the pkce exchange.
// usage: node tools/auth-test.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail && !ok ? `  [${detail}]` : ''}`);
};
const b64url = (buf) => buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

let exchange = null;
const fake = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    exchange = { path: req.url, params: new URLSearchParams(body), type: req.headers['content-type'] };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'acc', refresh_token: 'REFRESH-FROM-FAKE', scope: 'user-read-currently-playing user-read-recently-played', expires_in: 3600 }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const accounts = `http://127.0.0.1:${fake.address().port}`;

function run(port, tamperState = false) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/spotify-auth.mjs'), '--port', String(port), '--no-open'], {
      env: { ...process.env, SPOTIFY_CLIENT_ID: 'test-client', SPOTIFY_ACCOUNTS_URL: accounts },
    });
    let out = '';
    child.stdout.on('data', async (d) => {
      out += d;
      const m = out.match(/(http:\/\/127\.0\.0\.1:\d+\/authorize\?\S+)/);
      if (m && !child.sent) {
        child.sent = true;
        const auth = new URL(m[1]);
        const state = tamperState ? 'wrong' : auth.searchParams.get('state');
        const cb = await fetch(`http://127.0.0.1:${port}/callback?code=CODE123&state=${state}`).catch(() => null);
        child.auth = auth;
        child.cbStatus = cb?.status;
      }
    });
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => resolve({ code, out, auth: child.auth, cbStatus: child.cbStatus }));
  });
}

const ok = await run(18888);
const a = ok.auth?.searchParams;
check('authorize url carries the pkce parameters and only the two scopes', a?.get('response_type') === 'code' && a.get('client_id') === 'test-client' && a.get('code_challenge_method') === 'S256' && a.get('redirect_uri') === 'http://127.0.0.1:18888/callback' && a.get('scope') === 'user-read-currently-playing user-read-recently-played', ok.auth?.toString());
const verifier = exchange?.params.get('code_verifier') ?? '';
check('code verifier is 43 to 128 allowed characters', /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier), verifier);
check('code challenge is the base64url sha256 of the verifier', a?.get('code_challenge') === b64url(createHash('sha256').update(verifier).digest()));
check('token exchange posts form data with code, redirect, client id and no secret', exchange?.path === '/api/token' && exchange.type === 'application/x-www-form-urlencoded' && exchange.params.get('grant_type') === 'authorization_code' && exchange.params.get('code') === 'CODE123' && exchange.params.get('client_id') === 'test-client' && !exchange.params.has('client_secret'));
check('refresh token is printed and the helper exits cleanly', ok.code === 0 && ok.out.includes('REFRESH-FROM-FAKE') && ok.cbStatus === 200, ok.out);
exchange = null;
const bad = await run(18889, true);
check('a state mismatch is refused without a token exchange', bad.code === 1 && bad.cbStatus === 400 && exchange === null && !bad.out.includes('REFRESH-FROM-FAKE'));
fake.close();
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
