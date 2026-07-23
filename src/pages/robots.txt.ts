import type { APIRoute } from 'astro';
import { sitePath } from '../utils/sitePath';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL(sitePath('/sitemap-index.xml'), site).href;
  const rules = ['User-agent: *', 'Allow: /'];

  return new Response([...rules, '', `Sitemap: ${sitemapURL}`, ''].join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
