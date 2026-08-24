import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      // Tiêu thụ trực tiếp mã TS của cost-core — một nguồn sự thật duy nhất
      // với solver worker và API (solver spec §12.4)
      '@tkb/cost-core': path.resolve(here, '../../packages/cost-core/src/index.ts')
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: 'http://localhost:4000', changeOrigin: true }
    }
  }
});
