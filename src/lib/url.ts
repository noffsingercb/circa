/**
 * Scheme allowlisting for URLs that came from the dataset.
 *
 * entry.sourceUrl is rendered as an href. It arrives over the network from the
 * API, which serves it from a ~107k-row table harvested from Wikidata -- so it
 * is third-party data reaching an attribute the browser will execute for
 * certain schemes. `javascript:alert(1)` in that column is a click away from
 * script execution in the visitor's session, and `data:text/html,...` is a
 * same-click navigation to attacker-authored markup.
 *
 * The CSP shipped alongside this blocks `javascript:` hrefs, and that is worth
 * having. It is not the fix. A header can be dropped by a proxy, misconfigured
 * on a future host, or simply not apply on the dev server -- and defending a
 * dangerous value by hoping the browser refuses it is a different posture from
 * never emitting it. Validate at the point of use; let CSP be the backstop it
 * is good at being.
 *
 * The allowlist is http/https rather than a blocklist of known-bad schemes,
 * because the set of dangerous schemes is open-ended and browser-specific
 * (`javascript:`, `data:`, `vbscript:`, `blob:`, custom app handlers). The set
 * of schemes this application has any reason to link to is exactly two.
 */

const SAFE_SCHEMES = new Set(['http:', 'https:']);

/**
 * Returns a normalized absolute URL when `raw` is a safe http(s) URL, or null.
 *
 * Null means "do not render a link" -- callers should fall back to plain text
 * rather than emitting an anchor they cannot vouch for. Every source link in
 * the dataset is an absolute Wikipedia or Wikidata URL, so rejecting relative
 * paths costs nothing real and avoids resolving attacker-influenced input
 * against our own origin.
 *
 * Parsing with the URL constructor rather than a regex is deliberate: it is the
 * same parser the browser will use for the href, so a value this function
 * accepts cannot be re-interpreted as a different scheme afterwards. That is
 * exactly how regex-based checks get bypassed -- with leading whitespace,
 * control characters, or mixed case (`java\tscript:`, `JavaScript:`), all of
 * which the URL parser normalizes before we inspect the protocol.
 */
export function safeHttpUrl(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;

	const trimmed = raw.trim();
	if (!trimmed) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		// Not an absolute URL. No base is passed on purpose; see above.
		return null;
	}

	if (!SAFE_SCHEMES.has(parsed.protocol)) return null;

	// The parser's normalized form, not the input string, so what is rendered is
	// what was actually validated.
	return parsed.href;
}
