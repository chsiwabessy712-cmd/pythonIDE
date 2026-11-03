import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The IDE's files were written for Create React App, which allows JSX in .js.
// "firebase/firestore" points at the localStorage stand-in, so PythonAssessment.js
// stays identical to the Training Manager copy.
export default defineConfig({
  plugins: [react({ include: /\.(js|jsx)$/ })],
  esbuild: { loader: 'jsx', include: /src\/.*\.js$/, exclude: [] },
  optimizeDeps: { esbuildOptions: { loader: { '.js': 'jsx' } } },
  resolve: {
    alias: { 'firebase/firestore': fileURLToPath(new URL('./src/firebase/firestore.js', import.meta.url)) },
  },
  server: { port: 5181, strictPort: true },
});
