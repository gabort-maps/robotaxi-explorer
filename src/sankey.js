// sankey.js — Sankey diagram rendering via Plotly
//
// Renders the per-paid-mile money flow from computeScenario().sankey.flows:
// gross fare on the left splitting into leakage and net revenue, then four
// cost ribbons (vehicle depreciation, direct running cost, local fleet ops,
// city launch) plus city contribution, which feeds the platform and either
// an enterprise surplus or — in loss cases — is topped up by an External
// funding source node. Zero-value flows (and the nodes they would orphan)
// are dropped, so the surplus node only appears in profitable scenarios and
// the external-funding node only in loss-making ones.

import Plotly, {
  BASE_CONFIG,
  FONT_FAMILY,
  isCompact,
} from './plotly-custom.js';

// Canonical node order, palette and layout hints. Colors: calm blue for
// revenue, coral/amber family for the cost nodes, green for contribution and
// surplus, muted red for external funding. x/y are normalized layout hints
// for arrangement:"snap" — x fixes the column, y suggests vertical order and
// lets Plotly resolve overlaps as node sizes change with the sliders.
const NODES = {
  'Gross fare': { color: '#3a6ea5', short: 'Fare', x: 0.01, y: 0.5 },
  'Revenue leakage': { color: '#8a93a0', short: 'Leakage', x: 0.32, y: 0.03 },
  'Net revenue': { color: '#4a7fb5', short: 'Net rev.', x: 0.32, y: 0.6 },
  'Vehicle depreciation': { color: '#d96f4e', short: 'Depreciation', x: 0.62, y: 0.08 },
  'Direct running cost': { color: '#e58e6c', short: 'Running', x: 0.62, y: 0.3 },
  'Local fleet operations': { color: '#dd9a3c', short: 'Fleet ops', x: 0.62, y: 0.5 },
  'City launch and recurring': { color: '#d39a72', short: 'City launch', x: 0.62, y: 0.68 },
  'City contribution': { color: '#2f9e63', short: 'Contribution', x: 0.62, y: 0.88 },
  'External funding': { color: '#a94747', short: 'Ext. funding', x: 0.78, y: 0.96 },
  'Platform cost': { color: '#c2703f', short: 'Platform', x: 0.99, y: 0.78 },
  'Enterprise surplus': { color: '#156e42', short: 'Surplus', x: 0.99, y: 0.3 },
};

const EPSILON = 1e-9;

function rgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildFigure(sankeyFlows, options) {
  const compact = isCompact(options);
  const flows = sankeyFlows.filter((flow) => flow.value > EPSILON);

  const names = Object.keys(NODES).filter((name) =>
    flows.some((flow) => flow.source === name || flow.target === name)
  );
  const index = new Map(names.map((name, i) => [name, i]));

  // A node's headline value is its larger side: sources have only outflow,
  // sinks only inflow, and pass-through nodes are balanced by construction.
  const totals = names.map((name) => {
    let inflow = 0;
    let outflow = 0;
    for (const flow of flows) {
      if (flow.target === name) inflow += flow.value;
      if (flow.source === name) outflow += flow.value;
    }
    return Math.max(inflow, outflow);
  });

  const labels = names.map((name, i) => {
    const title = compact ? NODES[name].short : name;
    return `${title}<br>$${totals[i].toFixed(2)}`;
  });

  // Ribbons take their target node's color so each cost stream reads as
  // "money becoming that cost" — except external funding, whose ribbon keeps
  // the muted red of its source to flag that the platform is being subsidised.
  const linkColors = flows.map((flow) =>
    flow.source === 'External funding'
      ? rgba(NODES['External funding'].color, 0.45)
      : rgba(NODES[flow.target].color, 0.38)
  );

  const data = [
    {
      type: 'sankey',
      orientation: 'h',
      arrangement: 'snap',
      valueformat: '$.2f',
      valuesuffix: ' per paid mile',
      node: {
        label: labels,
        color: names.map((name) => NODES[name].color),
        x: names.map((name) => NODES[name].x),
        y: names.map((name) => NODES[name].y),
        pad: compact ? 10 : 18,
        thickness: compact ? 12 : 16,
        line: { width: 0 },
      },
      link: {
        source: flows.map((flow) => index.get(flow.source)),
        target: flows.map((flow) => index.get(flow.target)),
        value: flows.map((flow) => flow.value),
        color: linkColors,
      },
      textfont: { family: FONT_FAMILY, size: compact ? 10 : 12, color: '#1c2430' },
    },
  ];

  const layout = {
    // 20px side margins keep node labels inside the container (styles.css
    // additionally clamps the SVG to the container width).
    height: compact ? 200 : 320,
    margin: { l: 20, r: 20, t: 12, b: 12 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: FONT_FAMILY, size: compact ? 10 : 12 },
    hoverlabel: { font: { family: FONT_FAMILY, size: compact ? 10 : 12 } },
  };

  return { data, layout };
}

export function renderSankey(containerId, sankeyFlows, options = {}) {
  const container = document.getElementById(containerId);
  // Drop the placeholder frame and caption — newPlot appends to the
  // container rather than replacing its content.
  container.classList.remove('chart-placeholder');
  container.replaceChildren();
  const { data, layout } = buildFigure(sankeyFlows, options);
  return Plotly.newPlot(container, data, layout, BASE_CONFIG);
}

export function updateSankey(containerId, sankeyFlows, options = {}) {
  const container = document.getElementById(containerId);
  const { data, layout } = buildFigure(sankeyFlows, options);
  return Plotly.react(container, data, layout, BASE_CONFIG);
}
