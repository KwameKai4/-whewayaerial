import type { APIRoute } from 'astro';
import { isRepositoryPreview, sitePath } from '../utils/sitePath';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL(sitePath('/sitemap-index.xml'), site).href;
  const rules = isRepositoryPreview
    ? ['User-agent: *', 'Disallow: /']
    : ['User-agent: *', 'Allow: /'];

  return new Response([...rules, '', `Sitemap: ${sitemapURL}`, ''].join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
