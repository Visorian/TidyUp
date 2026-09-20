import { extractCandidate } from '../lib/candidates/extract';
import { regionSelector } from '../lib/runtime/replay-regions';
import { assert, candidate, element } from './browser-support';

export function checkLearnedLocators(): string {
  const generated = element('ad-7687366005231715545');
  const locator = regionSelector(generated);
  assert(
    locator !== null && !locator.includes('7687366005231715545'),
    'Generated identifiers must not anchor a learned locator',
  );
  assert(document.querySelector(locator) === generated, 'A locator must resolve to its region');
  assert(
    regionSelector(element('sidebar-ads')) === 'div#sidebar-ads',
    'Stable identifiers must anchor a learned locator',
  );
  return 'Learned locators skip generated identifiers and resolve back to their region';
}

export function checkPageSkinEvidence(): string {
  const frame = document.createElement('iframe');
  frame.src = 'about:blank';
  frame.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;border:0;';
  document.body.append(frame);
  try {
    const skin = extractCandidate(frame, 'skin-frame', 'news.example.org');
    assert(
      skin?.display?.fullViewport === true,
      'A viewport-covering frame must carry page-skin evidence',
    );
    assert(
      candidate('banner').display?.fullViewport === false,
      'Ordinary banners must not claim the viewport',
    );
  } finally {
    frame.remove();
  }
  return 'Viewport-covering frames are distinguishable from ordinary placements';
}
