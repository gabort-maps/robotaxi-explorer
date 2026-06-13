// url-state.test.js — unit tests for URL state serialization/deserialization

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAssumptions } from '../src/calculation-engine.js';
import {
  encodeState,
  decodeState,
  buildShareableUrl,
} from '../src/url-state.js';

const assumptions = loadAssumptions('waymo_like');
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
        ...assumptions.presets.waymo_like_mature_dense.inputs,
        gross_fare_per_paid_mile: 4.25,
        paid_mile_ratio: 0.58,
        number_of_cities: 10,
      };
      const hash = encodeState('waymo_like_mature_dense', inputs, assumptions, VERSION);
      const decoded = decodeState(hash, assumptions);

      expect(decoded.presetId).toBe('waymo_like_mature_dense');
      expect(decoded.architectureId).toBe('waymo_like');
      expect(decoded.modelVersion).toBe(VERSION);
      expect(decoded.versionMismatch).toBe(false);
      expect(decoded.inputs).toEqual(inputs);
    });

    it('round-trips a cybercab preset with the right architecture', () => {
      const inputs = {
        ...assumptions.presets.cybercab_mature_dense.inputs,
        vehicle_av_capex: 50000,
      };
      const hash = encodeState('cybercab_mature_dense', inputs, assumptions, VERSION);
      expect(hash).toContain('arch=cybercab');

      const decoded = decodeState(hash, assumptions);
      expect(decoded.presetId).toBe('cybercab_mature_dense');
      expect(decoded.architectureId).toBe('cybercab');
      expect(decoded.inputs).toEqual(inputs);
    });
  });

  describe('delta encoding', () => {
    it('omits values identical to the preset baseline', () => {
      const inputs = { ...assumptions.presets.waymo_like_early_growth.inputs };
      const hash = encodeState('waymo_like_early_growth', inputs, assumptions, VERSION);

      expect(hash).toBe(
        `#preset=waymo_like_early_growth&v=${VERSION}&arch=waymo_like`
      );
    });

    it('encodes only the variables that changed', () => {
      const inputs = {
        ...assumptions.presets.waymo_like_early_growth.inputs,
        vehicle_av_capex: 150000,
      };
      const hash = encodeState('waymo_like_early_growth', inputs, assumptions, VERSION);

      expect(hash).toContain('vehicle_av_capex=150000');
      for (const id of assumptions.variableIds) {
        if (id !== 'vehicle_av_capex') {
          expect(hash).not.toContain(id);
        }
      }
    });

    it('treats a value rounded back to the baseline as unchanged', () => {
      const inputs = {
        ...assumptions.presets.waymo_like_early_growth.inputs,
        // 4-significant-figure rounding collapses this onto the 175000 baseline
        vehicle_av_capex: 175000.001,
      };
      const hash = encodeState('waymo_like_early_growth', inputs, assumptions, VERSION);

      expect(hash).toBe(
        `#preset=waymo_like_early_growth&v=${VERSION}&arch=waymo_like`
      );
    });
  });

  describe('version mismatch', () => {
    it('flags a URL encoded with a different model version', () => {
      const inputs = { ...assumptions.presets.waymo_like_early_growth.inputs };
      const hash = encodeState('waymo_like_early_growth', inputs, assumptions, '9.9.9');
      const decoded = decodeState(hash, assumptions);

      expect(decoded.versionMismatch).toBe(true);
      expect(decoded.modelVersion).toBe('9.9.9');
    });

    it('does not flag a URL with the current model version', () => {
      const inputs = { ...assumptions.presets.waymo_like_early_growth.inputs };
      const hash = encodeState('waymo_like_early_growth', inputs, assumptions, VERSION);

      expect(decodeState(hash, assumptions).versionMismatch).toBe(false);
    });
  });

  describe('v0.1.0 migration', () => {
    it.each([
      ['early_growth', 'waymo_like_early_growth'],
      ['mature_dense', 'waymo_like_mature_dense'],
      ['replicated_multicity', 'waymo_like_replicated_multicity'],
    ])('maps old preset "%s" to "%s" with versionMismatch', (oldId, newId) => {
      const decoded = decodeState(`#preset=${oldId}&v=0.1.0`, assumptions);

      expect(decoded.presetId).toBe(newId);
      expect(decoded.architectureId).toBe('waymo_like');
      expect(decoded.versionMismatch).toBe(true);
      expect(decoded.inputs).toEqual(assumptions.presets[newId].inputs);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('flags migrated presets even if the URL claims the current version', () => {
      const decoded = decodeState(`#preset=mature_dense&v=${VERSION}`, assumptions);
      expect(decoded.presetId).toBe('waymo_like_mature_dense');
      expect(decoded.versionMismatch).toBe(true);
    });

    it('keeps still-valid deltas and drops retired v0.1.0 variables', () => {
      const decoded = decodeState(
        '#preset=mature_dense&v=0.1.0&paid_mile_ratio=0.6&net_revenue_per_paid_mile=3.8',
        assumptions
      );

      expect(decoded.presetId).toBe('waymo_like_mature_dense');
      expect(decoded.inputs.paid_mile_ratio).toBe(0.6);
      expect(decoded.inputs).not.toHaveProperty('net_revenue_per_paid_mile');
      expect(decoded.versionMismatch).toBe(true);
    });
  });

  describe('unknown variable ids', () => {
    it('ignores variables not present in current assumptions', () => {
      const hash = `#preset=waymo_like_early_growth&v=${VERSION}&number_of_cities=12&retired_variable=42`;
      const decoded = decodeState(hash, assumptions);

      expect(decoded.presetId).toBe('waymo_like_early_growth');
      expect(decoded.inputs.number_of_cities).toBe(12);
      expect(decoded.inputs).not.toHaveProperty('retired_variable');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('ignores non-numeric values for known variables', () => {
      const hash = `#preset=waymo_like_early_growth&v=${VERSION}&number_of_cities=banana`;
      const decoded = decodeState(hash, assumptions);

      expect(decoded.inputs.number_of_cities).toBe(
        assumptions.presets.waymo_like_early_growth.inputs.number_of_cities
      );
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('malformed hashes', () => {
    it.each(['#garbage-without-params', '#preset=no_such_preset&v=0.2.0', '#&&==&'])(
      'returns the default preset and warns for %s',
      (hash) => {
        const decoded = decodeState(hash, assumptions);

        expect(decoded.presetId).toBe(DEFAULT_PRESET);
        expect(decoded.architectureId).toBe('waymo_like');
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
        expect(decoded.architectureId).toBe('waymo_like');
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
        ...assumptions.presets.waymo_like_early_growth.inputs,
        paid_mile_ratio: 0.6,
      };
      const url = buildShareableUrl(
        'waymo_like_early_growth',
        inputs,
        assumptions,
        VERSION,
        'https://example.com/robotaxi/'
      );

      expect(url).toBe(
        `https://example.com/robotaxi/#preset=waymo_like_early_growth&v=${VERSION}&arch=waymo_like&paid_mile_ratio=0.6`
      );
    });

    it('replaces an existing hash on the base URL', () => {
      const inputs = { ...assumptions.presets.waymo_like_early_growth.inputs };
      const url = buildShareableUrl(
        'waymo_like_early_growth',
        inputs,
        assumptions,
        VERSION,
        'https://example.com/#preset=old'
      );

      expect(url).toBe(
        `https://example.com/#preset=waymo_like_early_growth&v=${VERSION}&arch=waymo_like`
      );
    });
  });
});
