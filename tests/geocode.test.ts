import { describe, expect, it, vi } from 'vitest';
import { createSuggester, levelOf, placeKeyOf, toResolvedPlace } from '../src/lib/geocode';
import type { PhotonFeature } from '../src/lib/geocode';
import type { ResolvedPlace } from '../src/lib/types';

const feature = (props: PhotonFeature['properties']): PhotonFeature => ({
	geometry: { coordinates: [-104.6091, 38.2544] },
	properties: props
});

describe('levelOf', () => {
	it('maps Photon types onto engine place levels', () => {
		expect(levelOf('country')).toBe('country');
		expect(levelOf('state')).toBe('admin1');
		expect(levelOf('county')).toBe('county');
		expect(levelOf('city')).toBe('locality');
		expect(levelOf('house')).toBe('locality');
		expect(levelOf(undefined)).toBe('locality');
	});
});

describe('toResolvedPlace', () => {
	it('reads coordinates in lat/lng order from GeoJSON lng/lat', () => {
		const place = toResolvedPlace(
			feature({ name: 'Pueblo', state: 'Colorado', country: 'United States', type: 'city' })
		);

		expect(place.lat).toBeCloseTo(38.2544, 4);
		expect(place.lng).toBeCloseTo(-104.6091, 4);
		expect(place.name).toBe('Pueblo, Colorado, United States');
	});

	it('gives two addresses in one city the same place key', () => {
		const a = placeKeyOf(
			{ name: '110 Main St', city: 'Pueblo', county: 'Pueblo County', state: 'Colorado', country: 'United States' },
			'locality'
		);
		const b = placeKeyOf(
			{ name: '4400 Elm Ave', city: 'Pueblo', county: 'Pueblo County', state: 'Colorado', country: 'United States' },
			'locality'
		);

		expect(a).toBe(b);
	});

	it('keeps a state distinct from a city inside it', () => {
		const city = placeKeyOf({ city: 'Pueblo', state: 'Colorado', country: 'United States' }, 'locality');
		const state = placeKeyOf({ name: 'Colorado', state: 'Colorado', country: 'United States' }, 'admin1');

		expect(city).not.toBe(state);
	});
});

describe('createSuggester', () => {
	it('waits for the debounce window before calling the provider', async () => {
		vi.useFakeTimers();
		const provider = vi.fn(async () => [] as ResolvedPlace[]);
		const suggester = createSuggester(provider, 300);

		suggester.suggest('pueb', () => {});
		expect(provider).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300);
		expect(provider).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it('collapses a burst of keystrokes into one request', async () => {
		vi.useFakeTimers();
		const provider = vi.fn(async () => [] as ResolvedPlace[]);
		const suggester = createSuggester(provider, 300);

		for (const query of ['pue', 'pueb', 'puebl', 'pueblo']) {
			suggester.suggest(query, () => {});
			await vi.advanceTimersByTimeAsync(50);
		}
		await vi.advanceTimersByTimeAsync(300);

		expect(provider).toHaveBeenCalledTimes(1);
		expect(provider).toHaveBeenCalledWith('pueblo');
		vi.useRealTimers();
	});

	it('does not call out for a query below the minimum length', async () => {
		vi.useFakeTimers();
		const provider = vi.fn(async () => [] as ResolvedPlace[]);
		const suggester = createSuggester(provider, 300);
		const onResults = vi.fn();

		suggester.suggest('pu', onResults);
		await vi.advanceTimersByTimeAsync(500);

		expect(provider).not.toHaveBeenCalled();
		expect(onResults).toHaveBeenCalledWith([]);
		vi.useRealTimers();
	});

	it('drops a late response for a superseded query', async () => {
		vi.useFakeTimers();
		const slow: ResolvedPlace[] = [];
		const provider = vi.fn(async () => slow);
		const suggester = createSuggester(provider, 300);
		const onResults = vi.fn();

		suggester.suggest('pueblo', onResults);
		suggester.cancel();
		await vi.advanceTimersByTimeAsync(500);

		expect(onResults).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
