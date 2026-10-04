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
import { expect, type Page, test } from '@playwright/test';

import { compareConfigurationSnapshots, parseConfigurationSnapshot, snapshotComparisonReport, snapshotJson } from '@/utils/snapshotComparison';

const snapshot = (resources: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ version: 3, exportedAt: '2026-10-04T00:00:00Z', resources, ...extra });
const parse = (resources: Record<string, unknown>, extra: Record<string, unknown> = {}) => parseConfigurationSnapshot(JSON.stringify(snapshot(resources, extra)), 'fixture.json');

test('comparison ignores object order and only top-level system noise while preserving array order and unknown data', () => {
  const before = parse({ routes: [{ id: 7, create_time: 1, update_time: 2, manager: 'unknown-keep', methods: ['GET', 'POST'], future: { update_time: 1, a: 1, b: 2 } }] });
  const after = parse({ routes: [{ future: { b: 2, a: 1, update_time: 1 }, methods: ['GET', 'POST'], manager: 'unknown-keep', update_time: 9, id: '7' }] });
  expect(compareConfigurationSnapshots(before, after).counts.Unchanged).toBe(1);
  const changed = compareConfigurationSnapshots(before, parse({ routes: [{ id: 7, manager: 'changed', methods: ['POST', 'GET'], future: { update_time: 2, a: 1, b: 2 } }] }));
  expect(changed.items[0].paths).toEqual(['/future/update_time', '/manager', '/methods']);
  expect(changed.counts.Changed).toBe(1);
});

test('canonical resource URLs separate Consumers, Secret managers, and same-named children', () => {
  const before = parse({
    consumers: [{ username: 'alice' }], secrets: [{ id: 'vault/main', token: 'fixture' }, { manager: 'aws', id: 'main', token: 'fixture' }],
    credentials: [{ username: 'alice', id: 'alice/credentials/main', plugins: {} }, { username: 'bob', id: 'main', plugins: {} }],
    graphqlCostDecorations: [{ id: 'cost', service_id: 'one', field_path: 'Query.users' }, { id: 'cost', service_id: 'two', field_path: 'Query.users' }],
  });
  const after = parse({
    consumers: [{ username: 'alice' }], secrets: [{ manager: 'vault', id: 'main', token: 'fixture' }, { manager: 'aws', id: 'main', token: 'fixture' }],
    credentials: [{ username: 'alice', id: 'main', plugins: {} }, { username: 'bob', id: 'main', plugins: {} }],
    graphqlCostDecorations: [{ id: 'cost', service_id: 'one', field_path: 'Query.users' }, { id: 'cost', service_id: 'two', field_path: 'Query.users' }],
  });
  const result = compareConfigurationSnapshots(before, after);
  expect(result.counts.Unchanged).toBe(7);
  expect(result.items.map((row) => row.url)).toEqual(['/consumers/alice', '/consumers/alice/credentials/main', '/consumers/bob/credentials/main', '/secrets/aws/main', '/secrets/vault/main', '/services/one/graphql_cost_decorations/cost', '/services/two/graphql_cost_decorations/cost']);
});

test('omitted and skipped collections never imply resource removal, while explicit empty arrays do', () => {
  const before = parse({ routes: [{ id: 'one' }], services: [{ id: 'two' }] });
  expect(compareConfigurationSnapshots(before, parse({})).counts['Not comparable']).toBe(2);
  const empty = compareConfigurationSnapshots(before, parse({ routes: [] }));
  expect(empty.counts.Removed).toBe(1); expect(empty.counts['Not comparable']).toBe(1);
  expect(compareConfigurationSnapshots(before, parse({ routes: [] }, { skippedResources: ['routes'] })).counts.Removed).toBe(0);
  const partial = compareConfigurationSnapshots(before, parse({ routes: [{ id: 'one', desc: 'Changed' }], services: [] }, { skippedResources: ['Follows selected dependencies only'] }));
  expect(partial.counts.Changed).toBe(1); expect(partial.counts['Not comparable']).toBe(1);
  expect(compareConfigurationSnapshots(parse({}), before).counts.Added).toBe(0);
  expect(compareConfigurationSnapshots(parse({ routes: [] }), before).counts.Added).toBe(1);
});

test('invalid snapshot structure, versions, duplicate destinations and missing owners are rejected', () => {
  for (const data of [null, {}, snapshot({}, { version: 0 }), snapshot({}, { version: 4 }), snapshot({ routes: {} }), snapshot({ alien: [] }), snapshot({}, { skippedResources: 'routes' }), snapshot({}, { exportedAt: 'bad' })]) {
    expect(() => parseConfigurationSnapshot(JSON.stringify(data), 'bad.json')).toThrow();
  }
  for (const resources of [{ routes: [{}] }, { consumers: [{ id: 'missing-username' }] }, { credentials: [{ id: 'main' }] }, { credentials: [{ id: 'bob/credentials/main', username: 'alice' }] }, { secrets: [{ id: 'one' }] }, { secrets: [{ manager: 'vault', id: 'aws/one' }] }, { graphqlCostDecorations: [{ id: 'cost' }] }, { routes: [{ id: 7 }, { id: '7' }] }]) {
    expect(() => parse(resources)).toThrow();
  }
  expect(() => parse({ routes: [{ id: ['7'] }] })).toThrow();
  expect(() => parseConfigurationSnapshot('{', 'bad.json')).toThrow();
  expect(() => parse({}, { version: 1 })).not.toThrow();
});

test('prototype-like keys and JSON Pointer escaping survive normalization and report export', () => {
  const before = parseConfigurationSnapshot('{"version":3,"resources":{"routes":[{"id":"__proto__","__proto__":{"constructor":1},"a/b~c":{"v":1}}]}}', 'before.json');
  const after = parseConfigurationSnapshot('{"version":3,"resources":{"routes":[{"id":"__proto__","__proto__":{"constructor":2},"a/b~c":{"v":2}}]}}', 'after.json');
  const report = snapshotComparisonReport(before, after);
  expect(report.items[0].paths).toEqual(['/__proto__/constructor', '/a~1b~0c/v']);
  const restored = JSON.parse(JSON.stringify(snapshotJson(report.items[0].after)));
  expect(Object.hasOwn(restored, '__proto__')).toBe(true);
  expect(restored.__proto__.constructor).toBe(2);
  expect(Object.prototype).not.toHaveProperty('v');
});

test('large snapshots compare every resource and cap excessive nesting with a useful error', () => {
  const values = Array.from({ length: 2500 }, (_, index) => ({ id: String(index), uri: `/${index}`, plugins: { future: { values: [1, 2, 3] } } }));
  const before = parse({ routes: values });
  const after = parse({ routes: values.slice(1).map((value) => value.id === '2499' ? { ...value, uri: '/changed' } : value) });
  const result = compareConfigurationSnapshots(before, after);
  expect(result.items).toHaveLength(2500);
  expect(result.counts).toMatchObject({ Removed: 1, Changed: 1, Unchanged: 2498 });
  let nested: unknown = 1; for (let index = 0; index < 110; index++) nested = { value: nested };
  expect(() => parse({ routes: [{ id: 'deep', nested }] })).toThrow('Snapshot nesting exceeds 100 levels.');
});

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Compare configuration snapshots', exact: true });
async function setup(page: Page) {
  const requests: string[] = [];
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', (route) => { requests.push(route.request().method()); return route.fulfill({ json: { list: [], total: 0 } }); });
  await page.goto('export_import');
  await page.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
  return requests;
}
async function upload(page: Page, side: number, data: unknown, name = 'fixture.json') {
  await dialog(page).locator('input[type="file"]').nth(side).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}
const beforeFixture = snapshot({ routes: [{ id: 'removed', uri: '/removed' }, { id: 'changed', methods: ['GET'], future: { keep: 'old' } }, { id: 'same', uri: '/same' }], services: [{ id: 'unverified' }], consumers: [] });
const afterFixture = snapshot({ routes: [{ id: 'added', uri: '/added' }, { id: 'changed', methods: ['POST'], future: { keep: 'new' } }, { id: 'same', uri: '/same' }], consumers: [] });

test('local comparison supports filters, JSON review and a complete downloadable report without API writes', async ({ page }) => {
  const requests = await setup(page); const baseline = requests.length;
  await upload(page, 0, beforeFixture, 'before.json'); await upload(page, 1, afterFixture, 'after.json');
  for (const text of ['Added: 1', 'Removed: 1', 'Changed: 1', 'Unchanged: 1', 'Not comparable: 1']) await expect(dialog(page).getByText(text, { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('4 matching resources', { exact: false })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('snapshot-comparison.png'), animations: 'disabled' });
  await dialog(page).getByRole('textbox', { name: 'Search snapshot differences' }).fill('future');
  await expect(dialog(page).getByText('1 matching resources', { exact: false })).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Review snapshot /routes/changed' }).click();
  const review = page.getByRole('dialog', { name: 'Snapshot JSON comparison', exact: true });
  await expect(review.getByText(/Changed paths: \/future\/keep, \/methods/)).toBeVisible();
  await review.getByRole('button', { name: 'Back to snapshot comparison' }).click();
  await dialog(page).getByRole('textbox', { name: 'Search snapshot differences' }).fill('');
  await dialog(page).getByRole('combobox', { name: 'Filter snapshot status' }).click();
  await page.getByRole('option', { name: 'Not comparable', exact: true }).click();
  await expect(dialog(page).getByText('1 matching resources', { exact: false })).toBeVisible();
  await dialog(page).getByRole('combobox', { name: 'Filter snapshot resource' }).click();
  await page.getByRole('option', { name: 'Routes', exact: true }).click();
  await expect(dialog(page).getByText('No resources match these filters.')).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Download comparison report' }).click();
  const downloadModal = page.getByRole('dialog', { name: 'Download snapshot report', exact: true });
  await expect(downloadModal.getByText(/including any credentials or private keys/)).toBeVisible();
  const download = page.waitForEvent('download');
  await downloadModal.getByRole('button', { name: 'Download JSON report' }).click();
  const stream = await (await download).createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(report.items).toHaveLength(5); expect(report.before.name).toBe('before.json'); expect(report.items.find((row: { url: string }) => row.url === '/routes/changed').paths).toEqual(['/future/keep', '/methods']);
  expect(requests.slice(baseline)).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Close comparison' }).click();
  await page.getByRole('button', { name: 'Compare snapshots', exact: true }).click();
  await expect(dialog(page)).not.toContainText('before.json');
  await expect(dialog(page).getByRole('button', { name: 'Download comparison report' })).toBeDisabled();
});

test('invalid replacement files clear stale comparison results and can be repaired', async ({ page }) => {
  await setup(page); await upload(page, 0, beforeFixture); await upload(page, 1, afterFixture);
  await expect(dialog(page).getByText('Changed: 1', { exact: true })).toBeVisible();
  await upload(page, 1, snapshot({ routes: [{ id: 'duplicate' }, { id: 'duplicate' }] }), 'invalid.json');
  await expect(dialog(page).getByRole('alert')).toContainText('Duplicate destination /routes/duplicate');
  await expect(dialog(page).getByRole('button', { name: 'Download comparison report' })).toBeDisabled();
  await expect(dialog(page).getByText('Changed: 1', { exact: true })).toHaveCount(0);
  await upload(page, 1, afterFixture, 'repaired.json');
  await expect(dialog(page).getByText('Changed: 1', { exact: true })).toBeVisible();
});

test('narrow comparison keeps keyboard filters, resource review and close action in reach', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await upload(page, 0, beforeFixture); await upload(page, 1, afterFixture);
  const search = dialog(page).getByRole('textbox', { name: 'Search snapshot differences' });
  await search.focus(); await search.pressSequentially('changed');
  await expect(dialog(page).getByRole('button', { name: 'Review snapshot /routes/changed' })).toBeVisible();
  await search.press('Tab');
  await expect(dialog(page).getByRole('button', { name: 'close-circle', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog(page).getByRole('combobox', { name: 'Filter snapshot status' })).toBeFocused();
  await dialog(page).getByRole('button', { name: 'Review snapshot /routes/changed' }).scrollIntoViewIfNeeded();
  const bounds = await dialog(page).boundingBox(); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const close = dialog(page).getByRole('button', { name: 'Close comparison' });
  await expect(close).toBeInViewport({ ratio: 1 });
  const closeBounds = await close.boundingBox(); expect(closeBounds!.y + closeBounds!.height).toBeLessThanOrEqual(820);
  await page.screenshot({ path: test.info().outputPath('snapshot-comparison-narrow.png'), animations: 'disabled' });
});


test('a delayed file read cannot replace a newer snapshot selection', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      const content = original.call(this);
      if (this.name !== 'slow.json') return content;
      return new Promise<string>((resolve) => {
        (window as typeof window & { releaseSnapshotRead?: () => void }).releaseSnapshotRead = () => { void content.then(resolve); };
      });
    };
  });
  await upload(page, 0, beforeFixture);
  await upload(page, 1, snapshot({ routes: [] }), 'slow.json');
  await upload(page, 1, afterFixture, 'latest.json');
  await expect(dialog(page).getByText('Changed: 1', { exact: true })).toBeVisible();
  await page.evaluate(() => (window as typeof window & { releaseSnapshotRead?: () => void }).releaseSnapshotRead?.());
  await expect(dialog(page).getByText('latest.json', { exact: true })).toBeVisible();
  await expect(dialog(page).getByText('Removed: 1', { exact: true })).toBeVisible();
});
