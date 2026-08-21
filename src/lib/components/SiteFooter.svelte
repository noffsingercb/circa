<!--
	The app's link out to the written pages.

	A footer rather than a header nav, deliberately. Most people meet Circa as a
	free tool and want the form, not a site to browse; navigation above the
	form would be selling a website to someone who came for an applet. Below
	it, the links are there for anyone who finishes and wants to know how it
	worked.

	No "Circa App" link here, unlike the static pages' footer: this IS the app,
	and a link to the page you are already on is noise.

	The styles here duplicate .site-footer in static/site.css, because Svelte
	scopes component styles and the hand-written HTML pages cannot reach them.
	That is the accepted cost of not building a shared component system for five
	pages -- see the comment in site.css.

	data-sveltekit-reload on every internal link: these are static HTML files,
	not routes in this app. Without it the client-side router would try to
	handle the navigation itself, find no matching route, and fall through to
	the SPA fallback instead of loading the page.
-->
<footer class="site-footer no-print">
	<div class="inner">
		<a href="/why" data-sveltekit-reload>Why this exists</a>
		<a href="/how-it-works" data-sveltekit-reload>How this works</a>
		<a href="/resources" data-sveltekit-reload>Resources</a>
		<a href="/faq" data-sveltekit-reload>FAQ</a>
		<span class="spacer"></span>
		<!-- External, so no data-sveltekit-reload: the router never intercepts a
		     cross-origin href. -->
		<a class="who" href="https://www.linkedin.com/in/noffsingercb/" rel="noopener">
			By Ben Noffsinger
		</a>
	</div>
</footer>

<style>
	.site-footer {
		border-top: 1px solid var(--line);
		padding: 1.5rem 1.25rem 3rem;
	}

	.inner {
		max-width: 52rem;
		margin: 0 auto;
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem 1.25rem;
		font-size: 0.85rem;
	}

	a {
		color: var(--ink-soft);
	}

	a:hover {
		color: var(--accent);
	}

	.spacer {
		flex: 1;
	}

	@media (max-width: 640px) {
		.inner {
			flex-direction: column;
		}

		.spacer {
			display: none;
		}
	}
</style>
