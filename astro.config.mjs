import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const [githubOwner, githubRepository] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const repositoryPreview = process.env.GITHUB_ACTIONS === 'true'
  && process.env.DEPLOY_CUSTOM_DOMAIN !== 'true'
  && Boolean(githubOwner && githubRepository);
const site = repositoryPreview
  ? `https://${githubOwner.toLowerCase()}.github.io`
  : 'https://whewayaerial.co.uk';
const base = repositoryPreview ? `/${githubRepository}` : undefined;
const thanksURL = new URL(`${base ?? ''}/thanks/`, site).href;

export default defineConfig({
  site,
  base,
  devToolbar: { enabled: false },
  integrations: [sitemap({
    filter: (page) => page !== thanksURL,
  })],
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
});
