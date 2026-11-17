import { defineConfig } from 'astro/config';
import { canonicalSite } from './config/site.mjs';
export default defineConfig({site: canonicalSite(), output:'static'});
