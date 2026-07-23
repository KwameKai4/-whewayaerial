import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const site = 'https://whewaydrones.co.uk';
const thanksURL = new URL('/thanks/', site).href;

export default defineConfig({
  site,
  devToolbar: { enabled: false },
  integrations: [sitemap({
    filter: (page) => page !== thanksURL,
  })],
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
});
