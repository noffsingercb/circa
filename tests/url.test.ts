import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from '../src/lib/url';

describe('safeHttpUrl', () => {
	it('accepts the http(s) URLs the dataset actually contains', () => {
		expect(safeHttpUrl('https://en.wikipedia.org/wiki/Arizona')).toBe(
			'https://en.wikipedia.org/wiki/Arizona'
		);
		expect(safeHttpUrl('http://example.org/a')).toBe('http://example.org/a');
	});

	it('preserves query strings and fragments', () => {
		expect(safeHttpUrl('https://example.org/a?b=c#d')).toBe('https://example.org/a?b=c#d');
	});

	it('normalizes to the parsed form', () => {
		// Trailing-slash normalization and case-folding of the host are the
		// parser's, which is the point: the rendered value is the validated value.
		expect(safeHttpUrl('https://EXAMPLE.org')).toBe('https://example.org/');
		expect(safeHttpUrl('  https://example.org/a  ')).toBe('https://example.org/a');
	});

	it('rejects javascript: in every casing and spacing the parser accepts', () => {
		expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
		expect(safeHttpUrl('JavaScript:alert(1)')).toBeNull();
		expect(safeHttpUrl('  javascript:alert(1)')).toBeNull();
		// A tab inside the scheme is stripped by the URL parser, so a naive
		// startsWith('javascript:') check would pass this straight through.
		expect(safeHttpUrl('java\tscript:alert(1)')).toBeNull();
		expect(safeHttpUrl('java\nscript:alert(1)')).toBeNull();
	});

	it('rejects other executable or unexpected schemes', () => {
		expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
		expect(safeHttpUrl('vbscript:msgbox(1)')).toBeNull();
		expect(safeHttpUrl('blob:https://example.org/uuid')).toBeNull();
		expect(safeHttpUrl('file:///etc/passwd')).toBeNull();
		expect(safeHttpUrl('mailto:someone@example.org')).toBeNull();
	});

	it('rejects relative paths, which the dataset never uses', () => {
		expect(safeHttpUrl('/wiki/Arizona')).toBeNull();
		expect(safeHttpUrl('example.org')).toBeNull();
		// Protocol-relative: no scheme to check without inventing a base.
		expect(safeHttpUrl('//example.org/a')).toBeNull();
	});

	it('rejects empty and non-string input', () => {
		expect(safeHttpUrl('')).toBeNull();
		expect(safeHttpUrl('   ')).toBeNull();
		expect(safeHttpUrl(null)).toBeNull();
		expect(safeHttpUrl(undefined)).toBeNull();
		expect(safeHttpUrl(42)).toBeNull();
		expect(safeHttpUrl({ href: 'https://example.org' })).toBeNull();
	});
});
