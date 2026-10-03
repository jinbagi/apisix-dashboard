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

import { getAPISIXConf, randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { uiFillMonacoEditor } from '@e2e/utils/ui';
import { expect, test } from '@playwright/test';

test('bulk RAW PATCH persists merge, deletion and array replacement in APISIX', async ({ page }) => {
  const batch = randomId('bulk_raw');
  const ids = [`${batch}_first`, `${batch}_second`];
  const { adminKey } = await getAPISIXConf();
  await page.addInitScript((key) => localStorage.setItem('settings:adminKey', JSON.stringify(key)), adminKey);
  try {
    for (const id of ids) await e2eReq.put(`/routes/${id}`, {
      name: id, uri: `/${id}`, desc: 'Remove me', methods: ['GET', 'POST'],
      labels: { bulk_raw_test: batch, env: 'dev' }, upstream: { nodes: { '127.0.0.1:1980': 1 } },
    });
    await page.goto(`routes?label=bulk_raw_test%3A${encodeURIComponent(batch)}`);
    await expect(page.getByRole('checkbox', { name: 'Select row', exact: true })).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'Select all', exact: true }).check();
    await page.getByRole('button', { name: 'Edit RAW', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Bulk RAW edit', exact: true });
    await expect(modal.getByRole('textbox', { name: 'Bulk JSON patch' })).toBeVisible();
    await uiFillMonacoEditor(page, modal.locator('.monaco-editor'), JSON.stringify({
      labels: { env: 'prod' }, desc: null, methods: ['POST'],
    }));
    await modal.getByRole('button', { name: 'Preview changes', exact: true }).click();
    await expect(modal.getByRole('status')).toContainText('2 ready');
    await modal.getByRole('button', { name: 'Apply 2 changes' }).click();
    await expect(modal.getByRole('status')).toContainText('2 saved and verified');
    for (const id of ids) {
      const { data } = await e2eReq.get(`/routes/${id}`);
      expect(data.value.labels).toEqual({ bulk_raw_test: batch, env: 'prod' });
      expect(data.value.methods).toEqual(['POST']);
      expect(data.value.desc).toBeUndefined();
    }
  } finally {
    for (const id of ids) await e2eReq.delete(`/routes/${id}`);
  }
});



for (const resource of ['consumers', 'consumer_groups', 'global_rules']) {
  test(`${resource}: bulk RAW saves and verifies against APISIX`, async ({ page }) => {
    const id = randomId('bulk_extended');
    const { adminKey } = await getAPISIXConf();
    await page.addInitScript((key) => localStorage.setItem('settings:adminKey', JSON.stringify(key)), adminKey);
    const plugins = { 'response-rewrite': { headers: { 'X-Bulk-Test': 'before' } } };
    try {
      await e2eReq.put(`/${resource}/${id}`, { ...(resource === 'consumers' ? { username: id } : {}), plugins });
      await page.goto(resource);
      await page.getByRole('row').filter({ hasText: id }).getByRole('checkbox', { name: 'Select row', exact: true }).check();
      await page.getByRole('button', { name: 'Edit RAW', exact: true }).click();
      const modal = page.getByRole('dialog', { name: 'Bulk RAW edit', exact: true });
      await expect(modal.getByRole('textbox', { name: 'Bulk JSON patch' })).toBeVisible();
      await uiFillMonacoEditor(page, modal.locator('.monaco-editor'), JSON.stringify({ plugins: { 'response-rewrite': { headers: { 'X-Bulk-Test': 'after' } } } }));
      await modal.getByRole('button', { name: 'Preview changes', exact: true }).click();
      await expect(modal.getByRole('status')).toContainText('1 ready');
      await modal.getByRole('button', { name: 'Apply 1 changes' }).click();
      await expect(modal.getByRole('status')).toContainText('1 saved and verified');
      const { data } = await e2eReq.get(`/${resource}/${id}`);
      expect(data.value.plugins['response-rewrite'].headers['X-Bulk-Test']).toBe('after');
      expect(data.value[resource === 'consumers' ? 'username' : 'id']).toBe(id);
      await modal.getByRole('button', { name: 'Close bulk editor' }).click();
      await page.getByRole('row').filter({ hasText: id }).getByRole('button', { name: 'Raw', exact: true }).click();
      await page.getByRole('button', { name: 'Change history', exact: true }).click();
      await page.getByRole('dialog', { name: 'Resource change history', exact: true }).getByRole('button', { name: 'Restore previous values' }).click();
      await page.getByRole('dialog', { name: 'Restore previous resource values', exact: true }).getByRole('button', { name: 'Restore into editor' }).click();
      await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
      await expect(page.getByText(/Saved at/)).toBeVisible();
      const restored = await e2eReq.get(`/${resource}/${id}`);
      expect(restored.data.value.plugins['response-rewrite'].headers['X-Bulk-Test']).toBe('before');
    } finally { await e2eReq.delete(`/${resource}/${id}`); }
  });
}
