/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@phosphor-icons/web/regular'
import 'vuetify/styles'

// Composables
import { h } from 'vue'
import { createVuetify } from 'vuetify'
import { getStoredTheme } from '@/utils/themePreference'
import { phosphorAliases } from '@/plugins/phosphorIcons'

// Phosphor 图标走 class 字体：<i class="ph ph-xxx">，与 Vuetify 自带 mdi 集的实现方式一致。
const phosphor = {
  component: props => h(props.tag, { class: ['ph', props.icon] }),
}

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  icons: {
    defaultSet: 'ph',
    aliases: phosphorAliases,
    sets: { ph: phosphor },
  },
  theme: {
    defaultTheme: getStoredTheme(),
    themes: {
      // 深色背景只取 redesign-skill Design Values 的灰阶；强调色只保留一个。
      dark: {
        dark: true,
        colors: {
          background: '#181818',
          surface: '#1F1F1F',
          'surface-bright': '#313131',
          'surface-variant': '#313131',
          'on-surface-variant': '#ECEAE5',
          primary: '#7AA7EE',
          // 浅蓝主色上的白字对比度只有约 2.4:1，改用深色文字。
          'on-primary': '#181818',
          // secondary 用作中性按钮（tonal），取正文色，避免灰字看起来像禁用态。
          secondary: '#ECEAE5',
          'on-secondary': '#181818',
          info: '#7AA7EE',
        },
      },
      light: {
        dark: false,
        colors: {
          background: '#FBFBFA',
          surface: '#FFFFFF',
          'surface-variant': '#F3F2EF',
          'on-surface-variant': '#2F2D29',
          primary: '#2D74DA',
          secondary: '#2F2D29',
          'on-secondary': '#FFFFFF',
          info: '#2D74DA',
        },
      },
    },
  },
  defaults: {
    VSlider: {
      color: 'primary',
    },
    VCheckbox: {
      color: 'primary',
    },
    VImg: {
      eager: true,
    },

  }
})
