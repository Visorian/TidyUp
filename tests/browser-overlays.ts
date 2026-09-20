import type { PresentationStore } from '../lib/blocking/hide';
import { extractCandidate } from '../lib/candidates/extract';
import { assert, candidate, element } from './browser-support';

function hide(store: Readonly<PresentationStore>, id: string, debug = false): boolean {
  return store.apply(element(id), 0.99, 0.9, debug, candidate(id).kind);
}

export function checkConsentScroll(store: Readonly<PresentationStore>): string {
  document.body.style.setProperty('overflow', 'hidden', 'important');
  document.documentElement.style.overflowY = 'clip';
  const bodyBefore = document.body.style.cssText;
  const rootBefore = document.documentElement.style.cssText;
  let clicks = 0;
  element('agree').addEventListener('click', () => {
    clicks++;
  });
  assert(candidate('consent').kind === 'overlay', 'Consent iframe wrapper must be identified');
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

export function checkNotificationPrompt(store: Readonly<PresentationStore>): string {
  const prompt = candidate('notify');
  assert(prompt.kind === 'overlay', 'Notification prompts must be summarized as one overlay');
  assert(prompt.labels.includes('modal dialog'), 'Modal dialogs must be labelled for rules');
  assert(!prompt.labels.includes('consent overlay'), 'Consent wording must stay its own signal');
  assert(prompt.text.includes('Benachrichtigungen'), 'Prompt copy must reach the classifier');
  assert(
    extractCandidate(element('allow'), 'allow', 'news.example.org') === null,
    'Prompt controls must not be classified separately',
  );
  assert(hide(store, 'notify'), 'A matching rule should hide the prompt');
  assert(getComputedStyle(element('notify')).display === 'none', 'Whole prompt must hide');
  store.restoreAll();
  return 'Notification permission prompts reach user rules without consent wording';
}

export function checkPrivacyCenterWording(): string {
  const frame = element('consent').querySelector('iframe');
  assert(frame !== null, 'Consent fixture needs its frame');
  const title = frame.getAttribute('title') ?? '';
  frame.setAttribute('title', 'Privacy Center');
  try {
    assert(
      candidate('consent').labels.includes('consent overlay'),
      'A privacy centre overlay must carry consent evidence',
    );
  } finally {
    frame.setAttribute('title', title);
  }
  return 'Privacy wording marks an overlay as consent evidence';
}

export function checkDebugConsent(store: Readonly<PresentationStore>): string {
  const bodyBefore = document.body.style.cssText;
  assert(!hide(store, 'consent', true), 'Debug mode must not hide');
  assert(getComputedStyle(element('consent')).display !== 'none', 'Debug dialog remains visible');
  assert(document.body.style.cssText === bodyBefore, 'Debug mode must not unlock scrolling');
  store.restoreAll();
  assert(element('consent').style.outline === '', 'Debug outline must restore');
  return 'Debug mode leaves consent and scrolling unchanged';
}

export function checkConsentPrivacy(): string {
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

export function checkLongConsent(store: Readonly<PresentationStore>): string {
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

export function checkFrozenPageScroll(store: Readonly<PresentationStore>): string {
  const body = document.body;
  const before = body.style.cssText;
  body.style.setProperty('min-height', '4000px');
  body.style.setProperty('position', 'fixed', 'important');
  body.style.setProperty('top', '-320px', 'important');
  try {
    assert(hide(store, 'consent'), 'Consent overlay should hide');
    assert(getComputedStyle(body).position === 'static', 'A frozen page must scroll again');
    assert(Math.round(window.scrollY) === 320, 'Unlocking must keep the reading position');
    store.restoreAll();
    assert(getComputedStyle(body).position === 'fixed', 'Revealing returns the page freeze');
  } finally {
    store.restoreAll();
    body.style.cssText = before;
    window.scrollTo(0, 0);
  }
  return 'Pages frozen out of flow scroll again once their overlay is hidden';
}
