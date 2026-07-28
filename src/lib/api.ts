import {
	API_BASE,
	BASE_FLOOR,
	GLOBAL_CAP,
	MAX_PER_SEGMENT,
	MAX_SEGMENTS,
	MIN_MATCHES,
	RELAXED_FLOOR,
	REQUEST_TIMEOUT_MS,
	TIMELINE_PATH
} from './config';
import type { CircaEntry, CircaResult, SegmentInput, Timeline } from './types';

export class ApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

type FetchLike = typeof fetch;

async function postTimeline(
	segments: SegmentInput[],
	significanceFloor: number,
	fetchImpl: FetchLike
): Promise<Timeline> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetchImpl(API_BASE + TIMELINE_PATH, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: controller.signal,
			body: JSON.stringify({
				segments,
				config: {
					significanceFloor,
					maxPerSegment: MAX_PER_SEGMENT,
					maxSegments: MAX_SEGMENTS
				}
			})
		});

		if (!response.ok) {
			throw new ApiError('The timeline service could not be reached.', response.status);
		}

		return (await response.json()) as Timeline;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Query the engine, then backfill any segment that came back too thin.
 *
 * The retry sends only the sparse segments, so the segmentIndex values in that
 * second response are local to the sub-array and have to be mapped back to
 * their positions in the caller's list before the two sets are merged.
 */
export async function fetchTimeline(
	segments: SegmentInput[],
	fetchImpl: FetchLike = fetch
): Promise<CircaResult> {
	const base = await postTimeline(segments, BASE_FLOOR, fetchImpl);
	const entries: CircaEntry[] = base.entries.map((entry) => ({ ...entry, relaxed: false }));

	const counts = new Array<number>(segments.length).fill(0);
	for (const entry of entries) {
		if (counts[entry.segmentIndex] !== undefined) counts[entry.segmentIndex] += 1;
	}

	const thin: number[] = [];
	counts.forEach((count, index) => {
		if (count < MIN_MATCHES) thin.push(index);
	});

	let relaxedSegments: number[] = [];

	if (thin.length > 0) {
		const retry = await postTimeline(
			thin.map((index) => segments[index]),
			RELAXED_FLOOR,
			fetchImpl
		);
		const seen = new Set(entries.map((entry) => entry.id));

		for (const entry of retry.entries) {
			if (seen.has(entry.id)) continue;
			seen.add(entry.id);
			entries.push({
				...entry,
				segmentIndex: thin[entry.segmentIndex] ?? entry.segmentIndex,
				relaxed: true
			});
		}

		relaxedSegments = thin;
	}

	return {
		entries: capEntries(entries),
		datasetVersion: base.datasetVersion,
		generatedWith: base.generatedWith,
		relaxedSegments
	};
}

/**
 * Trim to the global ceiling by score, then order by date for rendering.
 * Trimming by score rather than by date keeps the cut from lopping off the end
 * of a long life.
 */
export function capEntries(entries: CircaEntry[]): CircaEntry[] {
	const kept =
		entries.length > GLOBAL_CAP
			? [...entries].sort((a, b) => b.score - a.score).slice(0, GLOBAL_CAP)
			: [...entries];

	return kept.sort(
		(a, b) => a.dateStartISO.localeCompare(b.dateStartISO) || a.id.localeCompare(b.id)
	);
}
