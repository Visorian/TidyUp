# Golem rendering and cleanup measurements

Measured on 2026-09-19 against revision `3b722a4`, using the shared Chromium window and native DevTools Protocol. No implementation changes were made for this measurement.

Golem's main content painted within about one second. The tracked ads and advertising background in the initial viewport disappeared by 7.5 to 8.0 seconds after navigation. Repeated DOM/style checks and scheduling delays are the first optimization targets.

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

Start with the repeated checks and backlog delay, then repeat the same foreground measurement before adding more scheduling complexity. No speedup has been measured for these proposed changes.
