import { defineConfig } from 'wxt';
import type { ConfigEnv } from 'wxt';

export default defineConfig({
  imports: false,
  manifestVersion: 3,
  zip: { excludeSources: ['web-ext.config.ts'] },
  manifest: ({ browser }: Readonly<ConfigEnv>) => ({
    name: 'TidyUp',
    description: 'Tidy web pages with your own plain-language rules.',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['https://api.typesafe.ai/*', 'https://openrouter.ai/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'tidyup@extensions.local',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['websiteContent', 'browsingActivity'] },
            },
          },
        }
      : {}),
  }),
});
