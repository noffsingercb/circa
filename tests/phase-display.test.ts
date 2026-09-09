// Unit tests for the phase-aware display date rules.
//
// GeoHistory has no test runner, so these are written against Circa's vitest
// and import across the two repos. Drop this at circa/tests/phase-display.test.ts
// and point the import at wherever GeoHistory is checked out, OR copy
// phase-display.ts into circa/src/lib/ if you would rather not cross repos --
// the file has no dependencies, which is part of why the rules were extracted
// into it.
//
// Every case below is a row from the two standing fixtures, so a failure here
// names a real defect rather than an abstract one.

import { describe, it, expect } from 'vitest';
import { displayDateFor, phaseSuffixFor, titleStatesPhase, coarserPrecision } from '../src/lib/phase-display';

describe('displayDateFor', () => {
  it("anchors an 'ends' card at the end of the span, not the start", () => {
    // Fixture A: Cold War printed 12 Mar 1947 and should print 1991.
    const d = displayDateFor('ends', '1947-03-12', '1991-12-31', 'day', 'year', '1935-01-01');
    expect(d.iso).toBe('1991-12-31');
    // date_end was stored as '1991', so the day must not be asserted.
    expect(d.precision).toBe('year');
  });

  it("does not invent a day when date_end was year-only", () => {
    // Fixture B: Seven Years' War printed 1756 and should print 1763.
    const d = displayDateFor('ends', '1756-01-01', '1763-12-31', 'year', 'year', '1749-01-01');
    expect(d.iso).toBe('1763-12-31');
    expect(d.precision).toBe('year');
  });

  it("keeps day precision on an 'ends' card when both ends are day-precise", () => {
    const d = displayDateFor('ends', '1939-09-01', '1945-09-02', 'day', 'day', '1935-01-01');
    expect(d.precision).toBe('day');
  });

  it("anchors an 'ongoing' card at the segment start, at year precision", () => {
    // Fixture A: Great Depression printed 24 Oct 1929 ABOVE the 1935 BORN card.
    const d = displayDateFor('ongoing', '1929-10-24', '1939-12-31', 'day', 'year', '1935-01-01');
    expect(d.iso).toBe('1935-01-01');
    // Never 'day': 1 Jan 1935 is the segment's boundary, not an event date.
    expect(d.precision).toBe('year');
  });

  it("leaves 'begins' and point rows exactly as they were", () => {
    const begins = displayDateFor('begins', '1861-04-12', '1865-05-09', 'day', 'day', '1861-01-01');
    expect(begins.iso).toBe('1861-04-12');
    expect(begins.precision).toBe('day');

    const point = displayDateFor(null, '1912-02-14', '1912-02-14', 'day', 'day', '1900-01-01');
    expect(point.iso).toBe('1912-02-14');
  });
});

describe('coarserPrecision', () => {
  it('never claims more exactness than both inputs agree on', () => {
    expect(coarserPrecision('day', 'year')).toBe('year');
    expect(coarserPrecision('year', 'day')).toBe('year');
    expect(coarserPrecision('month', 'day')).toBe('month');
    expect(coarserPrecision('day', 'day')).toBe('day');
    expect(coarserPrecision('century', 'year')).toBe('century');
  });
});

describe('titleStatesPhase', () => {
  it('matches authored titles that already carry the verb', () => {
    // All three are real rows in seed/universal-v0.1.json.
    expect(titleStatesPhase('Industrial Revolution begins')).toBe(true);
    expect(titleStatesPhase('The Reformation begins')).toBe(true);
    expect(titleStatesPhase('Cold War ends')).toBe(true);
  });

  it('does not match a verb that merely appears mid-title', () => {
    expect(titleStatesPhase('The War That Ended Wars')).toBe(false);
    expect(titleStatesPhase('Beginning of the End of Something')).toBe(false);
    expect(titleStatesPhase('Cold War')).toBe(false);
    expect(titleStatesPhase('Great Depression')).toBe(false);
  });
});

describe('phaseSuffixFor', () => {
  it('suppresses the suffix when it would double the verb', () => {
    expect(phaseSuffixFor('Industrial Revolution begins', 'begins')).toBe('');
    // And when the phase CONTRADICTS the title, which is the subtler case:
    // this row drawn as 'ends' must not read 'Industrial Revolution begins - ends'.
    expect(phaseSuffixFor('Industrial Revolution begins', 'ends')).toBe('');
  });

  it('appends the suffix for ordinary titles', () => {
    expect(phaseSuffixFor('Cold War', 'ends')).toBe(' \u2014 ends');
    expect(phaseSuffixFor('Great Depression', 'ongoing')).toBe(' \u2014 ongoing');
  });

  it('returns nothing for a point event', () => {
    expect(phaseSuffixFor('Arizona Statehood', null)).toBe('');
  });

  it('honours a caller-supplied separator', () => {
    expect(phaseSuffixFor('Cold War', 'ends', ' ')).toBe(' ends');
  });
});
