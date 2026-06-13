// app.js — application entry point: wires together UI, calculation engine, charts, and URL state

import './styles.css';
import {
  loadAssumptions,
  computeScenario,
  solveBreakEven,
  computeTornado,
} from './calculation-engine.js';
import {
  encodeState,
  decodeState,
  buildShareableUrl,
  roundSig,
} from './url-state.js';
import * as ui from './ui.js';
import { renderSankey, updateSankey } from './sankey.js';
import { renderTornado, updateTornado } from './tornado.js';
import { MOBILE_QUERY } from './plotly-custom.js';

// Decode with a probe load first: preset baselines are resolved against each
// preset's own architecture, so the decoded inputs are correct even when the
// URL points at the other architecture — we then load that architecture.
const probe = loadAssumptions('waymo_like');
const decoded = decodeState(window.location.hash, probe);
let assumptions =
  decoded.architectureId === 'waymo_like'
    ? probe
    : loadAssumptions(decoded.architectureId);

const root = document.querySelector('#app');

const state = {
  architectureId: decoded.architectureId,
  presetId: decoded.presetId,
  inputs: { ...decoded.inputs },
  scenario: null,
  breakEven: null,
  tornado: null, // consumed by the chart renderers
};

const refs = ui.buildUI(root, assumptions, {
  onSliderInput: handleSliderInput,
  onArchitectureSelect: handleArchitectureSelect,
  onMaturitySelect: handleMaturitySelect,
  onReset: handleReset,
  onShare: handleShare,
});

const debouncedRecompute = ui.debounce(() => {
  recompute();
  syncHash();
}, 50);

let chartsReady = false;

// Variable ids whose current value differs from the active preset's baseline,
// using the URL encoder's rounding so "Adjusted" badges and URL deltas agree.
function adjustedVariableIds() {
  const baseline = assumptions.presets[state.presetId].inputs;
  const adjusted = new Set();
  for (const variableId of assumptions.variableIds) {
    if (roundSig(state.inputs[variableId]) !== roundSig(baseline[variableId])) {
      adjusted.add(variableId);
    }
  }
  return adjusted;
}

function recompute() {
  state.scenario = computeScenario(state.inputs, assumptions);
  state.breakEven = assumptions.mainVariableIds.map((variableId) => ({
    variableId,
    ...solveBreakEven(variableId, state.inputs, assumptions),
  }));
  state.tornado = computeTornado(state.inputs, assumptions);
  state.adjusted = adjustedVariableIds();
  ui.updateOutputs(refs, state.scenario);
  ui.updateBreakEvenList(refs, state.breakEven, assumptions);
  ui.updateAdjustedBadges(refs, state.adjusted);
  if (chartsReady) {
    updateSankey('sankey-chart', state.scenario.sankey.flows);
    updateTornado('tornado-chart', state.tornado);
    ui.updateTornadoBadges(refs, state.tornado, state.adjusted);
  }
}

function syncHash() {
  history.replaceState(
    null,
    '',
    encodeState(state.presetId, state.inputs, assumptions, assumptions.modelVersion)
  );
}

function handleSliderInput(variableId, value) {
  state.inputs[variableId] = value;
  ui.updateSliderValueLabel(refs, variableId, value, assumptions);
  debouncedRecompute();
}

function applyPreset(presetId) {
  state.presetId = presetId;
  state.inputs = { ...assumptions.presets[presetId].inputs };
  ui.updateSliderSpecs(refs, assumptions);
  ui.setActiveArchitecture(refs, assumptions);
  ui.setActiveMaturity(refs, assumptions.presets[presetId].maturity);
  ui.setSliderValues(refs, state.inputs, assumptions);
  recompute();
  syncHash();
}

function handleArchitectureSelect(architectureId) {
  if (architectureId === state.architectureId) return;
  assumptions = loadAssumptions(architectureId);
  state.architectureId = architectureId;
  applyPreset(assumptions.defaultPresetId);
}

function handleMaturitySelect(maturity) {
  applyPreset(`${state.architectureId}_${maturity}`);
}

function handleReset() {
  state.inputs = { ...assumptions.presets[state.presetId].inputs };
  ui.setSliderValues(refs, state.inputs, assumptions);
  recompute();
  syncHash();
}

async function handleShare() {
  syncHash();
  const url = buildShareableUrl(
    state.presetId,
    state.inputs,
    assumptions,
    assumptions.modelVersion,
    window.location.href
  );
  const copied = await copyToClipboard(url);
  ui.showToast(refs, copied ? 'Link copied' : 'Could not copy link');
}

async function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

// Initial paint from the decoded URL state (or the default preset).
ui.setActiveArchitecture(refs, assumptions);
ui.setActiveMaturity(refs, assumptions.presets[state.presetId].maturity);
ui.setSliderValues(refs, state.inputs, assumptions);
if (decoded.versionMismatch) ui.showVersionBanner(refs);
recompute();

renderSankey('sankey-chart', state.scenario.sankey.flows);
renderTornado('tornado-chart', state.tornado);
ui.updateTornadoBadges(refs, state.tornado, state.adjusted);
chartsReady = true;

// Re-render in compact/full form when the viewport crosses the breakpoint;
// width-only resizes are handled by Plotly's responsive config.
window
  .matchMedia(MOBILE_QUERY)
  .addEventListener('change', () => {
    updateSankey('sankey-chart', state.scenario.sankey.flows);
    updateTornado('tornado-chart', state.tornado);
  });
