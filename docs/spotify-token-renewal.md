# renewing the spotify token for the now playing satellite

The satellite on santihdzs.com reads from the cloudflare worker at
https://now-playing.santihdzs.workers.dev/now-playing, and the worker talks to spotify with a refresh token.

## why this is needed

Spotify refresh tokens stop working about **6 months** after you authorize the app, and refreshing does not extend
them ([spotify: refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)).
When that happens the satellite quietly disappears.

Set a calendar reminder for **5 months after the last renewal**, titled "renew spotify token for santihdzs.com",
with a link to this file.

## the symptom

A song is playing on your account, but the endpoint answers `{"state":"idle"}` and the satellite is gone:

```sh
curl https://now-playing.santihdzs.workers.dev/now-playing
```

## renew it

1. From the **repo root**, with your app's client id from https://developer.spotify.com/dashboard
   (the client id is not a secret, but keep it out of the repo):

   ```sh
   SPOTIFY_CLIENT_ID=your_client_id node scripts/spotify-auth.mjs
   ```

   A browser opens. Approve access. The terminal prints a new refresh token (nothing is written to disk).

2. Store it in the worker. Run this **inside `worker/`**, never at the repo root:

   ```sh
   cd worker
   npx wrangler secret put SPOTIFY_REFRESH_TOKEN
   ```

   Paste the token when asked, then clear the terminal scrollback.

3. Check it while a song is playing:

   ```sh
   curl https://now-playing.santihdzs.workers.dev/now-playing
   ```

   You should see `"state":"playing"` within about 20 seconds (the worker caches answers that long).

The worker keeps the newest token in its kv namespace and falls back to the secret you just set, so no redeploy is needed.

## if it still fails

- **Premium:** the spotify account that owns the app must have an active premium subscription, or apps in
  development mode stop working.
- **User management:** your account must be listed under user management for the app at
  https://developer.spotify.com/dashboard.
- **Secrets:** inside `worker/`, `npx wrangler secret list` must show `SPOTIFY_CLIENT_ID` and `SPOTIFY_REFRESH_TOKEN`.
- **Logs:** inside `worker/`, `npx wrangler tail` streams the worker's logs while you curl the endpoint. Look for
  `token refresh failed: 400` (the token is wrong or expired) or `spotify responded 403` (an account or app problem).
  The logs never contain tokens.

## if the token leaks

1. Revoke the app's access at https://www.spotify.com/account/apps/ (this kills every token it issued).
2. Do the three steps in "renew it" again.
