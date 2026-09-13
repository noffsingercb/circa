<!--
	The ask for an event the record is missing.

	Shown only under a timeline that has actually been generated, which is the
	one moment a visitor knows what is missing and cares that it is. It is
	deliberately NOT in SiteFooter: a link present on the landing page collects
	suggestions from people who have never seen a result, which is the weakest
	input this project could ask for, and there is no Suggest page in the nav
	for the same reason.

	A link out to a Google Form rather than an embedded one. An iframe would
	load Google's cookies and third-party requests into the page, contradicting
	the privacy promise on the front page and the standing rule that nothing is
	requested beyond the geocoder and the timeline endpoint. A new tab needs no
	CSP exception; an iframe would need frame-src.

	Nothing about the visitor's own timeline is passed to the form. Prefilling
	the place and dates they searched would improve the submissions and would
	hand their family's details to Google, which is the single thing this
	architecture exists to avoid.
-->
<p class="suggest no-print">
	Don’t see an event you think should be there?
	<a
		href="https://docs.google.com/forms/d/e/1FAIpQLSf99RrYHFQ_HTlUvgoW4XH2itw0x7Ew-N0KY_uWTlddnFZclg/viewform"
		target="_blank"
		rel="noopener noreferrer"
	>
		Suggest an event to Circa
	</a>
</p>

<style>
	/*
	 * Body text rather than a button. A button here would compete with Share
	 * and Print for attention and imply the suggestion is part of finishing
	 * the task, which it is not.
	 */
	.suggest {
		margin: 1.25rem 0 0;
		font-size: 0.85rem;
		color: var(--ink-soft);
		max-width: 34rem;
	}

	.suggest a {
		color: var(--accent);
	}
</style>
