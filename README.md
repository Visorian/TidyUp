# TidyUp

TidyUp is a Chrome and Firefox extension that tidies web pages according to your rules. You write the rules for what to hide. The extension collects visible page regions after page load, evaluates your rules in parallel, and hides matching regions reversibly. No rules are enabled by default. When no rules are active, everything stays visible and no page-classification requests are made.

## Try it

Use Bun 1.4.2 and Node.js 24 LTS.

```sh
bun install --frozen-lockfile
bun run check
```

For Chrome, open `chrome://extensions`, enable Developer mode, select Load unpacked, and choose `.output/chrome-mv3`.

For Firefox 140 or newer, open `about:debugging#/runtime/this-firefox`, select Load Temporary Add-on, and choose `.output/firefox-mv3/manifest.json`.

1. Open the extension popup, then Settings. Settings opens inside the popup, with tabs for Rules, Connection, and Preferences. Use the back arrow to return to the current website. Both views follow your system's light or dark theme.
2. Choose TypeSafe or OpenRouter and enter your own API key. OpenRouter shows a selector with Jev as the only supported choice; TypeSafe uses Jev directly. Keys are stored separately for each provider in local extension storage. A blank key field preserves the saved key.
3. Save settings, then select Test connection. This sends a fixed example, not page content, and verifies that the provider returns a decision.
4. Add a custom rule in Settings, or expand Starter categories at the bottom of Rules and select Add starter categories for Ads, Cookie consent, and Subscription prompts. Review and save the groups. You can rename categories, edit their rules, create groups, or keep custom rules outside a category. Adding starter categories moves matching starter rules into their groups and preserves your other rules. Rules describe conditions for hiding, not filter-list syntax.
5. Choose Automatic or Manual activation in Settings. Automatic starts after each page load. Manual waits for Run now in the popup, then follows new content on that page until navigation or Show hidden. Saving settings resets Manual mode to waiting. Open a public website while the extension is enabled. If the tab predates installation, reload it once.
6. Let the page settle. The popup reports hidden regions in the main frame and counts for each category. Category switches apply across websites. A region can match several categories, so their counts can exceed the total. Show hidden toggles between revealing hidden regions and hiding them again. Revealing pauses classification; toggling it off resumes scanning and reapplies unchanged decisions.

The default confidence threshold is 90%, configurable from 90% to 100% in Settings. A region is hidden when any rule matches at or above this threshold. Rules are independent; a rule that does not match does not override another matching rule. You can add up to 20 rules of 500 characters each across custom rules and categories, including disabled groups. Disabled categories do not participate in classification. Subscription starter rules cover promotional offers and keep access-restricting paywalls visible.

Hiding a consent overlay does not accept or reject cookies. The dialog wrapper is hidden and page scrolling is unlocked. Use Show hidden to restore the prompt and its scroll lock when you want to choose. Advertising backgrounds are removed without hiding the page content. Confirmed ads also collapse surrounding containers when those contain only the ad, labels, and empty spacing. Containers with other content stay visible. Show hidden restores the original layout.

Debug mode outlines candidates instead of hiding them. Red meets the threshold, green is a likely non-match, and yellow is uncertain. Settings changes restore hidden regions. Automatic mode resumes with the updated rules; Manual mode waits for Run now. Disabling or removing every active rule stops scanning and restores hidden content.

## Decision cache

Caching is enabled by default and survives reloads and browser restarts. Settings and the popup each have a Remember decisions switch, for all websites and the current website respectively. Each view also has a button to clear its cache. Disabling caching bypasses both stored and page-local decisions for that scope; it does not delete previously stored entries. Clear buttons delete them.

Decisions are keyed by hashes of the candidate, site, provider, and active rules and their category assignments. Changing rules or provider prevents reuse of previous decisions. Changing the confidence threshold reuses probabilities with the new threshold. The cache stores hashes, per-rule probabilities, and timestamps, with a seven-day expiry and a maximum of 2,048 entries. It does not store candidate text or website addresses. Scan again reuses eligible persistent decisions; use Clear site cache to request fresh evaluations.

## Data and permissions

While enabled with at least one active rule, the extension evaluates candidates on public websites according to the activation setting. Manual mode does not scan or classify until Run now is selected. It sends your rules, short visible region descriptions, descriptive signals, coarse layout information, and destination hostnames to the selected service. Use the popup or the excluded-sites list in Settings to disable a site. Localhost, IP addresses, and internal hostnames are not scanned.

The extractor skips forms, editable regions, selected text, and hidden content. It never reads input values or sends raw HTML. URL paths, queries, fragments, and visible token-like strings are excluded or redacted. The background owns credentials and service calls; content scripts receive only settings and decisions. Keys are stored locally without application-level encryption, so this configuration is intended for personal use with your own credentials.

No requests are intercepted or blocked, and no DOM nodes are deleted. Both browser builds use Manifest V3. Firefox declares website-content and browsing-activity transmission during installation; per-site controls still apply.

## Runtime

- One observer collects DOM changes. Scanning runs in bounded idle chunks and pauses in hidden tabs.
- Requests contain independent Noul decisions for candidate/rule pairs, with up to 32 candidates and 64 questions per request. More rules reduce the number of candidates in each batch. Queue and payload limits bound the work. The hiding threshold applies to the highest matching probability across your rules.
- Element identity, semantic fingerprint, and page generation must still match when each result is applied. Meaningful content changes restore hidden regions before reclassification. Unchanged content stays hidden through unrelated DOM updates.
- Page and persistent caches avoid duplicate decisions when caching is enabled. Clearing a cache invalidates pending writes, so an older response cannot repopulate it. Background leases and service backoff live in extension storage.
- Timeouts, malformed results, failed requests, and storage errors leave undecided content visible. Temporary failures resume after the service cooldown, with at most two consecutive automatic retries. The popup reports failures; Scan again restarts a suspended scan.
- Each permitted frame has its own session. Open shadow roots are inspected; closed roots are not. Broad containers and candidates with insufficient evidence are left visible.

Ordinary candidate collection uses structural boundaries and excludes forms, essential interface regions, and regions exceeding 80 nodes or 400 normalized text characters. Consent overlays have a separate bounded scan of up to 240 nodes and 8,000 raw characters, reduced to a sanitized 400-character preview. Frame titles can identify consent wrappers without reading the frame's contents. Native modal dialogs and regions containing private inputs remain excluded.

Page-background candidates contain only the container's own metadata and background-image hostnames. They never include the article or form contents inside that container. Classification still needs evidence that the image is advertising; decorative backgrounds, images without useful metadata, pseudo-element artwork, and inaccessible frame content may remain visible. Use Show hidden and debug mode to inspect results.

## Development

```sh
bun run dev
bun run dev:firefox
bun run build
bun run zip
bun run format
bun run lint:fix
```

WXT owns Vite bundling for both targets. Development commands start its server; load the build manually unless a `web-ext` browser runner is separately installed. There is no additional library build requiring obuild.

`bun run check` runs Oxfmt, type-aware Oxlint, TypeScript 7, both browser builds, and Vitest. Strict checking forbids explicit `any`, unsafe assertions, unhandled promises, and TypeScript suppression comments. Mutable DOM handles are exempt from the readonly-parameter rule because DOM mutation is part of the extension's work. Application data stays readonly. Warnings and unused lint suppressions fail checks.

Tests cover parallel rule requests, empty-rule behavior, invalid responses, persistent cache reuse and invalidation, cache controls, candidate validation, and text redaction. Manifest tests protect idle injection and the absence of network-blocking permissions. `tests/fixtures/candidates.html` supplies ordinary, sponsored, hidden, private-form, editable, and shadow-root regions for browser verification.

With the development server running, open `/tests/fixtures/regions.html` on its local address to run browser checks for consent and background extraction, reversible hiding, scroll restoration, private fields, queue overlap, and dynamic style changes. These checks use local fixtures without calling a provider.
