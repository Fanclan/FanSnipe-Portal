import type {APIRoute} from 'astro';
export const GET:APIRoute=({site})=>new Response(`User-agent: *\n${import.meta.env.VERCEL_ENV === 'preview' ? 'Disallow: /' : 'Allow: /\nDisallow: /app/'}\nSitemap: ${new URL('sitemap.xml',site)}\n`);
