import { GEOCODE_DEBOUNCE_MS, GEOCODE_LIMIT, GEOCODE_MIN_QUERY, PHOTON_HOST } from './config';
import type { PlaceLevel, ResolvedPlace } from './types';

/**
 * Place lookup via Photon, an open geocoder over OpenStreetMap data.
 *
 * Two properties matter for Circa: it accepts loose input ("pueblo colorado",
 * "bavaria", "peru") and it requires no API key, so no credential ever reaches
 * the browser and no user ever has to sign in.
 */

export interface PhotonFeature {
	geometry: { coordinates: [number, number] };
	properties: {
		name?: string;
		city?: string;
		county?: string;
		state?: string;
		country?: string;
		type?: string;
		osm_id?: number | string;
		osm_type?: string;
	};
}

type FetchLike = typeof fetch;

export type PlaceProvider = (query: string) => Promise<ResolvedPlace[]>;

/**
 * Photon's `type` describes what kind of thing matched. We collapse it to the
 * four levels the engine understands. Anything more precise than a locality --
 * a street, a house number -- is still just a locality: a street address is a
 * more precise pin, not a different kind of place.
 */
export function levelOf(type: string | undefined): PlaceLevel {
	switch (type) {
		case 'country':
			return 'country';
		case 'state':
			return 'admin1';
		case 'county':
			return 'county';
		default:
			return 'locality';
	}
}

function displayName(props: PhotonFeature['properties']): string {
	const parts = [props.name, props.city, props.state, props.country]
		.filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
	return parts.join(', ');
}

/**
 * Identity used to decide whether two life events happened in the same place.
 * City-level on purpose: events reach far enough that a few kilometres inside
 * one city never changes which ones match.
 */
export function placeKeyOf(props: PhotonFeature['properties'], level: PlaceLevel): string {
	const city = level === 'locality' ? (props.city ?? props.name ?? '') : '';
	const county = level === 'locality' || level === 'county' ? (props.county ?? '') : '';
	return [props.country ?? '', props.state ?? '', county, city]
		.map((part) => part.trim().toLowerCase())
		.join('|');
}

export function toResolvedPlace(feature: PhotonFeature): ResolvedPlace {
	const props = feature.properties;
	const [lng, lat] = feature.geometry.coordinates;
	const level = levelOf(props.type);

	return {
		name: displayName(props),
		lat,
		lng,
		level,
		placeKey: placeKeyOf(props, level),
		osmId: props.osm_id === undefined ? undefined : `${props.osm_type ?? ''}${props.osm_id}`
	};
}

export function createPhotonProvider(fetchImpl: FetchLike = fetch): PlaceProvider {
	return async (query: string): Promise<ResolvedPlace[]> => {
		const endpoint = 'https://' + PHOTON_HOST + '/api';
		const url = endpoint + '?limit=' + GEOCODE_LIMIT + '&lang=en&q=' + encodeURIComponent(query);
		const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
		if (!response.ok) return [];
		const body = (await response.json()) as { features?: PhotonFeature[] };
		return (body.features ?? []).map(toResolvedPlace);
	};
}

export interface Suggester {
	suggest: (query: string, onResults: (places: ResolvedPlace[]) => void) => void;
	cancel: () => void;
}

/**
 * Debounced, race-safe wrapper around a provider. Late responses to superseded
 * keystrokes are dropped rather than flashing stale suggestions.
 */
export function createSuggester(
	provider: PlaceProvider,
	delayMs: number = GEOCODE_DEBOUNCE_MS
): Suggester {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let generation = 0;

	const cancel = () => {
		if (timer !== null) clearTimeout(timer);
		timer = null;
		generation += 1;
	};

	return {
		cancel,
		suggest(query, onResults) {
			cancel();
			const trimmed = query.trim();
			if (trimmed.length < GEOCODE_MIN_QUERY) {
				onResults([]);
				return;
			}
			const mine = generation;
			timer = setTimeout(() => {
				provider(trimmed)
					.then((places) => {
						if (mine === generation) onResults(places);
					})
					.catch(() => {
						if (mine === generation) onResults([]);
					});
			}, delayMs);
		}
	};
}
