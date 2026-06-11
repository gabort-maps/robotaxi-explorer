// calculation-engine.test.js — unit tests for the calculation engine

import { describe, it, expect } from 'vitest';
import {
  loadAssumptions,
  computeScenario,
  solveBreakEven,
  computeTornado,
} from '../src/calculation-engine.js';

const assumptions = loadAssumptions();

function flowValue(result, source, target) {
  const flow = result.sankey.flows.find(
    (f) => f.source === source && f.target === target
  );
  expect(flow, `flow ${source} -> ${target}`).toBeDefined();
  return flow.value;
}

describe('loadAssumptions', () => {
  it('normalizes variables, constants, presets and sources', () => {
    expect(assumptions.variableIds).toHaveLength(10);
    expect(assumptions.mainVariableIds).toHaveLength(7);
    expect(Object.keys(assumptions.constants)).toEqual([
      'annual_total_vehicle_miles_per_vehicle',
      'residual_value_rate',
    ]);
    expect(Object.keys(assumptions.presets)).toEqual([
      'early_growth',
      'mature_dense',
      'replicated_multicity',
    ]);
    expect(assumptions.basePresetId).toBe('early_growth');
    expect(Object.keys(assumptions.sources)).toContain('src_model_base_v1');
  });

  it('resolves preset inputs as base values plus overrides', () => {
    // early_growth has no overrides: inputs equal the base values
    expect(assumptions.presets.early_growth.inputs).toEqual(
      assumptions.baseInputs
    );
    // replicated_multicity overrides number_of_cities, others inherit
    expect(assumptions.presets.replicated_multicity.inputs.number_of_cities).toBe(15);
    expect(assumptions.presets.mature_dense.inputs.number_of_cities).toBe(
      assumptions.baseInputs.number_of_cities
    );
  });
});

describe('computeScenario reproduces the canonical test_cases', () => {
  for (const [caseName, expected] of Object.entries(
    assumptions.formulas.test_cases
  )) {
    const presetId = caseName.replace(/_expected_approx$/, '');

    it(`${presetId} matches expected values to 4 decimal places`, () => {
      const preset = assumptions.presets[presetId];
      expect(preset, `preset ${presetId}`).toBeDefined();

      const result = computeScenario(preset.inputs, assumptions);
      const actual = { ...result.derived, ...result.outputs };
      for (const [key, value] of Object.entries(expected)) {
        expect(actual[key], key).toBeCloseTo(value, 4);
      }
    });
  }
});

describe('solveBreakEven', () => {
  it('reports not achievable when the gap cannot close within the credible range', () => {
    // early_growth needs R = direct cost + platform cost ≈ 4.60 to break even,
    // but the credible range for net revenue tops out at 4.2.
    const inputs = assumptions.presets.early_growth.inputs;
    const result = solveBreakEven('net_revenue_per_paid_mile', inputs, assumptions);

    expect(result.achievable).toBe(false);
    expect(result.value).toBeNull();
    expect(result.message).toBe('Not achievable within the evidence-based range.');
  });

  it('converges to within 0.001 of the analytic root on a linear case', () => {
    // Enterprise result is linear in net revenue: result = R - direct - platform.
    // Raise the platform burden on mature_dense so the analytic root
    // R* = direct + platform lands strictly inside the credible range [2.8, 4.2].
    const inputs = {
      ...assumptions.presets.mature_dense.inputs,
      annual_platform_cost: 520_800_000,
    };
    const base = computeScenario(inputs, assumptions);
    const analyticRoot =
      base.outputs.direct_cost_per_paid_mile +
      base.derived.platform_cost_per_paid_mile;
    const { low, high } = assumptions.variables.net_revenue_per_paid_mile.range;
    expect(analyticRoot).toBeGreaterThan(low);
    expect(analyticRoot).toBeLessThan(high);

    const result = solveBreakEven('net_revenue_per_paid_mile', inputs, assumptions);

    expect(result.achievable).toBe(true);
    expect(Math.abs(result.value - analyticRoot)).toBeLessThan(0.001);

    // The solved value really does zero out the enterprise result.
    const check = computeScenario(
      { ...inputs, net_revenue_per_paid_mile: result.value },
      assumptions
    );
    expect(Math.abs(check.outputs.enterprise_result_per_paid_mile)).toBeLessThan(1e-6);
  });

  it('distinguishes the already-profitable case from the unreachable case', () => {
    // replicated_multicity is profitable across the whole credible net-revenue
    // range, so there is no root — but the message must not claim the range is
    // insufficient.
    const inputs = assumptions.presets.replicated_multicity.inputs;
    const result = solveBreakEven('net_revenue_per_paid_mile', inputs, assumptions);

    expect(result.achievable).toBe(false);
    expect(result.value).toBeNull();
    expect(result.message).toBe(
      'Already at or above break-even across the credible range.'
    );
  });

  it('throws on an unknown variable id', () => {
    expect(() =>
      solveBreakEven('no_such_variable', assumptions.baseInputs, assumptions)
    ).toThrow(/unknown variable/);
  });
});

describe('computeTornado', () => {
  it('covers the seven main variables, sorted by absolute impact descending', () => {
    const rows = computeTornado(assumptions.presets.early_growth.inputs, assumptions);

    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.variableId))).toEqual(
      new Set(assumptions.mainVariableIds)
    );

    const magnitudes = rows.map((r) =>
      Math.max(Math.abs(r.impactLow), Math.abs(r.impactHigh))
    );
    for (let i = 1; i < magnitudes.length; i += 1) {
      expect(magnitudes[i]).toBeLessThanOrEqual(magnitudes[i - 1]);
    }

    for (const row of rows) {
      expect(typeof row.impactLow).toBe('number');
      expect(typeof row.impactHigh).toBe('number');
      expect(row.confidence).toBeTruthy();
      expect(row.range_basis).toBeTruthy();
    }
  });

  it('reports impacts as enterprise-result deltas against the baseline', () => {
    const inputs = assumptions.presets.early_growth.inputs;
    const baseline = computeScenario(inputs, assumptions).outputs
      .enterprise_result_per_paid_mile;
    const rows = computeTornado(inputs, assumptions);

    const paidMileRow = rows.find((r) => r.variableId === 'paid_mile_ratio');
    const { low, high } = assumptions.variables.paid_mile_ratio.range;
    const atLow = computeScenario({ ...inputs, paid_mile_ratio: low }, assumptions)
      .outputs.enterprise_result_per_paid_mile;
    const atHigh = computeScenario({ ...inputs, paid_mile_ratio: high }, assumptions)
      .outputs.enterprise_result_per_paid_mile;

    expect(paidMileRow.impactLow).toBeCloseTo(atLow - baseline, 10);
    expect(paidMileRow.impactHigh).toBeCloseTo(atHigh - baseline, 10);
  });
});

describe('sankey flows', () => {
  it('clamps flows to zero when city contribution is negative', () => {
    // Push early_growth net revenue down to 2.0 (slider minimum): direct cost
    // ≈ 2.44 exceeds revenue, so city contribution goes negative.
    const inputs = {
      ...assumptions.presets.early_growth.inputs,
      net_revenue_per_paid_mile: 2.0,
    };
    const result = computeScenario(inputs, assumptions);

    expect(result.outputs.city_contribution_per_paid_mile).toBeLessThan(0);
    expect(flowValue(result, 'Net revenue', 'City contribution')).toBe(0);
    expect(flowValue(result, 'City contribution', 'Platform and replication')).toBe(0);
    expect(flowValue(result, 'City contribution', 'Enterprise surplus')).toBe(0);
    // External funding covers the entire shortfall: platform cost plus the
    // negative contribution.
    expect(flowValue(result, 'External funding', 'Platform and replication')).toBeCloseTo(
      -result.outputs.enterprise_result_per_paid_mile,
      10
    );
  });

  it('routes a partial platform shortfall through external funding (loss case)', () => {
    // early_growth: positive contribution (≈1.06) but platform cost ≈2.16.
    const result = computeScenario(assumptions.presets.early_growth.inputs, assumptions);
    const { city_contribution_per_paid_mile: contribution } = result.outputs;
    const platform = result.derived.platform_cost_per_paid_mile;

    expect(contribution).toBeGreaterThan(0);
    expect(platform).toBeGreaterThan(contribution);
    expect(flowValue(result, 'Net revenue', 'City contribution')).toBeCloseTo(contribution, 10);
    expect(flowValue(result, 'City contribution', 'Platform and replication')).toBeCloseTo(contribution, 10);
    expect(flowValue(result, 'External funding', 'Platform and replication')).toBeCloseTo(platform - contribution, 10);
    expect(flowValue(result, 'City contribution', 'Enterprise surplus')).toBe(0);
  });

  it('routes surplus out and needs no external funding in the profitable case', () => {
    const result = computeScenario(assumptions.presets.mature_dense.inputs, assumptions);
    const { city_contribution_per_paid_mile: contribution, enterprise_result_per_paid_mile: surplus } =
      result.outputs;
    const platform = result.derived.platform_cost_per_paid_mile;

    expect(surplus).toBeGreaterThan(0);
    expect(flowValue(result, 'Net revenue', 'City contribution')).toBeCloseTo(contribution, 10);
    expect(flowValue(result, 'City contribution', 'Platform and replication')).toBeCloseTo(platform, 10);
    expect(flowValue(result, 'External funding', 'Platform and replication')).toBe(0);
    expect(flowValue(result, 'City contribution', 'Enterprise surplus')).toBeCloseTo(surplus, 10);
  });
});
