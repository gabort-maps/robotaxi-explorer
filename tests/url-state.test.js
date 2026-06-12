// url-state.test.js — unit tests for URL state serialization/deserialization

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAssumptions } from '../src/calculation-engine.js';
import {
  encodeState,
  decodeState,
  buildShareableUrl,
} from '../src/url-state.js';

const assumptions = loadAssumptions();
const VERSION = assumptions.modelVersion;
const DEFAULT_PRESET = Object.keys(assumptions.presets)[0];

let warnSpy;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

describe('url-state', () => {
  describe('round-trip', () => {
    it('encode then decode returns the same inputs', () => {
      const inputs = {
        ...assumptions.presets.mature_dense.inputs,
        net_revenue_per_paid_mile: 3.75,
        paid_mile_ratio: 0.58,
        number_of_cities: 10,
      };
      const hash = encodeState('mature_dense', inputs, assumptions, VERSION);
      const decoded = decodeState(hash, assumptions);

      expect(decoded.presetId).toBe('mature_dense');
      expect(decoded.modelVersion).toBe(VERSION);
      expect(decoded.versionMismatch).toBe(false);
      expect(decoded.inputs).toEqual(inputs);
    });

    it('round-trips an unmodified preset', () => {
      const inputs = { ...assumptions.presets.replicated_multicity.inputs };
      const hash = encodeState(
        'replicated_multicity',
        inputs,
        assumptions,
        VERSION
      );
      const decoded = decodeState(hash, assumptions);

      expect(decoded.presetId).toBe('replicated_multicity');
      expect(decoded.inputs).toEqual(inputs);
    });
  });

  describe('delta encoding', () => {
    it('omits values identical to the preset baseline', () => {
      const inputs = { ...assumptions.presets.early_growth.inputs };
      const hash = encodeState('early_growth', inputs, assumptions, VERSION);

      expect(hash).toBe(`#preset=early_growth&v=${VERSION}`);
    });

    it('encodes only the variables that changed', () => {
      const inputs = {
        ...assumptions.presets.early_growth.inputs,
        vehicle_av_capex: 150000,
      };
      const hash = encodeState('early_growth', inputs, assumptions, VERSION);

      expect(hash).toContain('vehicle_av_capex=150000');
      for (const id of assumptions.variableIds) {
        if (id !== 'vehicle_av_capex') {
          expect(hash).not.toContain(id);
        }
      }
    });

    it('treats a value rounded back to the baseline as unchanged', () => {
      const inputs = {
        ...assumptions.presets.early_growth.inputs,
        // 4-significant-figure rounding collapses this onto the 175000 baseline
        vehicle_av_capex: 175000.001,
      };
      const hash = encodeState('early_growth', inputs, assumptions, VERSION);

      expect(hash).toBe(`#preset=early_growth&v=${VERSION}`);
    });
  });

  describe('version mismatch', () => {
    it('flags a URL encoded with a different model version', () => {
      const inputs = { ...assumptions.presets.early_growth.inputs };
      const hash = encodeState('early_growth', inputs, assumptions, '9.9.9');
      const decoded = decodeState(hash, assumptions);

      expect(decoded.versionMismatch).toBe(true);
      expect(decoded.modelVersion).toBe('9.9.9');
    });

    it('does not flag a URL with the current model version', () => {
      const inputs = { ...assumptions.presets.early_growth.inputs };
      const hash = encodeState('early_growth', inputs, assumptions, VERSION);

      expect(decodeState(hash, assumptions).versionMismatch).toBe(false);
    });
  });

  describe('unknown variable ids', () => {
    it('ignores variables not present in current assumptions', () => {
      const hash = `#preset=early_growth&v=${VERSION}&number_of_cities=12&retired_variable=42`;
      const decoded = decodeState(hash, assumptions);

      expect(decoded.presetId).toBe('early_growth');
      expect(decoded.inputs.number_of_cities).toBe(12);
      expect(decoded.inputs).not.toHaveProperty('retired_variable');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('ignores non-numeric values for known variables', () => {
      const hash = `#preset=early_growth&v=${VERSION}&number_of_cities=banana`;
      const decoded = decodeState(hash, assumptions);

      expect(decoded.inputs.number_of_cities).toBe(
        assumptions.presets.early_growth.inputs.number_of_cities
      );
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('malformed hashes', () => {
    it.each(['#garbage-without-params', '#preset=no_such_preset&v=0.1.0', '#&&==&'])(
      'returns the default preset and warns for %s',
      (hash) => {
        const decoded = decodeState(hash, assumptions);

        expect(decoded.presetId).toBe(DEFAULT_PRESET);
        expect(decoded.versionMismatch).toBe(false);
        expect(decoded.inputs).toEqual(
          assumptions.presets[DEFAULT_PRESET].inputs
        );
        expect(warnSpy).toHaveBeenCalled();
      }
    );
  });

  describe('empty hash', () => {
    it.each(['', '#', null, undefined])(
      'returns the first preset in scenarios.json for %s',
      (hash) => {
        const decoded = decodeState(hash, assumptions);

        expect(decoded.presetId).toBe(DEFAULT_PRESET);
        expect(decoded.modelVersion).toBe(VERSION);
        expect(decoded.versionMismatch).toBe(false);
        expect(decoded.inputs).toEqual(
          assumptions.presets[DEFAULT_PRESET].inputs
        );
        expect(warnSpy).not.toHaveBeenCalled();
      }
    );
  });

  describe('buildShareableUrl', () => {
    it('appends the encoded hash to the base URL', () => {
      const inputs = {
        ...assumptions.presets.early_growth.inputs,
        paid_mile_ratio: 0.6,
      };
      const url = buildShareableUrl(
        'early_growth',
        inputs,
        assumptions,
        VERSION,
        'https://example.com/robotaxi/'
      );

      expect(url).toBe(
        `https://example.com/robotaxi/#preset=early_growth&v=${VERSION}&paid_mile_ratio=0.6`
      );
    });

    it('replaces an existing hash on the base URL', () => {
      const inputs = { ...assumptions.presets.early_growth.inputs };
      const url = buildShareableUrl(
        'early_growth',
        inputs,
        assumptions,
        VERSION,
        'https://example.com/#preset=old'
      );

      expect(url).toBe(
        `https://example.com/#preset=early_growth&v=${VERSION}`
      );
    });
  });
});
