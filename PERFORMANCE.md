# Golem rendering and cleanup measurements

Measured on 2026-09-19 using the shared Chromium window and native DevTools Protocol. The baseline used revision `3b722a4`; the optimized implementation used `60a2575`.

The optimized implementation reduced median sampled extension CPU from 2.04 s to 0.52 s over the 45-second observation window. Median time until the tracked ads and advertising background disappeared fell from 7.84 s to 6.22 s. A subscription banner remained visible in all three optimized trials, so full viewport cleanup was not achieved.

## Remeasurement after optimizations 1 and 2

Revision `60a2575` implements the first two opportunities below:

- [Candidate reads](lib/candidates/read-cache.ts) share computed styles, generated ad labels, and visibility/ancestor checks within each synchronous scan slice. Cheap structural checks run first. Shared reads are cleared after presentation work and discarded before yielding; validation before hiding remains fresh.
- [Queued classifications](lib/runtime/classification-queue.ts) keep the initial 100 ms gathering delay but dispatch an existing backlog without repeating it. Dispatch also rechecks the memory cache. Idle preparation, single-flight requests, generation checks, cooldowns, and retry limits remain in place.

The same browser, viewport, settings, retained caches, sampling method, and 45-second observation windows were used. Three valid trials stayed in the foreground. A fourth trial changed documents, recorded background samples, and produced an incomplete CPU profile; it was excluded and replaced. Live advertising varied between reloads, so this is a repeat-visit comparison rather than a controlled identical-page benchmark.

| Optimized trial | First contentful paint | Largest contentful paint | First region hidden | Ads and background clear | Sampled TidyUp CPU, full 45 s | Final hidden count |
| --------------- | ---------------------: | -----------------------: | ------------------: | -----------------------: | ----------------------------: | -----------------: |
| 1               |                 5.69 s |                   5.69 s |              6.22 s |                   6.22 s |                        0.51 s |                 14 |
| 2               |                 1.06 s |                   1.27 s |              5.83 s |                   7.34 s |                        0.69 s |                 15 |
| 3               |                 0.66 s |                   0.66 s |              4.50 s |                   6.01 s |                        0.52 s |                 16 |

The ads-only measurement uses the same tracked slots and body color as the baseline but excludes the surviving subscription banner. The last samples showing ads or the advertising background were at 5.72, 6.84, and 5.51 seconds. They stayed clear afterward through the end of each trial.

| Median across three valid trials     | Baseline |   Optimized | Observation                             |
| ------------------------------------ | -------: | ----------: | --------------------------------------- |
| Sampled extension CPU, full 45 s     |   2.04 s |      0.52 s | 74% lower                               |
| Ads and advertising background clear |   7.84 s |      6.22 s | 1.62 s earlier, about 21%               |
| First region hidden                  |   3.51 s |      5.83 s | 2.32 s later                            |
| Entire tracked viewport clear        |   7.84 s | Not reached | Subscription banner remained after 45 s |

CPU use and completion of ad cleanup improved in these samples, but initial hiding did not. Paint timings also varied substantially; no page-paint improvement is claimed. Because both changes shipped together, these measurements do not isolate their individual effects.

Inspected-element counts were 6,995, 10,198, and 6,994. Candidates sent to the background were 167, 167, and 164, close to the baseline. The worker recorded 4, 5, and 3 provider requests, completing in 263–677 ms. All three main-frame queues drained without a reported error.

The subscription rule was enabled. A read-only comparison of the old and new extractors on the same live DOM returned identical results for all 273 candidates. A separate check of the surviving banner also returned identical candidates. That rules out a difference in extracted banner features in that check, but does not establish why classification or hiding missed it. The banner needs separate diagnosis; it must not be treated as successful full-page cleanup.

Validation: formatting, lint, type checking, all 160 tests, and Chrome/Firefox builds passed. Tests cover shared-read invalidation, fresh validation, backlog dispatch, resets, cache handling, and cooldown/retry behavior. The original browser settings were restored, the measurement tab was closed, and the original forum tab was reactivated.

## Baseline

The remaining sections describe the original `3b722a4` measurements and the opportunities identified from them.

## Method and limits

- Browser: Chrome/152.0.7977.82, viewport 2544 × 1256, no artificial network or CPU throttling.
- Three foreground reloads of `www.golem.de`, observed for 45 seconds each. Browser and decision caches were retained. These are repeat-visit measurements, not cold-start results.
- Automatic activation, four active starter rules, 90% threshold, caching enabled, OpenRouter connection.
- Captured paint/navigation timings, long tasks, sampled JavaScript stacks, extension status, and provider request timings. Status and visible-region checks ran approximately every 500 ms. Busy periods stretched the interval.
- "Viewport clear" means no visible creative in the tracked Golem ad slots, no visible subscription banner, and no remaining inline advertising body color. It does not establish that every unwanted region across the entire page was removed. Cookie consent was already settled and was not measured.
- CPU sampling adds overhead. Advertising content varies between reloads. These observations identify costs, not a promised speedup from a proposed change.
- Two site-exclusion trials still recorded provider traffic. Two subsequent globally disabled trials recorded none, but the tab moved into the background during both. Those trials are excluded from rendering comparisons. No blocker-on/off loading penalty is claimed.
- Restored the original settings and reloaded Golem after measurement.

## Observed timings

Times below are seconds since navigation. Hiding times are the first samples confirming the state, so they are upper bounds within the sampling interval.

| Foreground run | First contentful paint | Largest contentful paint | First region hidden | Viewport clear | Final hidden count |
| -------------- | ---------------------: | -----------------------: | ------------------: | -------------: | -----------------: |
| 1              |                   0.80 |                     1.00 |                3.11 |           7.48 |                 14 |
| 2              |                   0.84 |                     0.84 |                3.51 |           7.84 |                 14 |
| 3              |                   0.77 |                     0.77 |                4.94 |           7.98 |                 14 |

The last samples still showing unwanted content were at 6.98, 7.34, and 7.48 seconds respectively. The tracked viewport stayed clear afterward through the end of each observation window. Visible ad creatives first appeared in these samples at about 3.8 to 4.1 seconds, leaving roughly another four seconds before cleanup completed.

The browser's `load` event occurred at 18.51, 6.06, and 2.02 seconds. It is a poor completion metric here: one page was clear before `load`, while another loaded several seconds before it was clear.

## Where time goes

| Foreground run | Sampled TidyUp CPU, full 45 s window | Sampled TidyUp CPU, first 8 s | Elements inspected | Candidates sent to background | Observed provider requests |
| -------------- | -----------------------------------: | ----------------------------: | -----------------: | ----------------------------: | -------------------------: |
| 1              |                               2.99 s |                        1.28 s |             16,646 |                           166 |                          4 |
| 2              |                               1.99 s |                        1.18 s |             10,639 |                           167 |                          6 |
| 3              |                               2.04 s |                        1.19 s |             11,008 |                           164 |                          1 |

CPU figures attribute samples to TidyUp when the stack contains its content script. They cover the profiled renderer, not total browser CPU or every separate frame process. Provider traffic is observed at the shared extension worker, so request counts are not exclusively attributable to the main frame.

`isOverlay`, `isHidden`, and `generatedAdLabel` together accounted for about 56% to 58% of sampled TidyUp CPU. Their repeated computed-style and ancestor checks dominate the observed extension stacks. The profile's minified function locations were matched against the built content script from this revision.

Provider requests completed in 266 to 484 ms. Run 3 needed only one observed provider request, lasting 400 ms, yet its viewport cleared at 7.98 seconds. Remote classification alone does not explain the cleanup delay.

In run 1, the hidden count and background-request candidate count stayed at 14 and 166 after about eight seconds. The inspected-element count nevertheless rose from 10,098 at ten seconds to 16,646 by the end. That is evidence of repeated scanning without additional hiding in that interval, although this measurement does not isolate which mutations caused it.

The existing popup counters need care: `sent` includes candidates served from persistent cache; `cacheHits` counts only the content-script memory cache; `latencyMs` is the last background-message roundtrip. None is a direct measure of total provider work or time to a clear page.

## Optimization opportunities

1. Reduce repeated style and ancestor checks. [Extraction](lib/candidates/extract.ts) runs special-region checks before rejecting ordinary ineligible tags, then repeats consent/visibility checks. [Consent detection](lib/candidates/regions.ts) walks ancestors and checks their styles for many descendants. Apply cheap structural rejection first and share ancestor/style results within a bounded read-only scan phase. Invalidate reused results after mutations or presentation writes, and retain fresh validation before hiding. This targets the largest measured CPU cost.

2. Remove the recurring delay for an existing backlog. [The classification queue](lib/runtime/classification-queue.ts) waits 100 ms before every batch, including warm-cache batches. Four active rules cap a batch at 16 candidates. Keep a short gathering delay for new work, but dispatch already queued work promptly while retaining idle slices and provider limits. Recheck the memory cache at dispatch because an earlier batch may have filled it since insertion. This is the smallest scheduling change to try first.

3. Prioritize visible ads and overlays. The scanner walks DOM order and classification uses a FIFO queue. Give already-extracted visible advertising and overlay candidates priority over routine content and offscreen regions. Keep all user rules and normal classification; priority should change order, not authorize hiding or discard other candidates. Measure time to a clear viewport separately from time to finish the whole-page scan.

4. Return cached decisions before uncached work finishes. [Persistent-cache handling](lib/classifier/cache.ts) waits for missing decisions before returning hits from a mixed batch. [The service](lib/classifier/service.ts) also puts the cache lookup behind the global classification lock. A fast path for cached results could avoid both waits. Preserve cache-clear epochs, settings validation, and provider concurrency limits. This is a larger change than removing the queue delay.

5. Reduce rescans triggered by presentation writes. [Mutation handling](lib/runtime/page-session.ts) queues mutated targets, or the document for large mutation batches. Distinguish the extension's own expected style writes from new page changes, and avoid scanning hidden subtrees when only their presentation needs validation. The extra inspections after cleanup justify investigating this, but external mutations still need full safety checks.

Opportunities 1 and 2 are implemented and remeasured above. Opportunities 3–5 remain unimplemented; their performance effects have not been measured.
