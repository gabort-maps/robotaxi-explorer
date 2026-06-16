// tornado.js — tornado (sensitivity) chart rendering via Plotly
//
// Horizontal bar pairs: for each main variable, the change in enterprise
// result when that variable moves to its credible range.low / range.high
// while everything else stays at the current scenario value. Rows arrive
// pre-sorted by computeTornado() (largest absolute impact first) and render
// top-down in that order. Bars use diverging colours: red for a negative
// impact on enterprise result (worsening), green for positive (improving).
// Confidence is shown by the badge column ui.js renders beside the chart.
// Bar lengths are NOT normalised — a wider bar genuinely means a wider
// evidence range.

import Plotly, {
  BASE_CONFIG,
  FONT_FAMILY,
  isCompact,
} from './plotly-custom.js';
import { SHORT_LABELS } from './ui.js';

// Analytical diverging palette — distinguishable in light/dark contexts.
const COLOR_NEG = '#C97164'; // soft coral — worsening
const COLOR_POS = '#3FA89F'; // muted teal — improving

function barColors(xs) {
  return xs.map((x) => (x < 0 ? COLOR_NEG : COLOR_POS));
}

// ui.js mirrors these as the badge column's vertical padding so the badges
// line up with the bar rows (see .tornado-badges in styles.css).
export const TORNADO_MARGIN = { l: 8, r: 6, t: 8, b: 44 };

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

/** Format an impact value as currency string: -$0.16 or $0.86 */
function fmtImpact(x) {
  const abs = Math.abs(x).toFixed(2);
  return x < 0 ? `-$${abs}` : `$${abs}`;
}

function buildFigure(tornadoData, options) {
  const compact = isCompact(options);
  const labels = tornadoData.map(
    (row) => SHORT_LABELS[row.variableId] ?? row.label
  );
  const rangeBasis = tornadoData.map((row) => wrapForHover(row.range_basis));
  // Pre-format impact values in JS — Plotly's d3-format parsing drops the
  // sign+currency combination (+$.2f), producing raw float strings instead.
  const hovertemplate =
    '<b>%{y}</b><br>Impact at range %{fullData.name}: %{customdata[0]} per paid mile' +
    '<br><br><i>Why this range:</i><br>%{customdata[1]}<extra></extra>';

  const makeTrace = (name, xs) => ({
    type: 'bar',
    orientation: 'h',
    name,
    y: labels,
    x: xs.map((x) => parseFloat(x.toFixed(2))),
    marker: { color: barColors(xs) },
    customdata: xs.map((x, i) => [fmtImpact(x), rangeBasis[i]]),
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
        text: 'Impact on enterprise result ($/paid mile)',
        font: { size: compact ? 10 : 12, color: '#5b6573' },
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
