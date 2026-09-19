import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { PageSession } from '../lib/runtime/page-session';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  allFrames: true,
  main(context: Readonly<Pick<ContentScriptContext, 'onInvalidated'>>) {
    const session = new PageSession();
    session.start();
    context.onInvalidated(() => {
      session.stop();
    });
  },
});
