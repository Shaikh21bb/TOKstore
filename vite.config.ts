import vinext from 'vinext';
import { defineConfig } from 'vite';
import { sites } from './build/sites-vite-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
export default defineConfig({plugins:[vinext(),sites(),cloudflare({viteEnvironment:{name:'rsc',childEnvironments:['ssr']},inspectorPort:false,config:{main:'./build/sites-worker.ts',compatibility_date:'2026-05-15',compatibility_flags:['nodejs_compat'],d1_databases:[{binding:'DB',database_name:'tok-catalog',database_id:'00000000-0000-4000-8000-000000000000'}]}})]});
