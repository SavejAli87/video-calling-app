import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()], // basicSsl() yahan nahi hona chahiye
  server: {
    host: true,
    port: 5173,
    https: false,
  },
});