/**
 * plugins/vuetify.js
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import 'vuetify/styles'

// Composables
import { h } from 'vue'
import { createVuetify } from 'vuetify'
import { aliases, mdi as mdiSvg } from 'vuetify/iconsets/mdi-svg'
import { getStoredTheme } from '@/utils/themePreference'
import { resolveMdiIconPath } from './mdiIcons'

// `mdi-*` icon names render as inline SVG (see ./mdiIcons.js) instead of the webfont.
const mdi = {
  component: (props) => h(mdiSvg.component, { ...props, icon: resolveMdiIconPath(props.icon) }),
}

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
  theme: {
    defaultTheme: getStoredTheme(),
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
