/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { readFile } from 'node:fs/promises';

import { expect, type Page, test } from '@playwright/test';

import { mapImportEnvironment } from '@/apis/environment-import';
import { buildConfigValidationPayload, type ExportData, importResources, validateConfiguration } from '@/apis/export-import';
import { previewImport } from '@/apis/import-preview';
import { assertRestorableExport, SHARING_IMPORT_ERROR, SHARING_MARKER } from '@/utils/sharingFormat';
import { findSharingCandidates, parseSharingExport, REDACTED_VALUE, redactSharingExport, SHARING_MAX_BYTES } from '@/utils/sharingRedaction';

const fixture = () => ({ version: 3, exportedAt: '2026-10-04T00:00:00Z', skippedResources: [], resources: {
  routes: [{ id: 'sharing-route', uri: '/example', plugins: { 'key-auth': { key: 'fake-key-value' }, 'proxy-rewrite': { headers: { set: { Authorization: 'fake-bearer-value', 'x-company-token': 'fake-company-value' } } } }, extra: { retained: [3, 1, 2] } }],
  consumers: [{ username: 'fixture-user', plugins: { 'basic-auth': { username: 'fixture-user', password: 'fake-password-value' } } }],
  ssls: [{ id: 'fixture-tls', cert: 'public-fixture-certificate', key: 'fake-private-key', keys: ['fake-private-array'] }],
  secrets: [{ id: 'vault-fixture', manager: 'vault', token: 'fake-vault-token', uri: 'https://example.invalid' }],
} });
const parse = () => parseSharingExport(JSON.stringify(fixture()));

test('redacts conservative known secrets without mutating the original or losing unknown JSON and array order', () => {
  const data = parse(); const original = JSON.stringify(data);
  const candidates = findSharingCandidates(data);
  expect(candidates).toHaveLength(6);
  expect(candidates.every((candidate) => !JSON.stringify(candidate).includes('fake-'))).toBe(true);
  const output = redactSharingExport(data, candidates.map((candidate) => candidate.path));
  const text = JSON.stringify(output);
  expect(text).not.toContain('fake-key-value'); expect(text).not.toContain('fake-private-array');
  expect(text).toContain('fake-company-value'); expect(text).toContain('public-fixture-certificate');
  expect(output.resources.routes[0]).toMatchObject({ extra: { retained: [3, 1, 2] } });
  expect(output[SHARING_MARKER]).toMatchObject({ incomplete: true, importable: false, redactedPaths: candidates.map((candidate) => candidate.path).sort() });
  expect(JSON.stringify(data)).toBe(original);
});

test('custom literal keys handle arrays, nested values, empty strings and special own keys without prototype mutation', () => {
  const data = parseSharingExport('{"version":3,"resources":{"routes":[{"id":"special","__proto__":{"password":"fake"},"constructor":{"prototype":{"token":"fake2"}},"a/b~c":[{"secret":"fake3"}],"CUSTOM":"","ordered":[{"token":"fake4"},2]}]}}');
  const candidates = findSharingCandidates(data, 'CUSTOM, __proto__, a/b~c');
  expect(candidates.map((item) => item.path)).toContain('/resources/routes/0/a~1b~0c');
  const output = redactSharingExport(data, candidates.map((candidate) => candidate.path));
  const route = output.resources.routes[0] as Record<string, unknown>;
  expect(Object.hasOwn(route, '__proto__')).toBe(true); expect(route.__proto__).toBe(REDACTED_VALUE);
  expect(route.CUSTOM).toBe(REDACTED_VALUE); expect(route['a/b~c']).toBe(REDACTED_VALUE);
  expect(Object.prototype).not.toHaveProperty('password');
  expect(JSON.stringify(output)).not.toContain('fake');
});

test('invalid files, deep nesting, stale selection and oversized rule lists fail without echoing file values', () => {
  for (const text of ['{private-content', '{}', '{"version":999,"resources":{}}', '{"version":3,"resources":{"routes":["fake-secret"]}}', '{"version":3,"resources":{"other":[]}}', '{"version":3,"resources":{},"skippedResources":false}'])
    expect(() => parseSharingExport(text)).toThrow();
  expect(() => parseSharingExport(' '.repeat(SHARING_MAX_BYTES + 1))).toThrow('10 MiB');
  let value: unknown = 'leaf'; for (let i = 0; i < 105; i++) value = { child: value };
  expect(() => parseSharingExport(JSON.stringify({ version: 3, resources: { routes: [{ id: 'deep', value }] } }))).toThrow('100 levels');
  expect(() => redactSharingExport(parse(), ['/resources/routes/0/no-such-field'])).toThrow('no longer exists');
  expect(() => findSharingCandidates(parse(), 'x'.repeat(201))).toThrow('200 characters');
  for (const version of [1, 2, 3]) expect(parseSharingExport(JSON.stringify({ version, resources: {} })).version).toBe(version);
});

test('all import, mapping, preview and validation entrances reject sharing markers including malformed markers', async () => {
  for (const marker of [undefined, false, null, { incomplete: true, importable: false }]) {
    const data = { ...fixture(), [SHARING_MARKER]: marker } as unknown as ExportData;
    expect(() => assertRestorableExport(data)).toThrow(SHARING_IMPORT_ERROR);
    expect(() => mapImportEnvironment(data, '{}')).toThrow(SHARING_IMPORT_ERROR);
    expect(() => buildConfigValidationPayload(data)).toThrow(SHARING_IMPORT_ERROR);
    await expect(previewImport(data, ['routes'])).rejects.toThrow(SHARING_IMPORT_ERROR);
    await expect(validateConfiguration(data, ['routes'])).rejects.toThrow(SHARING_IMPORT_ERROR);
    await expect(importResources(data, ['routes'])).rejects.toThrow(SHARING_IMPORT_ERROR);
  }
  const emptySelection = redactSharingExport(parse(), []);
  expect(() => assertRestorableExport(emptySelection)).toThrow(SHARING_IMPORT_ERROR);
  expect(() => parseSharingExport(JSON.stringify(emptySelection))).toThrow(SHARING_IMPORT_ERROR);
});

async function setup(page: Page) {
  const requests: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key'));
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } });
  });
  await page.route('**/apisix/admin/**', async (route) => {
    requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ json: new URL(route.request().url()).pathname === '/apisix/admin/plugins' ? {} : { list: [], total: 0 } });
  });
  await page.goto('export_import');
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.getByRole('button', { name: 'Prepare redacted copy', exact: true }).click();
  return requests;
}
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Prepare a sharing copy', exact: true });
async function upload(page: Page, text = JSON.stringify(fixture()), name = 'fixture-export.json') {
  await dialog(page).locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}
const review = (page: Page) => dialog(page).getByRole('checkbox', { name: 'I reviewed the selected fields and remaining content for secrets before sharing.' });

test('local review, custom fields and download copy only reviewed JSON without Admin writes or persistence', async ({ page }) => {
  const requests = await setup(page); const baseline = requests.length;
  await upload(page);
  await expect(dialog(page).getByText('6 of 6 matching fields selected')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Download sharing copy' })).toBeDisabled();
  await dialog(page).getByRole('textbox', { name: 'Custom sensitive field names' }).fill('x-company-token');
  await expect(dialog(page).getByText('7 of 7 matching fields selected')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Preview redacted JSON' }).click();
  const preview = dialog(page).getByLabel('Redacted JSON preview');
  await expect(preview).not.toContainText('fake-company-value'); await expect(preview).not.toContainText('fake-private-key');
  await review(page).check();
  await dialog(page).getByRole('button', { name: 'Copy redacted JSON' }).click();
  const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
  expect(JSON.parse(copied)[SHARING_MARKER].importable).toBe(false);
  expect(copied).not.toContain('fake-');
  const pending = page.waitForEvent('download');
  await dialog(page).getByRole('button', { name: 'Download sharing copy' }).click();
  const downloaded = await pending;
  expect(downloaded.suggestedFilename()).toBe('apisix-redacted-sharing-copy.json');
  expect(await readFile((await downloaded.path())!, 'utf8')).toBe(copied);
  expect(requests).toHaveLength(baseline);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('fake-');
  await dialog(page).getByRole('textbox', { name: 'Custom sensitive field names' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('sharing-redaction.png'), animations: 'disabled' });
  await dialog(page).getByRole('checkbox', { name: 'Redact /resources/routes/0/plugins/key-auth/key', exact: true }).uncheck();
  await expect(review(page)).not.toBeChecked();
  await expect(dialog(page).getByRole('button', { name: 'Copy redacted JSON' })).toBeDisabled();
  await expect(preview).toContainText('fake-key-value');
});

test('invalid replacement clears stale exports and sharing files are blocked by import UI', async ({ page }) => {
  const requests = await setup(page);
  await upload(page); await review(page).check();
  await upload(page, '{private-raw-secret', 'invalid.json');
  await expect(dialog(page).getByRole('alert').filter({ hasText: 'not valid JSON' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Download sharing copy' })).toBeDisabled();
  await expect(dialog(page)).not.toContainText('private-raw-secret');
  await dialog(page).getByRole('button', { name: 'Close sharing preview' }).click();
  await expect(dialog(page)).toHaveCount(0);
  const importInput = page.locator('input[type="file"]');
  await importInput.setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture())) });
  await expect(page.getByRole('button', { name: 'Import Selected Resources', exact: true })).toBeVisible();
  const shared = redactSharingExport(parse(), findSharingCandidates(parse()).map((item) => item.path));
  const baseline = requests.length;
  await importInput.setInputFiles({ name: 'shared.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(shared)) });
  await expect(page.getByRole('alert').filter({ hasText: 'incomplete sharing copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import Selected Resources', exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(baseline);
});

test('clipboard failures keep a reviewed copy recoverable and narrow keyboard controls remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page); await upload(page);
  await review(page).focus(); await page.keyboard.press('Space');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
  await dialog(page).getByRole('button', { name: 'Copy redacted JSON' }).click();
  await expect(dialog(page).getByRole('alert').filter({ hasText: 'Clipboard access failed' })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Dismiss error' }).click();
  const button = dialog(page).getByRole('button', { name: 'Download sharing copy' });
  await expect(button).toBeEnabled(); await expect(button).toBeInViewport();
  expect(await dialog(page).evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(button).toBeInViewport({ ratio: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await review(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('sharing-redaction-narrow.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Prepare redacted copy', exact: true }).click();
  await expect(dialog(page).getByText('fixture-export.json')).toHaveCount(0);
});

test('a slower prior file cannot replace a newer source and closing cancels pending results', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === 'slow.json') await new Promise<void>((resolve) => { (window as unknown as { release: () => void }).release = resolve; });
      return original.call(this);
    };
  });
  await upload(page, JSON.stringify(fixture()), 'slow.json');
  await upload(page, JSON.stringify({ version: 3, resources: { routes: [{ id: 'newest', password: 'fake-newest' }] } }), 'newest.json');
  await expect(dialog(page).getByText('1 of 1 matching fields selected')).toBeVisible();
  await page.evaluate(() => (window as unknown as { release: () => void }).release());
  await expect(dialog(page).getByText('newest.json', { exact: false })).toBeVisible();
  await expect(dialog(page).getByText('6 of 6 matching fields selected')).toHaveCount(0);
  await upload(page, JSON.stringify(fixture()), 'slow.json');
  await dialog(page).getByRole('button', { name: 'Close sharing preview' }).click();
  await page.evaluate(() => (window as unknown as { release: () => void }).release());
  await page.getByRole('button', { name: 'Prepare redacted copy', exact: true }).click();
  await expect(dialog(page).getByText('slow.json', { exact: false })).toHaveCount(0);
});


test('current gateway export reads only after explicit action and partial collection failures stay visible', async ({ page }) => {
  const requests = await setup(page); const baseline = requests.length;
  await expect(dialog(page).getByRole('button', { name: 'Load current configuration' })).toBeVisible();
  expect(requests).toHaveLength(baseline);
  await page.route('**/apisix/admin/routes?**', (route) => route.fulfill({ json: { list: [{ value: { id: 'current-fixture', password: 'fake-current-password' } }], total: 1 } }));
  await page.route('**/apisix/admin/ssls?**', (route) => route.fulfill({ status: 403, json: { error_msg: 'Fixture unavailable' } }));
  await dialog(page).getByRole('button', { name: 'Load current configuration' }).click();
  await expect(dialog(page).getByText('Source: Current gateway export')).toBeVisible();
  await expect(dialog(page).getByText('1 of 1 matching fields selected')).toBeVisible();
  await expect(dialog(page).getByText('The original export has skipped collections. This sharing copy also remains incomplete.')).toBeVisible();
  expect(requests.length).toBeGreaterThan(baseline);
  expect(requests.every((request) => request.startsWith('GET '))).toBe(true);
});


test('a delayed clipboard completion cannot repopulate a closed or replaced sharing session', async ({ page }) => {
  await setup(page); await upload(page); await review(page).check();
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => new Promise<void>((resolve) => { (window as unknown as { finishCopy: () => void }).finishCopy = resolve; }) } }));
  await dialog(page).getByRole('button', { name: 'Copy redacted JSON' }).click();
  await dialog(page).getByRole('button', { name: 'Close sharing preview' }).click();
  await page.getByRole('button', { name: 'Prepare redacted copy', exact: true }).click();
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  await expect(dialog(page).getByRole('status')).toHaveCount(0);
  await expect(dialog(page).getByRole('button', { name: 'Download sharing copy' })).toBeDisabled();
});
