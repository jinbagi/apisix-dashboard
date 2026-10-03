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

import { uiFillMonacoEditor } from '@e2e/utils/ui';
import { expect, type Page, test } from '@playwright/test';

import { parseBulkPatch } from '@/apis/bulk-patch';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Bulk RAW edit', exact: true });
async function setup(page: Page, resource = 'routes') {
  const values: Record<string, Record<string, unknown>> = Object.fromEntries(['first', 'second'].map((id) => [id, {
    id, name: id, uri: `/${id}`, desc: 'Before', labels: { env: 'dev', team: id },
    methods: ['GET', 'POST'], upstream: { nodes: { '127.0.0.1:1980': 1 } },
    nodes: { '127.0.0.1:1980': 1 }, type: 'roundrobin', plugins: {}, server_port: 9000,
    create_time: 1, update_time: 1, future_field: { preserved: true },
  }]));
  const writes: { id: string; body: Record<string, unknown> }[] = [];
  const controls = { readFail: '', writeFail: '', ignoreWrite: '' };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('test-admin-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (path === `/${resource}`) return route.fulfill({ json: { list: Object.values(values).map((value) => ({ value })), total: 2 } });
    if (path.startsWith(`/${resource}/`)) {
      const id = decodeURIComponent(path.slice(resource.length + 2));
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        writes.push({ id, body });
        if (controls.writeFail === id) return route.fulfill({ status: 503, json: { error_msg: 'Unavailable' } });
        if (controls.ignoreWrite !== id) {
          for (const [key, value] of Object.entries(body)) {
            if (key === 'labels') {
              const labels = { ...(values[id].labels as Record<string, unknown>) };
              for (const [label, labelValue] of Object.entries(value as Record<string, unknown>)) {
                if (labelValue === null) delete labels[label]; else labels[label] = labelValue;
              }
              values[id].labels = labels;
            } else if (value === null) delete values[id][key];
            else values[id][key] = value;
          }
        }
      } else if (controls.readFail === id) return route.fulfill({ status: 503, json: { error_msg: 'Unavailable' } });
      return route.fulfill({ json: { value: values[id] } });
    }
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto(resource);
  await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
  await page.getByRole('button', { name: 'Edit RAW', exact: true }).click();
  await expect(dialog(page).getByRole('textbox', { name: 'Bulk JSON patch' })).toBeVisible();
  return { values, writes, controls };
}
async function preview(page: Page, value: unknown) {
  await uiFillMonacoEditor(page, dialog(page).locator('.monaco-editor'), JSON.stringify(value));
  await dialog(page).getByRole('button', { name: 'Preview changes', exact: true }).click();
}
for (const resource of ['routes', 'stream_routes', 'services', 'upstreams', 'plugin_configs']) {
  test(`${resource}: preview is read-only and PATCH verifies each selected item`, async ({ page }) => {
    const { values, writes } = await setup(page, resource);
    await preview(page, { desc: 'After' });
    await expect(dialog(page).getByRole('status')).toContainText('2 ready');
    expect(writes).toEqual([]);
    await dialog(page).getByRole('button', { name: 'Compare JSON' }).first().click();
    const compare = page.getByRole('dialog', { name: 'Changes for first' });
    await expect(compare.locator('.monaco-diff-editor')).toBeVisible();
    await compare.getByRole('button', { name: 'Back to bulk editor' }).click();
    await page.screenshot({ path: test.info().outputPath('bulk-raw-edit.png'), animations: 'disabled' });
    await dialog(page).getByRole('button', { name: 'Apply 2 changes', exact: true }).click();
    await expect(dialog(page).getByRole('status')).toContainText('2 saved and verified');
    expect(writes).toEqual([{ id: 'first', body: { desc: 'After' } }, { id: 'second', body: { desc: 'After' } }]);
    expect(values.first.future_field).toEqual({ preserved: true });
    await dialog(page).getByRole('button', { name: 'Close bulk editor' }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('region', { name: 'Selected resource actions' })).toBeHidden();
  });
}

test('preserves unrelated concurrent fields; null removes a property and arrays are replaced', async ({ page }) => {
  const { values, writes } = await setup(page);
  await preview(page, { labels: { env: 'prod', team: null }, methods: ['DELETE'] });
  await expect(dialog(page).getByRole('status')).toContainText('2 ready');
  values.first.labels = { env: 'dev', team: 'first', added_elsewhere: 'keep' };
  values.first.desc = 'Concurrent description';
  await dialog(page).getByRole('button', { name: 'Apply 2 changes' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('2 saved and verified');
  expect(values.first.labels).toEqual({ env: 'prod', added_elsewhere: 'keep' });
  expect(values.first.desc).toBe('Concurrent description');
  expect(values.first.methods).toEqual(['DELETE']);
  expect(writes[0].body).toEqual({ labels: { env: 'prod', team: null }, methods: ['DELETE'] });
});

test('conflicts remain selected; retry re-previews only failed items and does not resend successful ones', async ({ page }) => {
  const { values, writes } = await setup(page);
  await preview(page, { desc: 'After' });
  await expect(dialog(page).getByRole('status')).toContainText('2 ready');
  values.second.desc = 'Changed elsewhere';
  await dialog(page).getByRole('button', { name: 'Apply 2 changes' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('1 saved and verified');
  await expect(dialog(page)).toContainText('Changed since preview: desc');
  expect(writes).toHaveLength(1);
  await dialog(page).getByRole('button', { name: 'Preview failed items again' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('1 ready');
  expect(writes).toHaveLength(1);
  await dialog(page).getByRole('button', { name: 'Apply 1 changes' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('2 saved and verified');
  expect(writes.map((write) => write.id)).toEqual(['first', 'second']);
});

test('read failures block writes and accepted but unverified updates are never reported as saved', async ({ page }) => {
  const { writes, controls } = await setup(page);
  controls.readFail = 'second';
  await preview(page, { desc: 'After' });
  await expect(dialog(page).getByRole('status')).toContainText('1 ready');
  controls.ignoreWrite = 'first';
  await dialog(page).getByRole('button', { name: 'Apply 1 changes' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('0 saved and verified');
  await expect(dialog(page).getByRole('status')).toContainText('2 need attention');
  await expect(dialog(page)).toContainText('Write outcome is unverified.');
  expect(writes.map((write) => write.id)).toEqual(['first']);
  await dialog(page).getByRole('button', { name: 'Close bulk editor' }).click();
  await expect(page.getByRole('region', { name: 'Selected resource actions' })).toContainText('Selected 2 item(s)');
});

test('invalid fields and required-field removal block preview; editing invalidates a previous preview', async ({ page }) => {
  const { writes } = await setup(page);
  await preview(page, { id: 'replacement' });
  await expect(dialog(page)).toContainText('Read-only fields cannot be patched: id');
  await preview(page, { uri: null });
  await expect(dialog(page).getByRole('status')).toContainText('2 need attention');
  await expect(dialog(page).getByRole('button', { name: 'Apply 0 changes' })).toBeDisabled();
  await preview(page, { desc: 'After' });
  await expect(dialog(page).getByRole('status')).toContainText('2 ready');
  await uiFillMonacoEditor(page, dialog(page).locator('.monaco-editor'), '{"desc":"Different"}');
  await expect(dialog(page).getByRole('button', { name: 'Apply 0 changes' })).toBeDisabled();
  expect(writes).toEqual([]);
});

test('unchanged items do not write; narrow dialog preserves a draft when dismissal is cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { writes } = await setup(page);
  await preview(page, { desc: 'Before' });
  await expect(dialog(page).getByRole('status')).toContainText('2 unchanged');
  await expect(dialog(page).getByRole('button', { name: 'Apply 0 changes' })).toBeDisabled();
  const bounds = await dialog(page).boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog(page).getByRole('button', { name: 'Close bulk editor' }).click();
  const confirm = page.getByRole('dialog', { name: 'Close without applying these changes?' });
  await confirm.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog(page).getByRole('status')).toContainText('2 unchanged');
  expect(writes).toEqual([]);
});

test('bulk patches reject non-objects, empty objects, readonly fields and prototype keys', () => {
  for (const text of ['[]', '{}', 'null', '{"update_time":3}', '{"plugins":{"__proto__":{"x":1}}}'])
    expect(() => parseBulkPatch(text)).toThrow();
});
