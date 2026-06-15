// url-state.js — serialize/deserialize app state to and from the URL for shareable links
//
// Hash format (v0.3.0): #preset=<id>&v=<model_version>&arch=<architectureId>&<variableId>=<value>&...
// Only values that differ from the named preset's baseline are encoded
// (delta encoding), so a pristine preset shares as just "#preset=...&v=...&arch=...".
// `assumptions` everywhere below is the object returned by loadAssumptions();
// its presets carry per-preset `architecture` and architecture-correct
// baseline `inputs` for all nine presets, which is what makes decoding work
// before the right architecture has been loaded.

/**
 * Round to 4 significant figures. Keeps URLs short while staying well inside
 * every slider's step size. Exported so the UI's "Adjusted" badge uses the
 * exact same differs-from-baseline test as the URL delta encoding.
 */
export function roundSig(value) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  return Number(value.toPrecision(4));
}

// v0.1.0 share links used maturity-only preset ids for what is now the
// waymo_current architecture. Map them to the intermediate waymo_like ids
// so they can then be chained through the v0.2.3 migration below.
const V1_PRESET_MIGRATION = {
  early_growth: 'waymo_like_early_growth',
  mature_dense: 'waymo_like_mature_dense',
  replicated_multicity: 'waymo_like_replicated_multicity',
};

// v0.2.3 share links used waymo_like_* preset ids that were renamed to
// waymo_current_* in v0.3.0. Both migrations set versionMismatch=true.
const V23_PRESET_MIGRATION = {
  waymo_like_early_growth: 'waymo_current_early_growth',
  waymo_like_mature_dense: 'waymo_current_mature_dense',
  waymo_like_replicated_multicity: 'waymo_current_replicated_multicity',
};

function defaultPresetId(assumptions) {
  return Object.keys(assumptions.presets)[0];
}

/**
 * Encode the current state as a URL hash string. The architecture id comes
 * from the preset record. Variables whose (rounded) value matches the preset
 * baseline are omitted; unknown variable ids in `inputs` are skipped. An
 * unknown presetId falls back to the default preset.
 */
export function encodeState(presetId, inputs, assumptions, modelVersion) {
  const id = assumptions.presets[presetId]
    ? presetId
    : defaultPresetId(assumptions);
  const preset = assumptions.presets[id];
  const baseline = preset.inputs;

  const parts = [
    `preset=${encodeURIComponent(id)}`,
    `v=${encodeURIComponent(modelVersion)}`,
    `arch=${encodeURIComponent(preset.architecture)}`,
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
 * Returns { presetId, architectureId, modelVersion, inputs, versionMismatch }
 * where `inputs` is the preset baseline merged with the URL's deltas and
 * architectureId is inferred from the preset (preset ids embed the
 * architecture prefix; the preset record is authoritative).
 *
 * Migration chain:
 *   v0.1.0 maturity-only ids (e.g. "early_growth") → waymo_like_* →
 *   v0.2.3 waymo_like_* → waymo_current_* (current)
 *
 * Both migrations set versionMismatch=true. Unknown variable ids and non-numeric
 * values are ignored with a warning. A malformed hash (no resolvable preset)
 * returns the default preset with versionMismatch=false.
 */
export function decodeState(hashString, assumptions) {
  const fallback = (warning) => {
    if (warning) {
      console.warn(`url-state: ${warning}; falling back to the default preset`);
    }
    const presetId = defaultPresetId(assumptions);
    return {
      presetId,
      architectureId: assumptions.presets[presetId].architecture,
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

  let presetId = params.get('preset');
  let migrated = false;

  // v0.1.0 → waymo_like_* (intermediate step)
  if (presetId && V1_PRESET_MIGRATION[presetId]) {
    console.warn(
      `url-state: migrating v0.1.0 preset "${presetId}" to "${V1_PRESET_MIGRATION[presetId]}"`
    );
    presetId = V1_PRESET_MIGRATION[presetId];
    migrated = true;
  }

  // v0.2.3 waymo_like_* → waymo_current_* (chains from v0.1.0 migration above)
  if (presetId && V23_PRESET_MIGRATION[presetId]) {
    console.warn(
      `url-state: migrating v0.2.3 preset "${presetId}" to "${V23_PRESET_MIGRATION[presetId]}"`
    );
    presetId = V23_PRESET_MIGRATION[presetId];
    migrated = true;
  }

  if (!presetId || !assumptions.presets[presetId]) {
    return fallback(`unknown or missing preset in hash "${hashString}"`);
  }
  const preset = assumptions.presets[presetId];

  const urlVersion = params.get('v');
  const versionMismatch =
    migrated || (urlVersion !== null && urlVersion !== assumptions.modelVersion);

  const inputs = { ...preset.inputs };
  for (const [key, value] of params.entries()) {
    if (key === 'preset' || key === 'v' || key === 'arch') continue;
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
    architectureId: preset.architecture,
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
