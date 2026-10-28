// Plugins
import Components from 'unplugin-vue-components/vite'
import Vue from '@vitejs/plugin-vue'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import Fonts from 'unplugin-fonts/vite'
import MujocoWasm from './scripts/vite-plugin-mujoco-wasm.mjs'
import SceneMeshGzip from './scripts/vite-plugin-scene-mesh-gzip.mjs'

// Utilities
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

const FIRST_PAINT_FONTS = /\/(Phosphor|geist-sans-latin-(400|600)-normal)-[\w-]+\.woff2$/

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
      // unplugin-fonts preloads every font file in the bundle by default (94 here, incl. the
      // lazily loaded KaTeX fonts and ~1 MB of woff/ttf fallbacks). Keep only the woff2 fonts
      // the first paint uses; the rest load on demand through their @font-face rules.
      custom: {
        families: [],
        linkFilter: (tags) => tags.filter((tag) => FIRST_PAINT_FONTS.test(tag.attrs?.href ?? '')),
      },
    }),
    MujocoWasm(),
    SceneMeshGzip(),
  ],
  optimizeDeps: {
    exclude: ['vuetify', 'onnxruntime-web', 'onnxruntime-web/wasm'],
  },
  define: { 'process.env': {} },
  build: {
    // Never inline fonts: a base64 font in render-blocking CSS is downloaded even when its
    // unicode-range (e.g. Geist Mono's Vietnamese subset) is never used on the page.
    assetsInlineLimit: (filePath) => (/\.(woff2?|ttf|otf|eot)$/i.test(filePath) ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Keep Vite's dynamic-import helper in the eagerly loaded vendor chunk. Otherwise
          // Rollup puts it in vendor-mujoco (mujoco-js uses import()), making the entry
          // statically import the whole MuJoCo chunk before the app can mount.
          if (id.includes('vite/preload-helper')) return 'vendor';
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
