import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBrowserRegion, TIMEZONE_COUNTRY_MAP } from '../src/utils/geo.js';

describe('Geo Region Resolver - Multi-Tiered Fallbacks', () => {
  it('Tier 1: prioritizes valid user override', () => {
    assert.equal(getBrowserRegion('jp'), 'JP');
    assert.equal(getBrowserRegion('IN'), 'IN');
    assert.equal(getBrowserRegion('gb'), 'GB');
  });

  it('Tier 2: resolves region from navigator.languages / language', () => {
    assert.equal(
      getBrowserRegion(null, {
        navigator: { languages: ['en-GB', 'en-US'], language: 'en-GB' },
        Intl: globalThis.Intl
      }),
      'GB'
    );

    assert.equal(
      getBrowserRegion(null, {
        navigator: { languages: ['ja-JP'], language: 'ja-JP' },
        Intl: globalThis.Intl
      }),
      'JP'
    );

    assert.equal(
      getBrowserRegion(null, {
        navigator: { languages: ['pt-BR'], language: 'pt-BR' },
        Intl: globalThis.Intl
      }),
      'BR'
    );
  });

  it('Tier 3: resolves region from IANA timezone when locale has no region tag', () => {
    const mockIntl = (tz) => ({
      Locale: globalThis.Intl.Locale,
      DateTimeFormat: () => ({
        resolvedOptions: () => ({ timeZone: tz })
      })
    });

    assert.equal(
      getBrowserRegion(null, {
        navigator: { languages: ['en'], language: 'en' },
        Intl: mockIntl('Asia/Kolkata')
      }),
      'IN'
    );

    assert.equal(
      getBrowserRegion(null, {
        navigator: { languages: ['en'], language: 'en' },
        Intl: mockIntl('Europe/Paris')
      }),
      'FR'
    );

    assert.equal(
      getBrowserRegion(null, {
        navigator: { languages: ['en'], language: 'en' },
        Intl: mockIntl('America/Toronto')
      }),
      'CA'
    );
  });

  it('Tier 4: returns AUTO for Cloudflare Edge Geo-IP when no signals exist', () => {
    assert.equal(
      getBrowserRegion(null, {
        navigator: { languages: [], language: '' },
        Intl: {
          Locale: globalThis.Intl.Locale,
          DateTimeFormat: () => ({
            resolvedOptions: () => ({ timeZone: 'Unknown/Zone' })
          })
        }
      }),
      'AUTO'
    );
  });

  it('verifies TIMEZONE_COUNTRY_MAP covers key worldwide regions', () => {
    assert.ok(Object.keys(TIMEZONE_COUNTRY_MAP).length >= 50);
    assert.equal(TIMEZONE_COUNTRY_MAP['Asia/Kolkata'], 'IN');
    assert.equal(TIMEZONE_COUNTRY_MAP['America/New_York'], 'US');
    assert.equal(TIMEZONE_COUNTRY_MAP['Europe/London'], 'GB');
    assert.equal(TIMEZONE_COUNTRY_MAP['Australia/Sydney'], 'AU');
    assert.equal(TIMEZONE_COUNTRY_MAP['Africa/Johannesburg'], 'ZA');
  });
});
