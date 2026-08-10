import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from the domain root on the self-hosted instance. (A subpath deploy
// would need base set to that prefix — see deploy.sh.)
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
