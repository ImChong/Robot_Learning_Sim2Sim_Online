// Plugins
import Components from 'unplugin-vue-components/vite'
import Vue from '@vitejs/plugin-vue'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import MujocoWasm from './scripts/vite-plugin-mujoco-wasm.mjs'
import SceneMeshGzip from './scripts/vite-plugin-scene-mesh-gzip.mjs'

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
    MujocoWasm(),
    SceneMeshGzip(),
  ],
  optimizeDeps: {
    exclude: ['vuetify', 'onnxruntime-web', 'onnxruntime-web/wasm'],
  },
  define: { 'process.env': {} },
  build: {
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
