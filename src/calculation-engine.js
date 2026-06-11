// calculation-engine.js — pure calculation logic for the robotaxi economics model
//
// No DOM, no Plotly, no side effects. Formulas implement the canonical
// `code_expression` fields in data/model-formulas.json; the test suite pins the
// results against the `test_cases` block of the same file.
//
// The JSON data is statically imported so the engine stays synchronous and pure:
// Vite inlines JSON at build time and Vitest resolves it the same way.

import assumptionsJson from '../data/assumptions.json';
import scenariosJson from '../data/scenarios.json';
import formulasJson from '../data/model-formulas.json';
import sourcesJson from '../data/sources.json';

/**
 * Normalize the four data files into a single object.
 *
 * Returns:
 *   modelVersion, modelName, positioning, basePresetId
 *   constants        — { name: number } plain values for computation
 *   constantDefs     — full constant definitions (unit, confidence, sources, ...)
 *   variables        — full variable definitions keyed by id
 *   variableIds      — all variable ids in file order
 *   mainVariableIds  — the ui_group === "main" subset (tornado scope)
 *   baseInputs       — { variableId: base value }
 *   presets          — { id: { label, description, overrides, inputs } } with
 *                      inputs fully resolved (base values + overrides)
 *   formulas         — raw model-formulas.json (tolerances, test cases, labels)
 *   sources          — sources keyed by source id
 */
export function loadAssumptions() {
  const constants = {};
  for (const [name, def] of Object.entries(assumptionsJson.constants)) {
    constants[name] = def.value;
  }

  const baseInputs = {};
  for (const [name, def] of Object.entries(assumptionsJson.variables)) {
    baseInputs[name] = def.value;
  }

  const presets = {};
  for (const [id, preset] of Object.entries(scenariosJson.presets)) {
    presets[id] = {
      label: preset.label,
      description: preset.description,
      overrides: { ...preset.overrides },
      inputs: { ...baseInputs, ...preset.overrides },
    };
  }

  const variableIds = Object.keys(assumptionsJson.variables);

  return {
    modelVersion: assumptionsJson.model_version,
    modelName: assumptionsJson.model_name,
    positioning: assumptionsJson.positioning,
    basePresetId: assumptionsJson.base_preset_id,
    constants,
    constantDefs: assumptionsJson.constants,
    variables: assumptionsJson.variables,
    variableIds,
    mainVariableIds: variableIds.filter(
      (id) => assumptionsJson.variables[id].ui_group === 'main'
    ),
    baseInputs,
    presets,
    formulas: formulasJson,
    sources: sourcesJson.sources,
  };
}

/**
 * Forward calculation for one set of inputs.
 *
 * `inputs` must contain a value for every variable id; `assumptions` is the
 * object returned by loadAssumptions(). Returns { inputs, derived, outputs,
 * sankey } where derived/outputs keys match model-formulas.json and sankey
 * holds the six flows with the edge-case clamping the data file specifies:
 * a negative city contribution clamps the revenue→contribution flow to 0 and
 * the platform shortfall flows in as "External funding" so the platform node
 * stays balanced.
 */
export function computeScenario(inputs, assumptions) {
  const constants = assumptions.constants;

  // derived_values, in dependency order
  const totalActiveFleet =
    inputs.active_vehicles_per_city * inputs.number_of_cities;
  const annualTotalVehicleMiles =
    totalActiveFleet * constants.annual_total_vehicle_miles_per_vehicle;
  const annualPaidMiles = annualTotalVehicleMiles * inputs.paid_mile_ratio;
  const depreciationPerTotalMile =
    (inputs.vehicle_av_capex * (1 - constants.residual_value_rate)) /
    inputs.vehicle_lifetime_miles;
  const vehicleCostPerPaidMile =
    (depreciationPerTotalMile + inputs.direct_running_cost_per_total_mile) /
    inputs.paid_mile_ratio;
  const localVariableOpsPerPaidMile =
    inputs.local_fleet_ops_cost_per_total_mile / inputs.paid_mile_ratio;
  const cityFixedCostPerPaidMile =
    inputs.annual_city_cost_per_city /
    (inputs.active_vehicles_per_city *
      constants.annual_total_vehicle_miles_per_vehicle *
      inputs.paid_mile_ratio);
  const platformCostPerPaidMile = inputs.annual_platform_cost / annualPaidMiles;

  // primary_outputs
  const directCostPerPaidMile =
    vehicleCostPerPaidMile + localVariableOpsPerPaidMile + cityFixedCostPerPaidMile;
  const cityContributionPerPaidMile =
    inputs.net_revenue_per_paid_mile - directCostPerPaidMile;
  const enterpriseResultPerPaidMile =
    cityContributionPerPaidMile - platformCostPerPaidMile;
  const breakEvenGapPerPaidMile = Math.max(0, -enterpriseResultPerPaidMile);

  // sankey_flows
  const flows = [
    {
      source: 'Net revenue',
      target: 'Vehicle and engineering',
      value: vehicleCostPerPaidMile,
    },
    {
      source: 'Net revenue',
      target: 'Local fleet operations',
      value: localVariableOpsPerPaidMile + cityFixedCostPerPaidMile,
    },
    {
      source: 'Net revenue',
      target: 'City contribution',
      value: Math.max(0, cityContributionPerPaidMile),
    },
    {
      source: 'City contribution',
      target: 'Platform and replication',
      value: Math.min(
        Math.max(0, cityContributionPerPaidMile),
        platformCostPerPaidMile
      ),
    },
    {
      source: 'External funding',
      target: 'Platform and replication',
      value: Math.max(0, -enterpriseResultPerPaidMile),
    },
    {
      source: 'City contribution',
      target: 'Enterprise surplus',
      value: Math.max(0, enterpriseResultPerPaidMile),
    },
  ];

  return {
    inputs: { ...inputs },
    derived: {
      total_active_fleet: totalActiveFleet,
      annual_total_vehicle_miles: annualTotalVehicleMiles,
      annual_paid_miles: annualPaidMiles,
      depreciation_per_total_mile: depreciationPerTotalMile,
      vehicle_cost_per_paid_mile: vehicleCostPerPaidMile,
      local_variable_ops_per_paid_mile: localVariableOpsPerPaidMile,
      city_fixed_cost_per_paid_mile: cityFixedCostPerPaidMile,
      platform_cost_per_paid_mile: platformCostPerPaidMile,
    },
    outputs: {
      direct_cost_per_paid_mile: directCostPerPaidMile,
      city_contribution_per_paid_mile: cityContributionPerPaidMile,
      enterprise_result_per_paid_mile: enterpriseResultPerPaidMile,
      break_even_gap_per_paid_mile: breakEvenGapPerPaidMile,
    },
    sankey: { flows },
  };
}

/**
 * Bounded one-variable break-even solver.
 *
 * Holds every other input constant and looks for the value of `variableId`
 * inside its credible range [range.low, range.high] where
 * enterprise_result_per_paid_mile = 0, by bisection. Per the achievable_rule
 * in model-formulas.json, a solution exists only if the enterprise result is
 * zero at a boundary or changes sign across the range — the solver never
 * extrapolates beyond the credible range.
 *
 * Returns { achievable: boolean, value: number|null, message: string }.
 */
export function solveBreakEven(variableId, inputs, assumptions) {
  const variable = assumptions.variables[variableId];
  if (!variable) {
    throw new Error(`solveBreakEven: unknown variable "${variableId}"`);
  }

  const spec = assumptions.formulas.primary_outputs.break_even_solutions;
  const tolerance = spec.tolerance;
  const maxIterations = spec.max_iterations;

  const enterpriseResultAt = (x) =>
    computeScenario({ ...inputs, [variableId]: x }, assumptions).outputs
      .enterprise_result_per_paid_mile;

  let lo = variable.range.low;
  let hi = variable.range.high;
  let fLo = enterpriseResultAt(lo);
  let fHi = enterpriseResultAt(hi);

  // Boundary zeros count as achievable.
  if (Math.abs(fLo) <= tolerance) {
    return {
      achievable: true,
      value: lo,
      message: 'Break-even sits at the low end of the credible range.',
    };
  }
  if (Math.abs(fHi) <= tolerance) {
    return {
      achievable: true,
      value: hi,
      message: 'Break-even sits at the high end of the credible range.',
    };
  }

  // No sign change across the credible range: no root to find.
  if (fLo * fHi > 0) {
    const message =
      fLo > 0
        ? 'Already at or above break-even across the credible range.'
        : spec.non_achievable_message;
    return { achievable: false, value: null, message };
  }

  for (let i = 0; i < maxIterations; i += 1) {
    const mid = (lo + hi) / 2;
    const fMid = enterpriseResultAt(mid);
    if (Math.abs(fMid) <= tolerance || (hi - lo) / 2 <= tolerance) {
      return {
        achievable: true,
        value: mid,
        message: 'Achievable within the credible range.',
      };
    }
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  // 100 bisections shrink the interval by 2^100; reaching this is theoretical.
  return {
    achievable: true,
    value: (lo + hi) / 2,
    message: 'Achievable within the credible range.',
  };
}

/**
 * One-at-a-time sensitivity per tornado_methodology in model-formulas.json:
 * for each of the seven main variables, set it to range.low / range.high while
 * holding all other inputs at their current values, and report the change in
 * enterprise_result_per_paid_mile against the baseline. Sorted descending by
 * max(|impactLow|, |impactHigh|).
 */
export function computeTornado(inputs, assumptions) {
  const baseline = computeScenario(inputs, assumptions).outputs
    .enterprise_result_per_paid_mile;

  const rows = assumptions.mainVariableIds.map((variableId) => {
    const variable = assumptions.variables[variableId];
    const atLow = computeScenario(
      { ...inputs, [variableId]: variable.range.low },
      assumptions
    ).outputs.enterprise_result_per_paid_mile;
    const atHigh = computeScenario(
      { ...inputs, [variableId]: variable.range.high },
      assumptions
    ).outputs.enterprise_result_per_paid_mile;

    return {
      variableId,
      label: variable.label,
      impactLow: atLow - baseline,
      impactHigh: atHigh - baseline,
      confidence: variable.confidence,
      range_basis: variable.range_basis,
    };
  });

  const magnitude = (row) =>
    Math.max(Math.abs(row.impactLow), Math.abs(row.impactHigh));
  rows.sort((a, b) => magnitude(b) - magnitude(a));
  return rows;
}
