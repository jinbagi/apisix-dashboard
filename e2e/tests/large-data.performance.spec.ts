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
import { expect, type Page, test, type TestInfo } from '@playwright/test';

const records = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `route-${String(index).padStart(5, '0')}`, name: `Route ${String(index).padStart(5, '0')}`,
  uri: `/route-${index}`, upstream_id: 'origin', create_time: 1, update_time: 1,
}));
const headers = Object.fromEntries(Array.from({ length: 4000 }, (_, index) => [`x-benchmark-${index}`, 'value'.repeat(20)]));
async function fixtures(page: Page, rows = records(5000), large = false) {
  const writes: string[] = [];
  const data: Record<string, Record<string, unknown>[]> = {
    routes: rows, upstreams: [{ id: 'origin', nodes: { 'example.test:80': 1 } }],
    global_rules: [{ id: 'broken-global', plugins: { 'grpc-transcode': { proto_id: 'missing-proto' } } }],
  };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const url = new URL(route.request().url());
    const [kind, id] = url.pathname.replace('/apisix/admin/', '').split('/');
    if (route.request().method() !== 'GET') writes.push(route.request().method());
    if (kind === 'plugins') return route.fulfill({ json: id === 'list' ? [] : {} });
    const values = data[kind] ?? [];
    if (id) {
      const found = values.find((value) => value.id === id);
      return route.fulfill({ json: { value: found && large && kind === 'routes' ? { ...found, plugins: { 'response-rewrite': { headers } } } : found } });
    }
    const size = Number(url.searchParams.get('page_size') ?? 100);
    const start = (Number(url.searchParams.get('page') ?? 1) - 1) * size;
    return route.fulfill({ json: { list: values.slice(start, start + size).map((value) => ({ value })), total: values.length } });
  });
  return writes;
}
async function record(info: TestInfo, metrics: Record<string, unknown>) {
  await info.attach('large-data-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  console.log('LARGE_DATA_METRICS ' + JSON.stringify(metrics));
}
async function heap(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  await session.send('HeapProfiler.collectGarbage');
  const { metrics } = await session.send('Performance.getMetrics');
  const counters = await session.send('Memory.getDOMCounters');
  await session.detach();
  return { heapMiB: Math.round((metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576 * 10) / 10, nodes: counters.nodes, editors: await page.locator('.monaco-editor').count() };
}

test('large data profile: 5000 routes remain paginated and searchable', async ({ page }, info) => {
  const writes = await fixtures(page);
  const started = Date.now();
  await page.goto('routes');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toHaveCount(10);
  const loadMs = Date.now() - started;
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  const searching = Date.now();
  await search.fill('Route 04999'); await search.press('Enter');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Route 04999', exact: true })).toBeVisible();
  await record(info, { scenario: '5000 routes', loadMs, searchMs: Date.now() - searching, ...await heap(page) });
  expect(writes).toEqual([]);
});

test('large data profile: half-megabyte JSON editing and review preserve its draft', async ({ page }, info) => {
  test.setTimeout(120000);
  const writes = await fixtures(page, records(1), true);
  await page.goto('routes');
  const started = Date.now();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Route: Route 00000' });
  await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue().length ?? 0)).toBeGreaterThan(450000);
  const openMs = Date.now() - started;
  const edit = await page.evaluate(async () => {
    const editor = window.__monacoEditor__!;
    const parsed = JSON.parse(editor.getValue()); parsed.desc = 'Measured edit';
    const next = JSON.stringify(parsed, null, 2);
    const start = performance.now(); editor.setValue(next);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { editMs: performance.now() - start, bytes: new TextEncoder().encode(next).length };
  });
  const reviewing = Date.now();
  await drawer.getByRole('button', { name: 'Review changes', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review Changes Before Saving' });
  await expect(review.locator('.monaco-diff-editor')).toBeVisible();
  const reviewMs = Date.now() - reviewing;
  await review.getByRole('button', { name: 'Keep editing', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(window.__monacoEditor__!.getValue()).desc)).toBe('Measured edit');
  await record(info, { scenario: 'large JSON', openMs, ...edit, reviewMs, ...await heap(page) });
  expect(writes).toEqual([]);
});

test('large data profile: 20 RAW tabs retain drafts and release editor resources on close', async ({ page }, info) => {
  test.setTimeout(180000);
  const writes = await fixtures(page, records(20), true);
  await page.goto('routes?page_size=20');
  await expect(page.getByRole('button', { name: 'Raw', exact: true })).toHaveCount(20);
  const before = await heap(page);
  const started = Date.now();
  for (let index = 0; index < 20; index++) {
    await page.getByRole('button', { name: 'Raw', exact: true }).nth(index).click();
    await expect.poll(() => page.evaluate(() => window.__monacoEditor__?.getValue().length ?? 0)).toBeGreaterThan(450000);
    await page.evaluate((index) => {
      const editor = window.__monacoEditor__!; const parsed = JSON.parse(editor.getValue()); parsed.desc = `Draft ${index}`; editor.setValue(JSON.stringify(parsed, null, 2));
    }, index);
    await page.getByRole('button', { name: 'Minimize', exact: true }).click();
  }
  const openAllMs = Date.now() - started;
  await page.getByRole('button', { name: 'Open RAW workspace (20 tabs, 20 unsaved)', exact: true }).click();
  const switching = Date.now();
  await page.getByRole('tab', { name: 'Route: Route 00000 Unsaved changes', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(window.__monacoEditor__!.getValue()).desc)).toBe('Draft 0');
  const switchMs = Date.now() - switching;
  const opened = await heap(page);
  expect(opened.editors).toBe(1);
  await page.getByRole('button', { name: 'Close all', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  await record(info, { scenario: '20 large RAW tabs', openAllMs, switchMs, before, opened, closed: await heap(page) });
  expect(writes).toEqual([]);
});

test('large data profile: Global Rule diagnostics reach repair with 5000 affected routes', async ({ page }, info) => {
  test.setTimeout(120000);
  const writes = await fixtures(page);
  await page.goto('dashboard');
  const started = Date.now();
  await page.getByRole('button', { name: 'Check references', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Configuration reference diagnostics', exact: true });
  await expect(dialog.getByRole('status')).toHaveText('1 reference issue(s) / 0 unavailable collection(s)');
  const renderedMs = Date.now() - started;
  const row = dialog.getByRole('row').filter({ hasText: '/global_rules/broken-global' });
  const rowHeight = (await row.boundingBox())!.height;
  expect(rowHeight).toBeLessThan(200);
  await expect(row.getByRole('button', { name: 'Open source RAW', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('global-rule-impact-5000.png'), animations: 'disabled' });
  await row.getByRole('button', { name: 'View affected routes', exact: true }).click();
  const affected = page.getByRole('dialog', { name: 'Potentially affected routes', exact: true });
  await expect(affected.getByRole('link')).toHaveCount(10);
  await affected.getByTitle('Next Page', { exact: true }).click();
  await expect(affected.getByRole('link', { name: '/routes/route-00010', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await affected.getByRole('searchbox', { name: 'Filter affected routes', exact: true }).fill('route-04999');
  await expect(affected.getByRole('link')).toHaveCount(1);
  await expect(affected.getByRole('link')).toHaveAttribute('href', '/ui/routes/detail/route-04999');
  await expect(affected.getByRole('button', { name: 'Close affected routes', exact: true })).toBeInViewport({ ratio: 1 });
  expect(await affected.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('affected-routes-narrow.png'), animations: 'disabled' });
  await affected.getByRole('button', { name: 'Close affected routes', exact: true }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });
  await dialog.getByRole('button', { name: 'Open source RAW', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Repair reference: /global_rules/broken-global' })).toBeVisible();
  await record(info, { scenario: 'Global Rule with 5000 routes', renderedMs, rowHeight, ...await heap(page) });
  expect(writes).toEqual([]);
});