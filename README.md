# WhewayAerial

Astro website for a Taunton-based drone photogrammetry and visual 3D property modelling service.

## Local development

```sh
npm install
npm run dev
```

Run `npm run verify` before publishing.

## Deployment

Pushes to `main` deploy automatically to GitHub Pages. Until the custom domain is connected, the workflow builds for the repository URL and marks that temporary copy as `noindex`.

When `whewayaerial.co.uk` is ready, configure it in GitHub Pages and set the repository Actions variable `DEPLOY_CUSTOM_DOMAIN` to `true`.
