import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

const output = process.env['WXT_TEST_OUTPUT'] ?? '.output';

it.each([
  ['chrome', 'background.service_worker', 'background.scripts'],
  ['firefox', 'background.scripts', 'background.service_worker'],
])('%s keeps page-load and network-blocking boundaries', async (browser, background, absent) => {
  const manifest: unknown = JSON.parse(
    await readFile(new URL(`../${output}/${browser}-mv3/manifest.json`, import.meta.url), 'utf8'),
  );

  expect(manifest).toMatchObject({
    name: 'TidyUp',
    manifest_version: 3,
    content_scripts: [expect.objectContaining({ run_at: 'document_idle' })],
  });
  expect(manifest).not.toHaveProperty('declarative_net_request');
  expect(manifest).not.toHaveProperty('permissions', expect.arrayContaining(['webRequest']));
  expect(manifest).not.toHaveProperty(
    'permissions',
    expect.arrayContaining(['webRequestBlocking']),
  );
  expect(manifest).not.toHaveProperty(
    'permissions',
    expect.arrayContaining(['declarativeNetRequest']),
  );

  expect(manifest).toHaveProperty(background);
  expect(manifest).not.toHaveProperty(absent);
});
