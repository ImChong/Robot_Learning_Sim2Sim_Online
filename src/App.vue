<template>
  <v-app>
    <a class="skip-link" href="#controls-panel" @click="focusControlsPanel">{{ headerText.skipToControls }}</a>
    <header class="site-header">
      <div class="header-inner">
        <h1 class="site-title" aria-label="Robot Learning Sim2Sim Online | 人形机器人强化学习在线推理">
          <svg class="brand-mark" viewBox="4 3 24 24" aria-hidden="true" focusable="false">
            <path d="M16 5.5v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <rect x="7.5" y="9.5" width="17" height="15" rx="6" fill="none" stroke="currentColor" stroke-width="2" />
            <rect x="11" y="14.5" width="10" height="4" rx="2" fill="currentColor" />
          </svg>
          <span class="brand-name">Robot Learning Sim2Sim Online</span>
          <span class="brand-tagline">人形机器人强化学习在线推理</span>
        </h1>
        <nav class="header-right" :aria-label="headerText.siteNav">
          <a
            v-if="showExternalSourceLinks"
            href="https://github.com/ImChong/Robot_Learning_Sim2Sim_Online"
            class="header-action github-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            <i class="ph ph-github-logo" aria-hidden="true"></i>
            <span class="github-link-text">GitHub</span>
          </a>
          <button
            class="header-action language-toggle"
            :aria-label="languageToggleLabel"
            :title="languageToggleLabel"
            type="button"
            @click="toggleLanguage"
          >
            {{ languageToggleText }}
          </button>
          <v-menu location="bottom end" offset="8">
            <template #activator="{ props: menuProps }">
              <button
                id="themeToggle"
                v-bind="menuProps"
                class="header-action theme-toggle"
                :aria-label="themeToggleLabel"
                :title="themeToggleLabel"
                type="button"
              >
                <i :class="['ph', currentThemeOption.icon]" aria-hidden="true"></i>
              </button>
            </template>
            <v-list class="theme-menu" density="compact" :aria-label="headerText.theme">
              <v-list-item
                v-for="option in themeOptions"
                :key="option.value"
                :active="themeMode === option.value"
                :prepend-icon="option.icon"
                :title="option.title"
                :data-theme-option="option.value"
                color="primary"
                @click="setThemeMode(option.value)"
              >
                <template #append>
                  <i v-if="themeMode === option.value" class="ph ph-check theme-menu-check" aria-hidden="true"></i>
                </template>
              </v-list-item>
            </v-list>
          </v-menu>
        </nav>
      </div>
    </header>

    <v-main class="app-main">
      <Demo :visual-theme="currentThemeName" :language="currentLanguage" />
    </v-main>
  </v-app>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from 'vuetify'
import Demo from '@/views/Demo.vue'
import { showExternalSourceLinks } from '@/config/siteLinks'
import {
  applyDocumentTheme,
  getStoredThemeMode,
  resolveThemeMode,
  themeStorageKey,
} from '@/utils/themePreference'

const headerTranslations = {
  en: {
    skipToControls: 'Skip to controls',
    siteNav: 'Site',
    theme: 'Theme',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeSystem: 'Match system',
    themeToggle: 'Theme: {mode}',
  },
  zh: {
    skipToControls: '跳到控制面板',
    siteNav: '站点',
    theme: '主题',
    themeDark: '深色',
    themeLight: '浅色',
    themeSystem: '跟随系统',
    themeToggle: '主题：{mode}',
  },
}

const theme = useTheme()
const themeMode = ref(getStoredThemeMode())
const initialTheme = resolveThemeMode(themeMode.value)
if (theme.global.name.value !== initialTheme) {
  theme.change(initialTheme)
}
applyDocumentTheme(initialTheme)
const languageStorageKey = 'rl-sim2sim-demo-language'
const currentThemeName = computed(() => theme.global.name.value)
const currentLanguage = ref('en')
const headerText = computed(() => headerTranslations[currentLanguage.value] ?? headerTranslations.en)
const themeOptions = computed(() => [
  { value: 'dark', title: headerText.value.themeDark, icon: 'ph-moon' },
  { value: 'light', title: headerText.value.themeLight, icon: 'ph-sun' },
  { value: 'system', title: headerText.value.themeSystem, icon: 'ph-circle-half' },
])
const currentThemeOption = computed(() => (
  themeOptions.value.find(option => option.value === themeMode.value) ?? themeOptions.value[0]
))
const themeToggleLabel = computed(() => (
  headerText.value.themeToggle.replace('{mode}', currentThemeOption.value.title)
))
const languageToggleText = computed(() => (currentLanguage.value === 'zh' ? 'English' : '中文'))
const languageToggleLabel = computed(() => (
  currentLanguage.value === 'zh' ? 'Switch control panel to English' : '将控制面板切换为中文'
))

let colorSchemeQuery = null

function applyThemeMode() {
  const next = resolveThemeMode(themeMode.value)
  if (theme.global.name.value !== next) {
    theme.change(next)
  }
  applyDocumentTheme(next)
}

function setThemeMode(mode) {
  themeMode.value = mode
  localStorage.setItem(themeStorageKey, mode)
  applyThemeMode()
}

function onSystemColorSchemeChange() {
  if (themeMode.value === 'system') {
    applyThemeMode()
  }
}

function focusControlsPanel() {
  // 面板是 fixed 定位的浮层，跳转锚点不会移动焦点，这里手动聚焦。
  requestAnimationFrame(() => document.getElementById('controls-panel')?.focus())
}

function setLanguage(language) {
  currentLanguage.value = language === 'zh' ? 'zh' : 'en'
  document.documentElement.setAttribute('lang', currentLanguage.value === 'zh' ? 'zh-CN' : 'en')
  localStorage.setItem(languageStorageKey, currentLanguage.value)
}

function toggleLanguage() {
  setLanguage(currentLanguage.value === 'zh' ? 'en' : 'zh')
}

onMounted(() => {
  setLanguage(localStorage.getItem(languageStorageKey) || 'en')
  if (typeof window.matchMedia === 'function') {
    colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)')
    colorSchemeQuery.addEventListener?.('change', onSystemColorSchemeChange)
  }
})

onBeforeUnmount(() => {
  colorSchemeQuery?.removeEventListener?.('change', onSystemColorSchemeChange)
})

watch(
  () => theme.global.name.value,
  value => {
    applyDocumentTheme(value)
  }
)
</script>

<style>
/*
 * 设计令牌。深色背景只取 redesign-skill Design Values 的灰阶
 * (#000000 · #181818 · #1F1F1F · #272727 · #313131)，强调色只保留一个。
 */
:root {
  --bg: #181818;
  --bg-alt: #1f1f1f;
  --surface: rgba(31, 31, 31, .88);
  --surface-strong: #272727;
  --border: #272727;
  --border-strong: #313131;
  --text: #eceae5;
  --text-muted: #9b9b9b;
  --accent: #7aa7ee;
  --accent-hover: color-mix(in srgb, var(--accent) 80%, #ffffff);
  --header-bg: #181818;
  --header-border: #272727;
  --brand-gradient: linear-gradient(90deg, #ffffff, #9b9b9b);
  --shadow-sm: 0 8px 24px rgba(0, 0, 0, .24);
  --shadow-md: 0 16px 40px rgba(0, 0, 0, .36);
  --radius: 16px;
  --header-h: 56px;
  --font-sans: 'Geist Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-color: 300ms;
  --duration-move: 500ms;
  --transition: var(--duration-color) var(--ease);

  /* 模型 I/O 图表是「示波器屏」，两种主题下都保持深色，只取中性灰阶。 */
  --viz-bg: #181818;
  --viz-panel: #1f1f1f;
  --viz-raised: #272727;
  --viz-line: #313131;
  --viz-ink: #eceae5;
  --viz-ink-muted: #9b9b9b;
  --viz-ink-faint: #666666;
  --viz-grid: rgba(155, 155, 155, .14);

  /* z-index 刻度：画面内嵌 < 控制浮层 < 底部抽屉 < 全局提示；Vuetify overlay 从 2000 起。 */
  --z-header: 100;
  --z-embed: 500;
  --z-panel: 1000;
  --z-dock: 1050;
  --z-dock-toggle: 1051;
  --z-sheet-backdrop: 1095;
  --z-sheet: 1100;
  --z-alerts: 1200;
}

[data-theme="light"] {
  --bg: #fbfbfa;
  --bg-alt: #f3f2ef;
  --surface: rgba(255, 255, 255, .88);
  --surface-strong: #ffffff;
  --border: #e7e5e0;
  --border-strong: #ddd9d0;
  --text: #2f2d29;
  --text-muted: #6f6b64;
  --accent: #2d74da;
  --accent-hover: #1a5bb8;
  --header-bg: #fbfbfa;
  --header-border: #e7e5e0;
  --brand-gradient: linear-gradient(90deg, #000000, #666666);
  /* 阴影向暖灰背景着色，而不是冷色 slate。 */
  --shadow-sm: 0 8px 24px rgba(47, 45, 41, .06);
  --shadow-md: 0 16px 40px rgba(47, 45, 41, .12);
}

body,
.v-application {
  font-family: var(--font-sans) !important;
}

html,
body {
  overflow-x: clip;
  width: 100%;
  position: relative;
}

body {
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: background-color var(--transition), color var(--transition);
}

.v-application {
  overflow-x: clip;
  background: transparent !important;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.v-main {
  padding-top: 0 !important;
}

.v-container {
  max-width: 100%;
}

h1,
h2,
.v-card-title {
  text-wrap: balance;
}

p,
.text-caption {
  text-wrap: pretty;
}

code,
kbd,
pre,
samp {
  font-family: var(--font-mono);
}

/* 交互状态：键盘焦点环 + 按下反馈，统一走基础缓动曲线。 */
.v-btn,
.v-chip,
.header-action {
  transition-timing-function: var(--ease);
}

.v-btn:not(.v-btn--disabled):active,
.v-chip--link:active,
.header-action:active {
  transform: scale(0.98);
}

a:focus-visible,
button:focus-visible,
.v-btn:focus-visible,
.v-chip:focus-visible,
.v-list-item:focus-visible,
[role="separator"]:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.skip-link {
  position: fixed;
  top: 8px;
  left: 16px;
  z-index: calc(var(--z-header) + 1);
  padding: 8px 12px;
  border-radius: 8px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 600;
  text-decoration: none;
  transform: translateY(-160%);
  transition: transform var(--duration-move) var(--ease);
}

.skip-link:focus-visible {
  transform: translateY(0);
}

.site-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  height: var(--header-h);
  background: var(--header-bg);
  border-bottom: 1px solid var(--header-border);
  transition: background-color var(--transition), border-color var(--transition);
}

.header-inner {
  height: 100%;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
}

.site-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: 0;
  font-size: 1.125rem;
  line-height: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text);
  white-space: nowrap;
}

.brand-mark {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  color: var(--accent);
}

.brand-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  background: var(--brand-gradient);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-tagline {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-left: 12px;
  border-left: 1px solid var(--border-strong);
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-muted);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.header-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 32px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  box-sizing: border-box;
  transition:
    background-color var(--transition),
    border-color var(--transition),
    color var(--transition),
    transform var(--duration-color) var(--ease);
}

.header-action .ph {
  font-size: 1.125rem;
}

.header-action:hover {
  background: var(--bg-alt);
  color: var(--text);
}

.language-toggle,
.theme-toggle {
  border-color: var(--border-strong);
}

.theme-toggle {
  padding: 0;
  width: 32px;
}

.theme-toggle[aria-expanded="true"] {
  background: var(--bg-alt);
  color: var(--text);
}

.theme-menu {
  min-width: 176px;
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-md) !important;
}

.theme-menu .v-list-item__prepend > .v-icon {
  font-size: 1.125rem;
}

.theme-menu-check {
  font-size: 1rem;
  color: rgb(var(--v-theme-primary));
}

.app-main {
  min-height: calc(100dvh - var(--header-h));
}

@media (max-width: 1024px) {
  .brand-tagline {
    display: none;
  }
}

@media (max-width: 768px) {
  .header-inner {
    gap: 8px;
    padding: 0 12px;
  }

  .site-title {
    font-size: 1rem;
    line-height: 1.5rem;
  }

  .brand-mark {
    width: 20px;
    height: 20px;
  }

  .header-right {
    gap: 4px;
  }

  .header-action {
    padding: 0 8px;
  }

  .github-link-text {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }

  .v-btn:active,
  .v-chip--link:active,
  .header-action:active {
    transform: none;
  }
}
</style>
