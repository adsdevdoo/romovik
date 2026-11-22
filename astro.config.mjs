import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import node from '@astrojs/node';

export default defineConfig({
  site: process.env.SITE_URL || 'https://rom.creepypaste.rs',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'ignore',
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
  devToolbar: { enabled: false },
});
