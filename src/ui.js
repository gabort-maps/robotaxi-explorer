// ui.js — DOM construction and user input handling (sliders, controls, layout)
//
// Pure DOM module: no model imports and no global state. buildUI() renders the
// whole page into a root element and returns element references; app.js owns
// the application state and calls the update helpers below on each recompute.

const BADGE_TEXT = {
  high: { long: 'High', short: 'H' },
  medium: { long: 'Med', short: 'M' },
  low: { long: 'Low', short: 'L' },
  'very-low': { long: 'Very Low', short: 'VL' },
};

// Compact labels for the segmented architecture toggle; tooltips keep the
// data file's full descriptions.
const ARCH_LABEL_OVERRIDES = {
  waymo_like: 'Waymo-like',
  cybercab: 'Cybercab claim-based',
};

// Shortened labels for the desktop 3-column slider grid; the mobile
// single-column list keeps the full data-file labels (CSS swaps the spans).
// Variables not listed here are short enough to use their full label.
const SHORT_LABELS = {
  gross_fare_per_paid_mile: 'Fare / paid mile',
  revenue_leakage_rate: 'Revenue leakage',
  vehicle_av_capex: 'Vehicle + AV-kit cost',
  vehicle_lifetime_miles: 'Lifetime miles',
  direct_running_cost_per_total_mile: 'Running cost',
  local_fleet_ops_cost_per_total_mile: 'Fleet ops cost',
  active_vehicles_per_city: 'Vehicles per city',
  number_of_cities: 'Active cities',
  annual_platform_cost: 'Platform cost / yr',
  annual_city_cost_per_city: 'City launch / yr',
};

// All four are USD per paid mile; the label and number carry the card alone.
const OUTPUT_CARDS = [
  { key: 'direct_cost_per_paid_mile', label: 'Direct cost per paid mile' },
  { key: 'city_contribution_per_paid_mile', label: 'City contribution' },
  { key: 'enterprise_result_per_paid_mile', label: 'Enterprise result' },
  { key: 'break_even_gap_per_paid_mile', label: 'Break-even gap' },
];

const SHARE_ICON_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>' +
  '<path d="M8.7 13.5l6.6 3.9M15.3 6.6l-6.6 3.9"/></svg>';

export function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * Collapse the data file's graded confidence scale into four badge levels:
 * high/medium-high → High, medium/medium-low/low-medium → Med, low → Low,
 * very-low → Very Low. Unrecognized grades default to the middle level.
 */
export function confidenceLevel(confidence) {
  if (confidence === 'high' || confidence === 'medium-high') return 'high';
  if (confidence === 'very-low') return 'very-low';
  if (confidence === 'low') return 'low';
  return 'medium';
}

/**
 * Slider bounds and step for a variable. Min/max derive from the credible
 * range, extended to cover preset values that sit outside it (e.g. the
 * mature presets' vehicle capex below range.low) so selecting a preset never
 * clamps a slider. Step targets ~100 stops, snapped to a 1/2/5 decade value.
 */
export function sliderSpec(variableId, assumptions) {
  const def = assumptions.variables[variableId];
  // only this architecture's presets — the other architecture's baselines
  // must not stretch these slider bounds
  const presetValues = Object.values(assumptions.presets)
    .filter((preset) => preset.architecture === assumptions.architectureId)
    .map((preset) => preset.inputs[variableId]);
  const min = Math.min(def.range.low, ...presetValues);
  const max = Math.max(def.range.high, ...presetValues);

  const raw = (def.range.high - def.range.low) / 100;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  let best = 1;
  for (const candidate of [1, 2, 5, 10]) {
    if (Math.abs(Math.log(candidate / norm)) < Math.abs(Math.log(best / norm))) {
      best = candidate;
    }
  }
  let step = Number((best * magnitude).toPrecision(12));
  // integer quantities (the data file declares an integer step, e.g. cities)
  // never get fractional steps
  if (def.slider && Number.isInteger(def.slider.step) && step < 1) {
    step = 1;
  }

  return { min, max, step };
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function decimalsForStep(step) {
  const text = String(step);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function trimmed(value, decimals) {
  return String(parseFloat(value.toFixed(decimals)));
}

const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function compactUsd(value) {
  if (Math.abs(value) >= 1e9) return `$${trimmed(value / 1e9, 2)}B`;
  if (Math.abs(value) >= 1e6) return `$${trimmed(value / 1e6, 1)}M`;
  return `$${intFmt.format(value)}`;
}

/** Human-readable value for a variable, using its unit from assumptions.json. */
export function formatVariableValue(variableId, value, assumptions) {
  const def = assumptions.variables[variableId];
  const { step } = sliderSpec(variableId, assumptions);
  if (def.display_unit === '%') {
    return `${trimmed(value * 100, Math.max(0, decimalsForStep(step) - 2))}%`;
  }
  const decimals = Math.max(2, decimalsForStep(step));
  switch (def.unit) {
    case 'USD per paid mile':
      return `$${value.toFixed(decimals)} /paid mi`;
    case 'USD per total vehicle mile':
      return `$${value.toFixed(decimals)} /mi`;
    case 'USD per vehicle':
      return compactUsd(value);
    case 'USD per year':
      return `${compactUsd(value)} /yr`;
    case 'USD per city-year':
      return `${compactUsd(value)} /city-yr`;
    case 'total vehicle miles':
      return `${intFmt.format(value)} mi`;
    case 'vehicles per city':
      return `${intFmt.format(value)} vehicles`;
    case 'cities':
      return `${trimmed(value, 1)} cities`;
    default:
      return `${trimmed(value, 2)} ${def.unit}`;
  }
}

/** Output-card formatting: signed USD per paid mile, two decimals. */
export function formatPerPaidMile(value) {
  const sign = value < 0 ? '−' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function makeBadge(confidence) {
  const level = confidenceLevel(confidence);
  return el(
    'span',
    { class: `badge badge-${level}`, title: `Confidence: ${confidence}` },
    el('span', { class: 'badge-long' }, BADGE_TEXT[level].long),
    el('span', { class: 'badge-short' }, BADGE_TEXT[level].short)
  );
}

function makeAdjustedBadge() {
  return el(
    'span',
    { class: 'badge badge-adjusted', title: 'Adjusted from the preset baseline' },
    el('span', { class: 'badge-long' }, 'Adjusted'),
    el('span', { class: 'badge-short' }, 'Adj')
  );
}

function buildSliderRow(refs, variableId, assumptions, onInput) {
  const def = assumptions.variables[variableId];
  const spec = sliderSpec(variableId, assumptions);

  const badgeSlot = el('span', { class: 'badge-slot' }, makeBadge(def.confidence));
  const valueEl = el('span', { class: 'slider-value' }, '—');
  const input = el('input', {
    type: 'range',
    min: spec.min,
    max: spec.max,
    step: spec.step,
    'aria-label': def.label,
  });
  input.addEventListener('input', () => onInput(variableId, Number(input.value)));

  const row = el(
    'div',
    { class: 'slider-row', title: def.methodology_note },
    el(
      'div',
      { class: 'slider-head' },
      el(
        'span',
        { class: 'slider-label' },
        el('span', { class: 'label-full' }, def.label),
        el('span', { class: 'label-short' }, SHORT_LABELS[variableId] ?? def.label),
        badgeSlot
      ),
      valueEl
    ),
    input
  );

  refs.sliders.set(variableId, {
    input,
    valueEl,
    badgeSlot,
    row,
    confidence: def.confidence,
  });

  return row;
}

/**
 * Build the full page into `root`. `handlers` supplies onSliderInput(id,
 * value), onArchitectureSelect(id), onMaturitySelect(maturity), onReset()
 * and onShare(). Returns the refs object used by every update helper in
 * this module.
 */
export function buildUI(root, assumptions, handlers) {
  const refs = {
    sliders: new Map(),
    archButtons: new Map(),
    maturityButtons: new Map(),
    outputs: new Map(),
    toastTimer: null,
  };

  refs.banner = el(
    'div',
    { class: 'version-banner' },
    'This link was created with an earlier version of the model. Current values may differ.'
  );
  refs.banner.hidden = true;

  const header = el(
    'header',
    { class: 'site-header' },
    el(
      'div',
      { class: 'title-row' },
      el('h1', {}, 'Robotaxi Scalability Explorer'),
      el('a', { class: 'methodology-link', href: '#methodology' }, 'How to read this model')
    ),
    el('p', { class: 'subtitle' }, assumptions.positioning)
  );

  // architecture: compact segmented toggle, quieter than the maturity buttons
  const archSegments = el('div', {
    class: 'arch-segments',
    role: 'group',
    'aria-label': 'Architecture',
  });
  for (const [id, arch] of Object.entries(assumptions.architectures)) {
    const button = el(
      'button',
      { class: 'arch-button', type: 'button', title: arch.description },
      ARCH_LABEL_OVERRIDES[id] ?? arch.label
    );
    button.addEventListener('click', () => handlers.onArchitectureSelect(id));
    refs.archButtons.set(id, button);
    archSegments.append(button);
  }
  const archToggle = el(
    'div',
    { class: 'arch-toggle' },
    el('span', { class: 'arch-toggle-label' }, 'Architecture:'),
    archSegments
  );

  // maturity selector — three buttons; the active preset is
  // `${architectureId}_${maturity}`
  const presetGrid = el('div', { class: 'preset-grid' });
  for (const maturity of assumptions.maturities) {
    const preset = assumptions.presets[`${assumptions.architectureId}_${maturity}`];
    const label = preset.label.includes('·')
      ? preset.label.split('·').pop().trim()
      : maturity;
    const button = el(
      'button',
      { class: 'preset-button', type: 'button', title: preset.description },
      label
    );
    button.addEventListener('click', () => handlers.onMaturitySelect(maturity));
    refs.maturityButtons.set(maturity, button);
    presetGrid.append(button);
  }
  refs.resetButton = el(
    'button',
    {
      class: 'reset-button',
      type: 'button',
      title: 'Restore the active preset’s baseline values',
    },
    'Reset'
  );
  refs.resetButton.addEventListener('click', handlers.onReset);

  refs.shareButton = el('button', { class: 'share-button', type: 'button' });
  refs.shareButton.innerHTML = SHARE_ICON_SVG;
  refs.shareButton.append(' Copy link');
  refs.shareButton.addEventListener('click', handlers.onShare);

  // utilities row (demoted, right-aligned) above the scenario row
  const actionsRow = el(
    'div',
    { class: 'actions-row' },
    refs.resetButton,
    refs.shareButton
  );
  // single scenario row: maturity buttons left, architecture toggle right;
  // mobile reverses to stack the toggle above the maturity buttons
  const scenarioRow = el(
    'div',
    { class: 'scenario-row' },
    presetGrid,
    archToggle
  );

  const mainSliders = el('div', { class: 'sliders' });
  for (const id of assumptions.mainVariableIds) {
    mainSliders.append(buildSliderRow(refs, id, assumptions, handlers.onSliderInput));
  }
  const advancedSliders = el('div', { class: 'sliders' });
  for (const id of assumptions.variableIds) {
    if (!assumptions.mainVariableIds.includes(id)) {
      advancedSliders.append(buildSliderRow(refs, id, assumptions, handlers.onSliderInput));
    }
  }
  // Mobile-only sticky strip (display: none on desktop): the two headline
  // numbers stay readable while the reader drags sliders. It lives inside the
  // controls section so position: sticky releases it once the controls
  // scroll out of view. The output cards repeat these values for assistive
  // tech, so the strip is decorative duplication.
  refs.stripGap = el('span', { class: 'readout-value' }, '—');
  refs.stripResult = el('span', { class: 'readout-value' }, '—');
  const readoutStrip = el(
    'div',
    { class: 'readout-strip', 'aria-hidden': 'true' },
    el(
      'div',
      { class: 'readout-item' },
      el('span', { class: 'readout-label' }, 'Break-even gap'),
      refs.stripGap
    ),
    el(
      'div',
      { class: 'readout-item' },
      el('span', { class: 'readout-label' }, 'Enterprise result'),
      refs.stripResult
    )
  );

  const controls = el(
    'section',
    { class: 'section-controls' },
    readoutStrip,
    mainSliders,
    el(
      'details',
      { class: 'advanced' },
      el('summary', {}, 'Show platform and expansion controls'),
      advancedSliders
    )
  );

  const cards = el('div', { class: 'cards' });
  for (const card of OUTPUT_CARDS) {
    const valueEl = el('div', { class: 'card-value' }, '—');
    refs.outputs.set(card.key, valueEl);
    cards.append(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-label' }, card.label),
        valueEl
      )
    );
  }
  // derived, read-only: total fleet = cities × vehicles per city
  refs.fleetLine = el('div', { class: 'fleet-line' }, '—');
  const outputs = el('section', { class: 'section-outputs' }, refs.fleetLine, cards);

  const sankey = el(
    'section',
    { class: 'section-sankey' },
    el(
      'div',
      { id: 'sankey-chart', class: 'chart-placeholder chart-sankey' },
      el('span', { class: 'chart-caption' }, 'Sankey chart loads here')
    )
  );

  refs.breakEvenList = el('ul', { class: 'breakeven-list' });
  const breakeven = el(
    'section',
    { class: 'section-breakeven' },
    el('h2', {}, 'What must become true'),
    el(
      'p',
      { class: 'section-note' },
      'Holding everything else at the current scenario value, the break-even point for each main assumption — when one exists inside its evidence-based range.'
    ),
    refs.breakEvenList
  );

  const explorerMain = el(
    'main',
    { id: 'explorer-main' },
    controls,
    outputs,
    sankey,
    breakeven
  );

  // Confidence lives in this badge column beside the chart, never in bar
  // color — updateTornadoBadges() re-renders it in chart row order.
  refs.tornadoBadges = el('div', { class: 'tornado-badges' });
  const tornado = el(
    'section',
    { class: 'section-tornado' },
    el('h2', {}, 'What moves the result most'),
    el(
      'div',
      { class: 'tornado-wrap' },
      el(
        'div',
        { id: 'tornado-chart', class: 'chart-placeholder chart-tornado' },
        el('span', { class: 'chart-caption' }, 'Tornado chart loads here')
      ),
      refs.tornadoBadges
    )
  );

  const githubLink = el(
    'a',
    {
      href: 'https://github.com/placeholder/robotaxi-explorer/tree/main/data',
      target: '_blank',
      rel: 'noopener',
    },
    'data files on GitHub'
  );
  const footer = el(
    'footer',
    { id: 'methodology', class: 'methodology' },
    el('h2', {}, 'Methodology'),
    el(
      'p',
      {},
      'Every assumption carries an evidence-based low–high range. In the sensitivity (tornado) view, a wider bar means the evidence is genuinely more uncertain: range widths reflect the strength of the available evidence, not a modelling choice, and they are deliberately not normalised to make variables look equally important.'
    ),
    el('p', {}, 'All assumptions, ranges, sources and formulas live in the project’s ', githubLink, '.')
  );

  refs.toast = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });

  root.append(
    refs.banner,
    el(
      'div',
      { class: 'container' },
      header,
      actionsRow,
      scenarioRow,
      explorerMain,
      tornado,
      footer
    ),
    refs.toast
  );

  return refs;
}

export function showVersionBanner(refs) {
  refs.banner.hidden = false;
}

export function setActiveArchitecture(refs, assumptions) {
  for (const [id, button] of refs.archButtons) {
    button.classList.toggle('active', id === assumptions.architectureId);
  }
  // preset descriptions (tooltips) are architecture-specific
  for (const [maturity, button] of refs.maturityButtons) {
    const preset = assumptions.presets[`${assumptions.architectureId}_${maturity}`];
    if (preset) button.title = preset.description;
  }
}

export function setActiveMaturity(refs, maturity) {
  for (const [id, button] of refs.maturityButtons) {
    button.classList.toggle('active', id === maturity);
  }
}

/**
 * Re-point every slider at the current architecture's ranges: min/max/step,
 * the stored confidence grade (read by updateAdjustedBadges on the next
 * recompute) and the methodology tooltip. Call after loadAssumptions() for a
 * new architecture, before setSliderValues().
 */
export function updateSliderSpecs(refs, assumptions) {
  for (const [variableId, slider] of refs.sliders) {
    const def = assumptions.variables[variableId];
    const spec = sliderSpec(variableId, assumptions);
    slider.input.min = spec.min;
    slider.input.max = spec.max;
    slider.input.step = spec.step;
    slider.confidence = def.confidence;
    slider.row.title = def.methodology_note;
  }
}

export function setSliderValues(refs, inputs, assumptions) {
  for (const [variableId, slider] of refs.sliders) {
    slider.input.value = inputs[variableId];
    slider.valueEl.textContent = formatVariableValue(
      variableId,
      inputs[variableId],
      assumptions
    );
  }
}

export function updateSliderValueLabel(refs, variableId, value, assumptions) {
  refs.sliders.get(variableId).valueEl.textContent = formatVariableValue(
    variableId,
    value,
    assumptions
  );
}

export function updateOutputs(refs, scenario) {
  for (const { key } of OUTPUT_CARDS) {
    const value = scenario.outputs[key];
    const valueEl = refs.outputs.get(key);
    valueEl.textContent = formatPerPaidMile(value);
    // The gap is never negative, but a positive gap is the bad direction.
    const danger =
      key === 'break_even_gap_per_paid_mile' ? value > 0 : value < 0;
    valueEl.classList.toggle('negative', danger);
  }
  const cities = scenario.inputs.number_of_cities;
  refs.fleetLine.textContent = `Total fleet across ${trimmed(cities, 1)} ${
    cities === 1 ? 'city' : 'cities'
  }: ${intFmt.format(scenario.derived.total_active_fleet)} vehicles`;

  const gap = scenario.outputs.break_even_gap_per_paid_mile;
  const result = scenario.outputs.enterprise_result_per_paid_mile;
  refs.stripGap.textContent = formatPerPaidMile(gap);
  refs.stripGap.classList.toggle('negative', gap > 0);
  refs.stripResult.textContent = formatPerPaidMile(result);
  refs.stripResult.classList.toggle('negative', result < 0);
}

/**
 * Swap each slider's badge between its confidence grade and the grey
 * "Adjusted" badge. `adjustedIds` is the set of variable ids whose current
 * value differs from the active preset's baseline under the URL encoder's
 * 4-significant-figure rounding (app.js computes it with roundSig).
 */
export function updateAdjustedBadges(refs, adjustedIds) {
  for (const [variableId, slider] of refs.sliders) {
    slider.badgeSlot.replaceChildren(
      adjustedIds.has(variableId)
        ? makeAdjustedBadge()
        : makeBadge(slider.confidence)
    );
  }
}

export function updateBreakEvenList(refs, rows, assumptions) {
  refs.breakEvenList.replaceChildren();
  for (const row of rows) {
    const def = assumptions.variables[row.variableId];
    let status;
    let cls;
    if (row.achievable) {
      status = `must reach ${formatVariableValue(row.variableId, row.value, assumptions)}`;
      cls = 'achievable';
    } else if (row.message.startsWith('Already at or above')) {
      status = 'already at or above break-even across its credible range';
      cls = 'satisfied';
    } else {
      status = 'not achievable within the evidence-based range';
      cls = 'not-achievable';
    }
    refs.breakEvenList.append(
      el(
        'li',
        { class: `breakeven-item ${cls}` },
        el('span', { class: 'breakeven-label' }, def.label),
        el('span', { class: 'breakeven-status' }, status)
      )
    );
  }
}

/**
 * Re-render the confidence badge column beside the tornado chart. `rows` is
 * the computeTornado() output, already in the chart's top-to-bottom order;
 * .tornado-badges in styles.css mirrors the chart's vertical margins so each
 * badge centers on its bar row.
 */
export function updateTornadoBadges(refs, rows, adjustedIds = new Set()) {
  refs.tornadoBadges.replaceChildren();
  for (const row of rows) {
    refs.tornadoBadges.append(
      el(
        'div',
        { class: 'tornado-badge-row' },
        adjustedIds.has(row.variableId)
          ? makeAdjustedBadge()
          : makeBadge(row.confidence)
      )
    );
  }
}

export function showToast(refs, message) {
  refs.toast.textContent = message;
  refs.toast.classList.add('visible');
  clearTimeout(refs.toastTimer);
  refs.toastTimer = setTimeout(() => {
    refs.toast.classList.remove('visible');
  }, 2000);
}
