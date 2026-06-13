// calculation-engine.test.js — pins the v0.2.0 engine against the canonical
// test cases in data/model-formulas.json plus solver/tornado/sankey behavior.

import { describe, it, expect } from 'vitest';
import formulasJson from '../data/model-formulas.json';
import {
  loadAssumptions,
  computeScenario,
  solveBreakEven,
  computeTornado,
} from '../src/calculation-engine.js';

const waymo = loadAssumptions('waymo_like');
const cybercab = loadAssumptions('cybercab');
const byArch = { waymo_like: waymo, cybercab };

describe('loadAssumptions', () => {
  it('requires a known architecture id', () => {
    expect(() => loadAssumptions()).toThrow(/unknown architecture/);
    expect(() => loadAssumptions('robovan')).toThrow(/unknown architecture/);
  });

  it('resolves architecture-specific values and shared fields', () => {
    expect(waymo.variables.gross_fare_per_paid_mile.value).toBe(4.0);
    expect(cybercab.variables.gross_fare_per_paid_mile.value).toBe(3.0);
    // shared top-level fields survive the flattening
    expect(waymo.variables.gross_fare_per_paid_mile.label).toBe(
      'Gross fare per paid mile'
    );
    expect(cybercab.variables.revenue_leakage_rate.display_unit).toBe('%');
    // constants are architecture-resolved plain numbers
    expect(waymo.constants.annual_total_vehicle_miles_per_vehicle).toBe(70000);
  });

  it('exposes 9 main + 3 advanced variables', () => {
    expect(waymo.variableIds).toHaveLength(12);
    expect(waymo.mainVariableIds).toHaveLength(9);
    expect(waymo.mainVariableIds).not.toContain('number_of_cities');
  });

  it('resolves all six presets against their own architecture', () => {
    expect(Object.keys(waymo.presets)).toHaveLength(6);
    // a cybercab preset resolved from a waymo_like load still uses cybercab bases
    expect(waymo.presets.cybercab_early_growth.inputs.vehicle_av_capex).toBe(60000);
    expect(waymo.presets.waymo_like_early_growth.inputs.vehicle_av_capex).toBe(175000);
    // overrides applied on top of the architecture base
    expect(waymo.presets.cybercab_mature_dense.inputs.number_of_cities).toBe(6);   // explicit override
    expect(waymo.presets.waymo_like_mature_dense.inputs.number_of_cities).toBe(11); // no override → waymo_like default
  });
});

describe('canonical preset regressions (test_cases)', () => {
  const cases = Object.entries(formulasJson.test_cases.canonical_presets);

  it.each(cases)('%s matches expected outputs', (presetId, testCase) => {
    const assumptions = byArch[testCase.architecture];
    const result = computeScenario(testCase.inputs, assumptions);
    for (const [key, expected] of Object.entries(testCase.expected)) {
      expect(result.outputs[key], key).toBeCloseTo(expected, 6);
    }
    for (const [key, expected] of Object.entries(testCase.diagnostics)) {
      expect(result.derived[key], `diagnostic ${key}`).toBeCloseTo(
        expected,
        Math.abs(expected) > 1e6 ? 0 : 6
      );
    }
  });

  it('test case inputs equal the resolved preset baselines', () => {
    for (const [presetId, testCase] of cases) {
      expect(waymo.presets[presetId].inputs).toEqual(testCase.inputs);
    }
  });
});

describe('edge cases', () => {
  it('zero leakage makes net revenue exactly equal gross fare', () => {
    const spec = formulasJson.test_cases.edge_cases.zero_revenue_leakage;
    const result = computeScenario(spec.inputs, byArch[spec.architecture]);
    expect(result.derived.net_revenue_per_paid_mile).toBe(
      spec.inputs.gross_fare_per_paid_mile
    );
    for (const [key, expected] of Object.entries(spec.expected)) {
      const actual = key in result.outputs ? result.outputs[key] : result.derived[key];
      expect(actual, key).toBeCloseTo(expected, 6);
    }
  });

  it('zero residual makes depreciation exactly equal capex / lifetime miles', () => {
    const spec = formulasJson.test_cases.edge_cases.zero_residual_value;
    const result = computeScenario(spec.inputs, byArch[spec.architecture]);
    expect(result.derived.depreciation_per_total_mile).toBe(
      spec.inputs.vehicle_av_capex / spec.inputs.vehicle_lifetime_miles
    );
    for (const [key, expected] of Object.entries(spec.expected)) {
      const actual = key in result.outputs ? result.outputs[key] : result.derived[key];
      expect(actual, key).toBeCloseTo(expected, 6);
    }
  });
});

describe('sankey flows', () => {
  const flowIn = (result) => (source, target) =>
    result.sankey.flows.find((f) => f.source === source && f.target === target);

  it('produces the split topology (8 terminal branches, 10 flows)', () => {
    const result = computeScenario(
      waymo.presets.waymo_like_early_growth.inputs,
      waymo
    );
    expect(result.sankey.flows).toHaveLength(10);
    const terminals = new Set(
      result.sankey.flows
        .map((f) => f.target)
        .filter((t) => !result.sankey.flows.some((f) => f.source === t))
    );
    expect(terminals).toEqual(
      new Set([
        'Revenue leakage',
        'Vehicle depreciation',
        'Direct running cost',
        'Local fleet operations',
        'City launch and recurring',
        'Platform cost',
        'Enterprise surplus',
      ])
    );
    const flow = flowIn(result);
    // gross fare stage: leakage = 4.0 × 0.1, net revenue = 3.6
    expect(flow('Gross fare', 'Revenue leakage').value).toBeCloseTo(0.4, 9);
    expect(flow('Gross fare', 'Net revenue').value).toBeCloseTo(3.6, 9);
    // loss-making preset: surplus clamps to 0, external funding covers the gap
    expect(flow('City contribution', 'Enterprise surplus').value).toBe(0);
    expect(flow('External funding', 'Platform cost').value).toBeCloseTo(
      result.outputs.break_even_gap_per_paid_mile,
      9
    );
  });

  it.each(Object.entries(formulasJson.test_cases.canonical_presets))(
    '%s: split branches sum to the pre-split ribbons',
    (presetId, testCase) => {
      const assumptions = byArch[testCase.architecture];
      const result = computeScenario(testCase.inputs, assumptions);
      const flow = flowIn(result);

      // depreciation + running cost = the old "Vehicle and engineering" total
      expect(
        flow('Net revenue', 'Vehicle depreciation').value +
          flow('Net revenue', 'Direct running cost').value
      ).toBeCloseTo(result.derived.vehicle_cost_per_paid_mile, 9);

      // fleet ops + city launch = the old combined local-operations ribbon
      expect(
        flow('Net revenue', 'Local fleet operations').value +
          flow('Net revenue', 'City launch and recurring').value
      ).toBeCloseTo(
        result.derived.local_variable_ops_per_paid_mile +
          result.derived.city_fixed_cost_per_paid_mile,
        9
      );

      // each split leg matches its derived value
      expect(flow('Net revenue', 'Vehicle depreciation').value).toBeCloseTo(
        result.derived.depreciation_per_total_mile / testCase.inputs.paid_mile_ratio,
        9
      );
      expect(flow('Net revenue', 'City launch and recurring').value).toBeCloseTo(
        result.derived.city_fixed_cost_per_paid_mile,
        9
      );

      // platform node still receives exactly the platform cost per paid mile
      expect(
        flow('City contribution', 'Platform cost').value +
          flow('External funding', 'Platform cost').value
      ).toBeCloseTo(result.derived.platform_cost_per_paid_mile, 9);
    }
  );

  it('net revenue outflows are conserved when contribution is positive', () => {
    const result = computeScenario(
      waymo.presets.waymo_like_early_growth.inputs,
      waymo
    );
    const out = result.sankey.flows
      .filter((f) => f.source === 'Net revenue')
      .reduce((sum, f) => sum + f.value, 0);
    expect(out).toBeCloseTo(result.derived.net_revenue_per_paid_mile, 9);
  });

  it('zero leakage produces a zero leakage flow', () => {
    const result = computeScenario(
      cybercab.presets.cybercab_early_growth.inputs,
      cybercab
    );
    expect(
      result.sankey.flows.find((f) => f.target === 'Revenue leakage').value
    ).toBe(0);
  });

  it('profitable preset routes surplus and needs no external funding', () => {
    const result = computeScenario(
      waymo.presets.waymo_like_mature_dense.inputs,
      waymo
    );
    const flow = flowIn(result);
    expect(flow('External funding', 'Platform cost').value).toBe(0);
    expect(flow('City contribution', 'Enterprise surplus').value).toBeCloseTo(
      result.outputs.enterprise_result_per_paid_mile,
      9
    );
  });
});

describe('solveBreakEven', () => {
  const lossInputs = waymo.presets.waymo_like_early_growth.inputs;

  it('finds an in-range root by bisection', () => {
    const solution = solveBreakEven('active_vehicles_per_city', lossInputs, waymo);
    expect(solution.achievable).toBe(true);
    expect(solution.value).toBeGreaterThan(500);
    expect(solution.value).toBeLessThan(1000);
    const check = computeScenario(
      { ...lossInputs, active_vehicles_per_city: solution.value },
      waymo
    );
    expect(
      Math.abs(check.outputs.enterprise_result_per_paid_mile)
    ).toBeLessThanOrEqual(1e-6);
  });

  it('reports not-achievable when the credible range cannot reach zero', () => {
    const solution = solveBreakEven('gross_fare_per_paid_mile', lossInputs, waymo);
    expect(solution.achievable).toBe(false);
    expect(solution.message).toBe(
      formulasJson.primary_outputs.break_even_solutions.non_achievable_message
    );
  });

  it('reports already-above when profitable across the whole range', () => {
    const solution = solveBreakEven(
      'gross_fare_per_paid_mile',
      waymo.presets.waymo_like_mature_dense.inputs,
      waymo
    );
    expect(solution.achievable).toBe(false);
    expect(solution.message).toMatch(/Already at or above break-even/);
  });

  it('respects per-variable solver config (disabled variables)', () => {
    const solution = solveBreakEven('number_of_cities', lossInputs, waymo);
    expect(solution.achievable).toBe(false);
    expect(solution.value).toBeNull();
    expect(solution.message).toMatch(/not enabled/);
  });

  it('throws on unknown variable ids', () => {
    expect(() => solveBreakEven('nope', lossInputs, waymo)).toThrow(/unknown variable/);
  });
});

describe('computeTornado', () => {
  it('covers all nine main variables, sorted by absolute impact', () => {
    const rows = computeTornado(cybercab.presets.cybercab_early_growth.inputs, cybercab);
    expect(rows).toHaveLength(9);
    expect(new Set(rows.map((r) => r.variableId))).toEqual(
      new Set(cybercab.mainVariableIds)
    );
    const magnitude = (row) =>
      Math.max(Math.abs(row.impactLow), Math.abs(row.impactHigh));
    for (let i = 1; i < rows.length; i += 1) {
      expect(magnitude(rows[i - 1])).toBeGreaterThanOrEqual(magnitude(rows[i]));
    }
  });

  it('uses the selected architecture ranges and carries hover metadata', () => {
    const rows = computeTornado(waymo.presets.waymo_like_early_growth.inputs, waymo);
    const fare = rows.find((r) => r.variableId === 'gross_fare_per_paid_mile');
    // waymo fare range 3.2–4.8 around base 4.0, leakage 0.1:
    // impact = ±0.8 × (1 − 0.1)
    expect(fare.impactLow).toBeCloseTo(-0.72, 9);
    expect(fare.impactHigh).toBeCloseTo(0.72, 9);
    expect(fare.confidence).toBe('low-medium');
    expect(fare.range_basis.length).toBeGreaterThan(0);
  });
});
