// plotly-custom.js — Plotly import wrapper and shared chart configuration/theming
//
// Bundle decision: the preferred route was a custom bundle from
// plotly.js/lib/core with only the sankey and bar traces registered. That
// requires the customizable `plotly.js` package, which is not a dependency
// here (only plotly.js-dist-min is), its lib/* entry points depend on
// browserify-style transforms that Vite's rollup pipeline does not run, and
// sankey is not included in any official partial dist bundle anyway. So we
// use the prebuilt minified full bundle, as allowed, and keep this module as
// the single place to change if a custom bundle becomes viable later.

import Plotly from 'plotly.js-dist-min';

export const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export const MOBILE_QUERY = '(max-width: 719.98px)';

/** True when charts should render in their compact (narrow-screen) form. */
export function isCompact(options = {}) {
  if (typeof options.compact === 'boolean') return options.compact;
  return window.matchMedia(MOBILE_QUERY).matches;
}

// Hover tooltips stay enabled (staticPlot would disable them); the modebar
// and every other interaction are off.
export const BASE_CONFIG = {
  displayModeBar: false,
  responsive: true,
  scrollZoom: false,
  doubleClick: false,
  showTips: false,
};

export default Plotly;
