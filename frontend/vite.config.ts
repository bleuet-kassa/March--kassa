import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Poort + API-doel zijn instelbaar via omgevingsvariabelen, zodat dezelfde code
// zowel de echte omgeving (poort 5173 -> backend 3000) als een testomgeving
// (poort 5174 -> backend 3001, database kassa_test) kan bedienen.
const apiPort = process.env.API_PORT || '3000';
const frontPort = Number(process.env.FRONT_PORT) || 5173;
const omgeving = process.env.VITE_OMGEVING || 'live';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_OMGEVING': JSON.stringify(omgeving),
  },
  server: {
    port: frontPort,
    host: '0.0.0.0', // luister expliciet op IPv4 (zodat LAN-pc's via 192.168.x.x verbinden)
    proxy: {
      '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
