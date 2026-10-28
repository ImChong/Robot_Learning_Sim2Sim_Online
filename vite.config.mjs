// Plugins
import Components from 'unplugin-vue-components/vite'
import Vue from '@vitejs/plugin-vue'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import Fonts from 'unplugin-fonts/vite'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/'

// https://vitejs.dev/config/
export default defineConfig({
  base,
  plugins: [
    Vue({
      template: { transformAssetUrls },
    }),
    // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    Vuetify({
      styles: {
        configFile: './src/styles/settings.scss',
      },
    }),
    Components(),
    Fonts({
      fontsource: {
        // Geist Sans 在 src/styles/fonts.css 里带 unicode-range 单独声明。
        families: [
          {
            name: 'Geist Mono',
            weights: [400, 500, 600],
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    exclude: ['vuetify', 'onnxruntime-web'],
  },
  define: { 'process.env': {} },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('vuetify')) return 'vendor-vuetify';
            if (id.includes('three')) return 'vendor-three';
            if (id.includes('onnxruntime-web')) return 'vendor-onnx';
            if (id.includes('mujoco-js')) return 'vendor-mujoco';
            // Loaded on demand by src/utils/katexLoader.js; keep it out of the
            // eagerly preloaded vendor chunk.
            if (id.includes('katex')) return 'vendor-katex';
            return 'vendor';
          }
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    extensions: [
      '.js',
      '.json',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
      '.vue',
    ],
  },
  server: {
    port: 3000,
  },
  css: {
    preprocessorOptions: {
      sass: {
        api: 'modern-compiler',
      },
      scss: {
        api:'modern-compiler',
      },
    },
  },
})
