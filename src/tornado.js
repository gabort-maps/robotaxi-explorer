// tornado.js — tornado (sensitivity) chart rendering via Plotly
//
// Horizontal bar pairs: for each main variable, the change in enterprise
// result when that variable moves to its credible range.low / range.high
// while everything else stays at the current scenario value. Rows arrive
// pre-sorted by computeTornado() (largest absolute impact first) and render
// top-down in that order. Bars use one neutral accent on purpose: confidence
// is shown by the badge column ui.js renders next to this chart, not by
// color, and bar lengths are NOT normalised — a wider bar genuinely means a
// wider evidence range.

import Plotly, {
  BASE_CONFIG,
  FONT_FAMILY,
  isCompact,
} from './plotly-custom.js';

const BAR_COLOR = '#1f4e8c';

// ui.js mirrors these as the badge column's vertical padding so the badges
// line up with the bar rows (see .tornado-badges in styles.css).
export const TORNADO_MARGIN = { l: 8, r: 16, t: 8, b: 44 };

/** Break hover text into <br>-separated lines so tooltips stay readable. */
function wrapForHover(text, lineLength = 55) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > lineLength) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('<br>');
}

function buildFigure(tornadoData, options) {
  const compact = isCompact(options);
  const labels = tornadoData.map((row) => row.label);
  const rangeBasis = tornadoData.map((row) => wrapForHover(row.range_basis));
  const hovertemplate =
    '<b>%{y}</b><br>Impact at range %{fullData.name}: %{x:+$.2f} per paid mile' +
    '<br><br><i>Why this range:</i><br>%{customdata}<extra></extra>';

  const makeTrace = (name, xs) => ({
    type: 'bar',
    orientation: 'h',
    name,
    y: labels,
    x: xs,
    marker: { color: BAR_COLOR },
    customdata: rangeBasis,
    hovertemplate,
    showlegend: false,
  });

  const data = [
    makeTrace('low', tornadoData.map((row) => row.impactLow)),
    makeTrace('high', tornadoData.map((row) => row.impactHigh)),
  ];

  const layout = {
    barmode: 'overlay',
    bargap: 0.3,
    height: compact ? 240 : 280,
    margin: TORNADO_MARGIN,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: FONT_FAMILY, size: compact ? 10 : 12, color: '#1c2430' },
    xaxis: {
      title: {
        text: 'Change in enterprise result ($ per paid mile)',
        font: { size: compact ? 9 : 11, color: '#5b6573' },
      },
      tickformat: '$.2f',
      zeroline: true,
      zerolinecolor: '#9aa4b0',
      zerolinewidth: 1,
      gridcolor: '#e7ebf0',
      fixedrange: true,
    },
    yaxis: {
      // computeTornado sorts most impactful first; reversed puts it on top.
      autorange: 'reversed',
      automargin: true,
      ticksuffix: ' ',
      fixedrange: true,
    },
    hoverlabel: {
      align: 'left',
      font: { family: FONT_FAMILY, size: compact ? 10 : 11 },
    },
    showlegend: false,
  };

  return { data, layout };
}

export function renderTornado(containerId, tornadoData, options = {}) {
  const container = document.getElementById(containerId);
  // Drop the placeholder frame and caption — newPlot appends to the
  // container rather than replacing its content.
  container.classList.remove('chart-placeholder');
  container.replaceChildren();
  const { data, layout } = buildFigure(tornadoData, options);
  return Plotly.newPlot(container, data, layout, BASE_CONFIG);
}

export function updateTornado(containerId, tornadoData, options = {}) {
  const container = document.getElementById(containerId);
  const { data, layout } = buildFigure(tornadoData, options);
  return Plotly.react(container, data, layout, BASE_CONFIG);
}
