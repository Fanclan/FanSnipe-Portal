import { defineConfig } from 'astro/config';
const productionHost=process.env.VERCEL_PROJECT_PRODUCTION_URL;
const site=process.env.PUBLIC_SITE_URL || (productionHost ? `https://${productionHost}` : 'http://localhost:4321');
export default defineConfig({site, output:'static'});
