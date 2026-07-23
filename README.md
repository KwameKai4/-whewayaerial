# WhewayAerial

Astro website for a Taunton-based drone photogrammetry and visual 3D property modelling service.

## Local development

```sh
npm install
npm run dev
```

Run `npm run verify` before publishing.

## Deployment

Pushes to `main` deploy the Astro site to GitHub Pages for `https://whewaydrones.co.uk`. Astro always builds root-relative asset and navigation URLs for the custom domain.

Set the public repository Actions variable `PUBLIC_TURNSTILE_SITE_KEY` to the Managed Turnstile widget site key. If the variable is absent, the online submit button stays disabled and the public email fallback remains available.

## Contact Worker

The Worker in `worker/` accepts only enquiries from the production website, verifies Turnstile, rate-limits a one-way HMAC digest of the connecting IP, and emails the fixed Gmail destination. It stores no submissions.

Before the Worker deployment workflow can succeed:

1. Enable Cloudflare Email Routing for `whewaydrones.co.uk`.
2. Verify `kwame.whe@gmail.com` as a destination and route `job@whewaydrones.co.uk` to it.
3. Onboard `whewaydrones.co.uk` in Cloudflare Email Service so `website@whewaydrones.co.uk` is an authorised sender.
4. Create a Managed Turnstile widget for `whewaydrones.co.uk`, `localhost` and `127.0.0.1`.
5. Add Worker secrets with `npx wrangler secret put TURNSTILE_SECRET_KEY --config worker/wrangler.jsonc` and `npx wrangler secret put IP_HASH_SECRET --config worker/wrangler.jsonc`.
6. Add GitHub repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Scope the token to this Worker, Worker routes, and the zone resources required by the deployment.

The Worker deploys to the custom domain `forms.whewaydrones.co.uk`. Run `npm run worker:types` after changing `worker/wrangler.jsonc`; the generated binding types are committed and regenerated in CI before tests.
