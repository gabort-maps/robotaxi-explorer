// calculation-engine.js — pure calculation logic for the robotaxi economics model
//
// No DOM, no Plotly, no side effects. Formulas implement the canonical
// `code_expression` fields in data/model-formulas.json (v0.3.0); the test
// suite pins the results against the nine canonical presets and three edge
// cases in the `test_cases` block of the same file.
//
// v0.3.0 data is architecture-nested across three architectures: waymo_current,
// waymo_nextgen, and cybercab. loadAssumptions(architectureId) resolves one
// architecture into the flat shape the rest of the engine and UI consume, while
// keeping all nine preset baselines available for URL decoding.

import assumptionsJson from '../data/assumptions.json';
import scenariosJson from '../data/scenarios.json';
import formulasJson from '../data/model-formulas.json';
import sourcesJson from '../data/sources.json';

/**
 * Normalize the four data files for one architecture.
 *
 * `architectureId` must be one of "waymo_current", "waymo_nextgen", "cybercab".
 * Each variable is flattened by merging its shared top-level fields (label,
 * unit, layer, ui_group, display_unit, quick_values) with the selected
 * architecture's nest (value, range, slider, confidence, range_basis, solver).
 *
 * Returns:
 *   modelVersion, modelName, positioning
 *   architectureId    — the resolved architecture
 *   architectures     — raw architecture metadata (labels, descriptions)
 *   maturities        — maturity dimension ids in file order
 *   defaultPresetId   — `${architectureId}_early_growth`
 *   constants         — { name: number } resolved plain values
 *   constantDefs      — resolved constant definitions
 *   variables         — flattened variable definitions keyed by id
 *   variableIds       — all variable ids in file order
 *   mainVariableIds   — the ui_group === "main" subset (tornado scope)
 *   baseInputs        — { variableId: architecture base value }
 *   presets           — ALL nine presets. Each preset's `inputs` are resolved
 *                       against that preset's OWN architecture (base values +
 *                       overrides), so preset baselines are correct no matter
 *                       which architecture this call resolved. This is what
 *                       lets URL decoding work before the right architecture
 *                       is known.
 *   formulas          — raw model-formulas.json (tolerances, test cases)
 *   sources           — sources keyed by source id
 */
export function loadAssumptions(architectureId) {
  if (!architectureId || !assumptionsJson.architectures[architectureId]) {
    throw new Error(
      `loadAssumptions: unknown architecture "${architectureId}" — expected one of ${Object.keys(
        assumptionsJson.architectures
      ).join(', ')}`
    );
  }

  const constants = {};
  const constantDefs = {};
  for (const [name, def] of Object.entries(assumptionsJson.constants)) {
    constantDefs[name] = def[architectureId];
    constants[name] = def[architectureId].value;
  }

  const variables = {};
  const baseInputs = {};
  for (const [id, def] of Object.entries(assumptionsJson.variables)) {
    const { architectures, ...shared } = def;
    variables[id] = { ...shared, ...architectures[architectureId] };
    baseInputs[id] = architectures[architectureId].value;
  }

  const variableIds = Object.keys(assumptionsJson.variables);

  const presets = {};
  for (const [id, preset] of Object.entries(scenariosJson.presets)) {
    const inputs = {};
    for (const [variableId, def] of Object.entries(assumptionsJson.variables)) {
      inputs[variableId] = def.architectures[preset.architecture].value;
    }
    Object.assign(inputs, preset.overrides);
    presets[id] = {
      label: preset.label,
      architecture: preset.architecture,
      maturity: preset.maturity,
      evidence_quality: preset.evidence_quality,
      description: preset.description,
      overrides: { ...preset.overrides },
      inputs,
    };
  }

  return {
    modelVersion: assumptionsJson.model_version,
    modelName: assumptionsJson.model_name,
    positioning: assumptionsJson.positioning,
    architectureId,
    architectures: assumptionsJson.architectures,
    maturities: assumptionsJson.maturity_dimensions,
    defaultPresetId: `${architectureId}_early_growth`,
    constants,
    constantDefs,
    variables,
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
 * sankey }.
 *
 * v0.3.0 formula changes:
 *   - annual_city_burden_per_city = (city_launch_cost / amortisation_period_years)
 *     + recurring_city_overhead  (replaces flat annual_city_cost_per_city)
 *   - annual_platform_burden = annual_platform_fixed_cost
 *     + platform_cost_per_vehicle_year × totalActiveFleet
 *     (replaces flat annual_platform_cost)
 *
 * The Sankey flows use the split visual topology: vehicle ribbon splits into
 * depreciation + direct running cost; local-operations ribbon splits into
 * fleet ops + city launch and recurring. Platform cost remains a single
 * combined ribbon (fixed + per-vehicle burden).
 */
export function computeScenario(inputs, assumptions) {
  const constants = assumptions.constants;

  // derived_values, in dependency order
  const netRevenuePerPaidMile =
    inputs.gross_fare_per_paid_mile * (1 - inputs.revenue_leakage_rate);
  const totalActiveFleet =
    inputs.active_vehicles_per_city * inputs.number_of_cities;
  const annualTotalVehicleMiles =
    totalActiveFleet * constants.annual_total_vehicle_miles_per_vehicle;
  const annualPaidMiles = annualTotalVehicleMiles * inputs.paid_mile_ratio;
  const depreciationPerTotalMile =
    (inputs.vehicle_av_capex * (1 - inputs.residual_value_pct)) /
    inputs.vehicle_lifetime_miles;
  const vehicleCostPerPaidMile =
    (depreciationPerTotalMile + inputs.direct_running_cost_per_total_mile) /
    inputs.paid_mile_ratio;
  const localVariableOpsPerPaidMile =
    inputs.local_fleet_ops_cost_per_total_mile / inputs.paid_mile_ratio;

  // v0.3.0: city burden decomposed into amortised launch + recurring overhead
  const annualCityBurdenPerCity =
    inputs.city_launch_cost / inputs.amortisation_period_years +
    inputs.recurring_city_overhead;
  const cityFixedCostPerPaidMile =
    annualCityBurdenPerCity /
    (inputs.active_vehicles_per_city *
      constants.annual_total_vehicle_miles_per_vehicle *
      inputs.paid_mile_ratio);

  // v0.3.0: platform burden decomposed into fixed + per-vehicle-year component
  const annualPlatformBurden =
    inputs.annual_platform_fixed_cost +
    inputs.platform_cost_per_vehicle_year * totalActiveFleet;
  const platformCostPerPaidMile = annualPlatformBurden / annualPaidMiles;

  // primary_outputs
  const directCostPerPaidMile =
    vehicleCostPerPaidMile + localVariableOpsPerPaidMile + cityFixedCostPerPaidMile;
  const cityContributionPerPaidMile =
    netRevenuePerPaidMile - directCostPerPaidMile;
  const enterpriseResultPerPaidMile =
    cityContributionPerPaidMile - platformCostPerPaidMile;
  const breakEvenGapPerPaidMile = Math.max(0, -enterpriseResultPerPaidMile);

  // Sankey flows. Two ribbons of the data file's 8-flow spec are split for
  // the visual (7 terminal nodes, 10 flows): "Vehicle and engineering"
  // becomes depreciation + direct running cost, and the local-operations
  // bundle becomes local fleet ops + city launch-and-recurring. City launch
  // flows from Net revenue (not City contribution) because the model counts
  // it inside direct cost — the City contribution node keeps equaling the
  // city_contribution_per_paid_mile output.
  const depreciationPerPaidMile =
    depreciationPerTotalMile / inputs.paid_mile_ratio;
  const runningCostPerPaidMile =
    inputs.direct_running_cost_per_total_mile / inputs.paid_mile_ratio;

  const flows = [
    {
      source: 'Gross fare',
      target: 'Revenue leakage',
      value: inputs.gross_fare_per_paid_mile * inputs.revenue_leakage_rate,
    },
    {
      source: 'Gross fare',
      target: 'Net revenue',
      value: netRevenuePerPaidMile,
    },
    {
      source: 'Net revenue',
      target: 'Vehicle depreciation',
      value: depreciationPerPaidMile,
    },
    {
      source: 'Net revenue',
      target: 'Direct running cost',
      value: runningCostPerPaidMile,
    },
    {
      source: 'Net revenue',
      target: 'Local fleet operations',
      value: localVariableOpsPerPaidMile,
    },
    {
      source: 'Net revenue',
      target: 'City launch and recurring',
      value: cityFixedCostPerPaidMile,
    },
    {
      source: 'Net revenue',
      target: 'City contribution',
      value: Math.max(0, cityContributionPerPaidMile),
    },
    {
      source: 'City contribution',
      target: 'Platform cost',
      value: Math.min(
        Math.max(0, cityContributionPerPaidMile),
        platformCostPerPaidMile
      ),
    },
    {
      source: 'External funding',
      target: 'Platform cost',
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
      net_revenue_per_paid_mile: netRevenuePerPaidMile,
      total_active_fleet: totalActiveFleet,
      annual_total_vehicle_miles: annualTotalVehicleMiles,
      annual_paid_miles: annualPaidMiles,
      depreciation_per_total_mile: depreciationPerTotalMile,
      vehicle_cost_per_paid_mile: vehicleCostPerPaidMile,
      local_variable_ops_per_paid_mile: localVariableOpsPerPaidMile,
      annual_city_burden_per_city: annualCityBurdenPerCity,
      city_fixed_cost_per_paid_mile: cityFixedCostPerPaidMile,
      annual_platform_burden: annualPlatformBurden,
      platform_cost_per_paid_mile: platformCostPerPaidMile,
    },
    outputs: {
      direct_cost_per_paid_mile: directCostPerPaidMile,
      city_contribution_per_paid_mile: cityContributionPerPaidMile,
      platform_cost_per_paid_mile: platformCostPerPaidMile,
      enterprise_result_per_paid_mile: enterpriseResultPerPaidMile,
      break_even_gap_per_paid_mile: breakEvenGapPerPaidMile,
    },
    sankey: { flows },
  };
}

/**
 * Bounded one-variable break-even solver.
 *
 * Respects the per-variable solver config resolved from the selected
 * architecture: variables with solver.enabled === false are reported as not
 * solvable. For enabled variables, holds every other input constant and
 * bisects for enterprise_result_per_paid_mile = 0 inside the architecture's
 * credible range [range.low, range.high], per the achievable_rule in
 * model-formulas.json. The solver never extrapolates beyond the range.
 *
 * Returns { achievable: boolean, value: number|null, message: string }.
 */
export function solveBreakEven(variableId, inputs, assumptions) {
  const variable = assumptions.variables[variableId];
  if (!variable) {
    throw new Error(`solveBreakEven: unknown variable "${variableId}"`);
  }
  if (!variable.solver || variable.solver.enabled === false) {
    return {
      achievable: false,
      value: null,
      message: 'Break-even solving is not enabled for this variable.',
    };
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
 * for each of the nine main variables, set it to the selected architecture's
 * range.low / range.high while holding all other inputs at their current
 * values, and report the change in enterprise_result_per_paid_mile against
 * the baseline. Sorted descending by max(|impactLow|, |impactHigh|).
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
