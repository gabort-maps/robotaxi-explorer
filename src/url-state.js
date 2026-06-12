// url-state.js — serialize/deserialize app state to and from the URL for shareable links
//
// Hash format: #preset=<id>&v=<model_version>&<variableId>=<value>&...
// Only values that differ from the named preset's baseline are encoded
// (delta encoding), so a pristine preset shares as just "#preset=...&v=...".
// `assumptions` everywhere below is the object returned by loadAssumptions()
// in calculation-engine.js.

/**
 * Round to 4 significant figures and return a compact decimal string.
 * Keeps URLs short while staying well inside every slider's step size.
 */
function roundSig(value) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  return Number(value.toPrecision(4));
}

function defaultPresetId(assumptions) {
  return Object.keys(assumptions.presets)[0];
}

/**
 * Encode the current state as a URL hash string. Variables whose (rounded)
 * value matches the preset baseline are omitted; unknown variable ids in
 * `inputs` are skipped. An unknown presetId falls back to the default preset.
 */
export function encodeState(presetId, inputs, assumptions, modelVersion) {
  const id = assumptions.presets[presetId]
    ? presetId
    : defaultPresetId(assumptions);
  const baseline = assumptions.presets[id].inputs;

  const parts = [
    `preset=${encodeURIComponent(id)}`,
    `v=${encodeURIComponent(modelVersion)}`,
  ];

  for (const variableId of assumptions.variableIds) {
    if (!(variableId in inputs)) continue;
    const rounded = roundSig(inputs[variableId]);
    if (rounded !== roundSig(baseline[variableId])) {
      parts.push(
        `${encodeURIComponent(variableId)}=${encodeURIComponent(String(rounded))}`
      );
    }
  }

  return `#${parts.join('&')}`;
}

/**
 * Parse a hash string back into full state.
 *
 * Returns { presetId, modelVersion, inputs, versionMismatch } where `inputs`
 * is the preset baseline merged with the URL's deltas. Unknown variable ids
 * and non-numeric values are ignored with a warning. A malformed hash (no
 * resolvable preset) returns the default preset with versionMismatch=false.
 */
export function decodeState(hashString, assumptions) {
  const fallback = (warning) => {
    if (warning) {
      console.warn(`url-state: ${warning}; falling back to the default preset`);
    }
    const presetId = defaultPresetId(assumptions);
    return {
      presetId,
      modelVersion: assumptions.modelVersion,
      inputs: { ...assumptions.presets[presetId].inputs },
      versionMismatch: false,
    };
  };

  const raw = (hashString || '').replace(/^#/, '');
  if (raw === '') return fallback(null);

  let params;
  try {
    params = new URLSearchParams(raw);
  } catch (error) {
    return fallback(`could not parse hash "${hashString}"`);
  }

  const presetId = params.get('preset');
  if (!presetId || !assumptions.presets[presetId]) {
    return fallback(`unknown or missing preset in hash "${hashString}"`);
  }

  const urlVersion = params.get('v');
  const versionMismatch =
    urlVersion !== null && urlVersion !== assumptions.modelVersion;

  const inputs = { ...assumptions.presets[presetId].inputs };
  for (const [key, value] of params.entries()) {
    if (key === 'preset' || key === 'v') continue;
    if (!(key in assumptions.variables)) {
      console.warn(`url-state: ignoring unknown variable "${key}" in URL`);
      continue;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      console.warn(
        `url-state: ignoring non-numeric value "${value}" for "${key}"`
      );
      continue;
    }
    inputs[key] = parsed;
  }

  return {
    presetId,
    modelVersion: urlVersion !== null ? urlVersion : assumptions.modelVersion,
    inputs,
    versionMismatch,
  };
}

/**
 * Full shareable URL: baseUrl (any existing hash stripped) + encoded state.
 */
export function buildShareableUrl(
  presetId,
  inputs,
  assumptions,
  modelVersion,
  baseUrl
) {
  const base = baseUrl.split('#')[0];
  return `${base}${encodeState(presetId, inputs, assumptions, modelVersion)}`;
}
