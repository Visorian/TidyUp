import { checkDynamicMutations, checkQueueOverlap } from './browser-runtime';
import { PresentationStore } from '../lib/blocking/hide';
import { extractCandidate } from '../lib/candidates/extract';
import { candidateFingerprint } from '../lib/candidates/fingerprint';
import type { AdCandidate } from '../lib/shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function element(id: string): HTMLElement {
  const value = document.querySelector(`#${id}`);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing fixture: ${id}`);
  return value;
}

function candidate(id: string): AdCandidate {
  const value = extractCandidate(element(id), id, 'news.example.org');
  if (value === null) throw new Error(`Expected candidate: ${id}`);
  return value;
}

function hide(store: Readonly<PresentationStore>, id: string, debug = false): boolean {
  const value = candidate(id);
  return store.apply(element(id), 0.99, 0.9, debug, value.kind);
}

function createFixtures(): void {
  document.body.innerHTML = `
    <style>
      .overlay { position: fixed; inset: 10px; background: white; padding: 20px; }
      .skin { min-height: 700px; background-image: url('/tests/fixtures/ad-skin.svg'); }
      .banner { width: 300px; min-height: 250px; }
    </style>
    <div id="skin" class="skin advertisement" title="Paid game advertisement">
      <main id="article"><h1>News article</h1><p>Keep this reporting visible.</p>
        <form><input value="PRIVATE_INPUT_SECRET"></form>
        <div id="banner" class="banner"><span>Anzeige</span>
          <img width="300" height="200" alt="Student apartments advertisement"></div>
      </main>
    </div>
    <div id="consent" class="overlay" role="dialog" aria-modal="true">
      <iframe title="SP Consent Message" src="about:blank" width="500" height="300"></iframe>
    </div>
    <div id="second" class="overlay" role="dialog">
      <p>We use cookies and tracking. Choose whether to agree or subscribe.</p>
      <button id="agree">Agree</button><button>Settings</button>
    </div>`;
}

function checkWrapperBackground(store: Readonly<PresentationStore>): string {
  const skin = candidate('skin');
  assert(skin.kind === 'background', 'Page skin must be a background-only candidate');
  assert(!JSON.stringify(skin).includes('PRIVATE_INPUT_SECRET'), 'Background must not read forms');
  assert(skin.text === '', 'Background must not classify article text');
  assert(hide(store, 'skin'), 'Background should hide after a matching decision');
  assert(getComputedStyle(element('skin')).backgroundImage === 'none', 'Skin image must hide');
  assert(getComputedStyle(element('article')).display !== 'none', 'Article must remain visible');
  assert(element('article').getBoundingClientRect().height > 0, 'Article must retain its layout');
  store.queueChanges([element('article')]);
  assert(store.restoreNext()?.restored === false, 'Article edits must not restore the skin');
  assert(store.restore(element('skin')), 'Background removal must be reversible');
  assert(getComputedStyle(element('skin')).backgroundImage !== 'none', 'Skin must return');
  return 'Page backgrounds hide independently of article content and restore';
}

function checkDisplayBanner(store: Readonly<PresentationStore>): string {
  const display = candidate('banner');
  assert(display.kind === undefined, 'Display banners must retain ordinary handling');
  assert(display.labels.includes('advertisement'), 'Anzeige label must be detected');
  assert(hide(store, 'banner'), 'Display banner should hide');
  assert(getComputedStyle(element('banner')).display === 'none', 'Entire banner must hide');
  store.restoreAll();
  return 'Image banners with German advertising labels remain supported';
}

function checkConsentScroll(store: Readonly<PresentationStore>): string {
  document.body.style.setProperty('overflow', 'hidden', 'important');
  document.documentElement.style.overflowY = 'clip';
  const bodyBefore = document.body.style.cssText;
  const rootBefore = document.documentElement.style.cssText;
  let clicks = 0;
  element('agree').addEventListener('click', () => {
    clicks++;
  });
  assert(candidate('consent').kind === 'consent', 'Consent iframe wrapper must be identified');
  assert(hide(store, 'consent'), 'Consent wrapper should hide');
  assert(getComputedStyle(element('consent')).display === 'none', 'Whole dialog must hide');
  assert(getComputedStyle(document.body).overflowY === 'auto', 'Body scroll must unlock');
  assert(
    getComputedStyle(document.documentElement).overflowY === 'auto',
    'Root scroll must unlock',
  );
  assert(hide(store, 'second'), 'Second consent overlay should hide');
  store.restore(element('consent'));
  assert(
    getComputedStyle(document.body).overflowY === 'auto',
    'Keep scroll unlocked for remaining overlay',
  );
  store.restoreAll();
  assert(document.body.style.cssText === bodyBefore, 'Original inline scroll lock must return');
  assert(document.documentElement.style.cssText === rootBefore, 'Original root styles must return');
  assert(clicks === 0, 'Hiding must not choose consent');
  return 'Consent wrappers and scroll locks restore without clicking consent controls';
}

function checkDebugConsent(store: Readonly<PresentationStore>): string {
  const bodyBefore = document.body.style.cssText;
  assert(!hide(store, 'consent', true), 'Debug mode must not hide');
  assert(getComputedStyle(element('consent')).display !== 'none', 'Debug dialog remains visible');
  assert(document.body.style.cssText === bodyBefore, 'Debug mode must not unlock scrolling');
  store.restoreAll();
  assert(element('consent').style.outline === '', 'Debug outline must restore');
  return 'Debug mode leaves consent and scrolling unchanged';
}

function checkConsentPrivacy(): string {
  assert(
    extractCandidate(element('agree'), 'agree', 'news.example.org') === null,
    'Dialog descendants must not be independently hidden',
  );
  element('second').insertAdjacentHTML('beforeend', '<input value="PRIVATE_CONSENT_SECRET">');
  assert(
    extractCandidate(element('second'), 'second', 'news.example.org') === null,
    'Consent settings containing inputs must remain private',
  );
  element('second').querySelector('input')?.remove();
  return 'Consent forms stay private and dialog controls are not classified separately';
}

function checkLongConsent(store: Readonly<PresentationStore>): string {
  const paragraph = document.createElement('p');
  paragraph.textContent = 'We use cookies. '.repeat(80) + 'person@example.org token=PRIVATE_TOKEN';
  element('second').append(paragraph);
  const longConsent = candidate('second');
  assert(longConsent.text.length <= 400, 'Long consent text must remain bounded');
  assert(!JSON.stringify(longConsent).includes('PRIVATE_TOKEN'), 'Credentials must not leak');
  assert(hide(store, 'second'), 'Long consent overlay should hide');
  element('second').insertAdjacentHTML('beforeend', '<input value="NEW_PRIVATE_FIELD">');
  store.queueChanges([element('second')]);
  assert(
    store.restoreNext()?.restored === true,
    'A reused dialog with private fields must restore',
  );
  return 'Long consent copy is bounded and reused dialogs restore';
}

function checkPageOwnedStyles(store: Readonly<PresentationStore>): string {
  const before = candidateFingerprint(candidate('skin'));
  const variant = { ...candidate('skin') };
  delete variant.kind;
  assert(
    candidateFingerprint(variant) !== before,
    'Background and element decisions must not share cache keys',
  );
  assert(hide(store, 'skin'), 'Skin should hide again');
  element('skin').style.setProperty('background-image', 'linear-gradient(red, blue)', 'important');
  store.queueChanges([element('skin')]);
  assert(
    store.restoreNext()?.restored === true,
    'Page-owned replacement must invalidate the presentation',
  );
  assert(
    element('skin').style.backgroundImage.includes('linear-gradient'),
    'Restore must preserve page-owned changes',
  );
  return 'Cache keys separate targets and restoration preserves newer page styles';
}

function checkBodyBackground(store: Readonly<PresentationStore>): string {
  const before = document.body.style.cssText;
  document.body.style.backgroundImage =
    "url('/tests/fixtures/ad-skin.svg?token=PRIVATE_BACKGROUND_TOKEN')";
  try {
    const value = extractCandidate(document.body, 'body', 'news.example.org');
    assert(value?.kind === 'background', 'Body artwork must be a background candidate');
    assert(value.text === '', 'Body candidate must not collect descendant text');
    assert(
      !JSON.stringify(value).includes('PRIVATE_'),
      'Body candidate must not leak URL queries or inputs',
    );
    assert(store.apply(document.body, 0.99, 0.9, false, value.kind), 'Body background should hide');
    assert(getComputedStyle(document.body).backgroundImage === 'none', 'Body artwork must hide');
    assert(
      element('article').getBoundingClientRect().height > 0,
      'Body content must retain its layout',
    );
    assert(store.restore(document.body), 'Body artwork must restore');
    assert(
      document.body.style.backgroundImage.includes('ad-skin.svg'),
      'Original body artwork must return',
    );
  } finally {
    store.restoreAll();
    document.body.style.cssText = before;
  }
  return 'Body backgrounds hide and restore without collecting or hiding page content';
}

function checkSelection(): string {
  const selection = document.getSelection();
  assert(selection !== null, 'Fixture needs browser selection support');
  const range = document.createRange();
  range.selectNodeContents(element('second'));
  selection.addRange(range);
  try {
    assert(
      extractCandidate(element('second'), 'second', 'news.example.org') === null,
      'Selected consent text must remain visible',
    );
  } finally {
    selection.removeAllRanges();
  }
  return 'Selected consent text remains visible';
}

export async function runRegionChecks(): Promise<readonly string[]> {
  createFixtures();
  const store = new PresentationStore();
  try {
    return [
      checkQueueOverlap(),
      await checkDynamicMutations(),
      checkWrapperBackground(store),
      checkBodyBackground(store),
      checkDisplayBanner(store),
      checkConsentScroll(store),
      checkDebugConsent(store),
      checkSelection(),
      checkConsentPrivacy(),
      checkLongConsent(store),
      checkPageOwnedStyles(store),
    ];
  } finally {
    store.restoreAll();
    document.body.style.removeProperty('overflow');
    document.documentElement.style.removeProperty('overflow-y');
  }
}
