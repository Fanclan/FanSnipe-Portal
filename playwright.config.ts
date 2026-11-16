import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/e2e',use:{baseURL:'http://localhost:4321'},webServer:{command:'npm run build && node scripts/preview.mjs',url:'http://127.0.0.1:4321',reuseExistingServer:true}});
