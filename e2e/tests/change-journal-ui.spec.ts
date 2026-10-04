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

const data = { version: 3, exportedAt: '2026-10-04T00:00:00Z', resources: { routes: ['one', 'two', 'three'].map((id) => ({ id, name: `Journal ${id}`, uri: `/journal-${id}`, desc: 'fixture-sensitive-configuration' })) } };
const password = 'fixture journal password';
const createControls = () => ({ records: new Map<string, Record<string, unknown>>(), writes: [] as string[], failReadAfter: new Set<string>(), unavailable: new Set<string>(), ignore: new Set<string>() });
async function setup(page: Page, source: unknown = data, controls = createControls()) {
  await page.addInitScript(() => {
    localStorage.setItem('settings:adminKey', JSON.stringify('journal-browser-fixture'));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'change-set-journal:v1' && (window as unknown as Record<string, unknown>).journalQuota) throw new DOMException('Fixture storage quota exhausted', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.route('**/apisix/admin/**', async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/apisix/admin', '');
    if (request.method() === 'PUT') {
      controls.writes.push(path);
      if (!controls.ignore.has(path)) controls.records.set(path, { ...request.postDataJSON(), ...(path.startsWith('/ssls/') ? { key: '******' } : {}), id: path.split('/').at(-1) });
      if (controls.failReadAfter.has(path)) controls.unavailable.add(path);
      return route.fulfill({ json: { value: controls.records.get(path), key: `/apisix${path}` } });
    }
    if (controls.unavailable.has(path)) return route.fulfill({ status: 503, json: { error_msg: 'Fixture disconnected' } });
    if (controls.records.has(path)) return route.fulfill({ json: { value: controls.records.get(path), key: `/apisix${path}` } });
    if (/^\/(routes|ssls)\/[^/]+$/.test(path)) return route.fulfill({ status: 404, json: { error_msg: 'Not found' } });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  await page.goto('export_import');
  await page.locator('input[type="file"]').setInputFiles({ name: 'journal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Import', exact: true }).getByRole('button', { name: 'Stage for resumable import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Change sets', exact: true })).toBeVisible();
  return controls;
}
const journal = (page: Page) => page.getByRole('dialog', { name: 'Resumable import journal', exact: true });
async function saveJournal(page: Page) {
  await page.getByRole('button', { name: 'Encrypted journal', exact: true }).click();
  await journal(page).getByLabel('Journal password', { exact: true }).fill(password);
  await journal(page).getByLabel('Confirm journal password', { exact: true }).fill(password);
  await journal(page).getByRole('button', { name: 'Encrypt and enable checkpoints', exact: true }).click();
  await expect(journal(page).getByText(/Encrypted journal saved/)).toBeVisible();
  await journal(page).getByRole('button', { name: 'Done', exact: true }).click();
}
async function apply(page: Page, count: number) {
  await page.getByRole('button', { name: `Apply ${count} changes`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Apply change set', exact: true }).getByRole('button', { name: `Apply ${count} changes`, exact: true }).click();
}
async function reload(page: Page) { page.once('dialog', (dialog) => dialog.accept()); await page.reload(); }
async function unlock(page: Page) {
  await page.getByRole('button', { name: 'Encrypted journal', exact: true }).click();
  await journal(page).getByLabel('Journal password', { exact: true }).fill(password);
  await journal(page).getByRole('button', { name: 'Unlock journal', exact: true }).click();
  await expect(journal(page).getByText(/Journal unlocked/)).toBeVisible();
  await journal(page).getByRole('button', { name: 'Done', exact: true }).click();
}

test('encrypted reload reconciles completed and accepted-unverified writes without replaying either', async ({ page }) => {
  const controls = await setup(page); controls.failReadAfter.add('/routes/two'); await saveJournal(page);
  const encoded = await page.evaluate(() => localStorage.getItem('change-set-journal:v1'));
  expect(encoded).not.toContain('fixture-sensitive-configuration'); expect(encoded).not.toContain(password);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click(); await apply(page, 3);
  await expect(page.getByText('Execution stopped. Remaining items were not applied.', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual(['/routes/one', '/routes/two']);
  await reload(page); controls.unavailable.clear();
  await page.getByRole('button', { name: 'Encrypted journal', exact: true }).click();
  await expect(journal(page).getByLabel('Journal password', { exact: true })).toHaveValue('');
  await journal(page).getByLabel('Journal password', { exact: true }).fill('wrong password');
  await journal(page).getByRole('button', { name: 'Unlock journal', exact: true }).click();
  await expect(journal(page).getByText(/Could not unlock/)).toBeVisible();
  await journal(page).getByLabel('Journal password', { exact: true }).fill(password);
  await journal(page).getByRole('button', { name: 'Unlock journal', exact: true }).click();
  await expect(journal(page).getByText(/Journal unlocked/)).toBeVisible();
  await journal(page).getByRole('button', { name: 'Done', exact: true }).click();
  expect(controls.writes).toHaveLength(2);
  await page.getByRole('button', { name: 'Reconcile and preview', exact: true }).click();
  await expect(page.getByText(/Current destination already matches the intended replacement/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply 1 changes', exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('journal-reconciled.png'), animations: 'disabled', fullPage: true });
  await apply(page, 1); await expect(page.getByText('3 staged · 3 verified', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual(['/routes/one', '/routes/two', '/routes/three']);
});

test('an uncertain unapplied PUT needs fresh review and explicit confirmation before retry', async ({ page }) => {
  const controls = await setup(page); controls.ignore.add('/routes/two'); await saveJournal(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click(); await apply(page, 3);
  await expect(page.getByText('Execution stopped. Remaining items were not applied.', { exact: true })).toBeVisible();
  controls.ignore.clear(); await page.getByRole('button', { name: 'Recheck after reconnect', exact: true }).click();
  await expect(page.getByText(/explicitly confirm a retry/)).toBeVisible();
  expect(controls.writes).toEqual(['/routes/one', '/routes/two']);
  await apply(page, 2); await expect(page.getByText('3 staged · 3 verified', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual(['/routes/one', '/routes/two', '/routes/two', '/routes/three']);
});

test('storage failure prevents the next PUT and retains the earlier encrypted archive', async ({ page }) => {
  const controls = await setup(page); await saveJournal(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  const previous = await page.evaluate(() => localStorage.getItem('change-set-journal:v1'));
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).journalQuota = true; });
  await apply(page, 3);
  await expect(page.getByText('Fixture storage quota exhausted', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('change-set-journal:v1'))).toBe(previous);
});

test('protected uncertain writes remain blocked after unlock on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const controls = await setup(page, { version: 3, exportedAt: '2026-10-04T00:00:00Z', resources: { ssls: [{ id: 'tls', cert: 'fixture-certificate', key: 'fixture-private-key', snis: ['fixture.example'] }] } });
  controls.failReadAfter.add('/ssls/tls'); await saveJournal(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click(); await apply(page, 1);
  await expect(page.getByText('Execution stopped. Remaining items were not applied.', { exact: true })).toBeVisible();
  await reload(page); controls.unavailable.clear(); await unlock(page);
  await page.getByRole('button', { name: 'Reconcile and preview', exact: true }).click();
  await expect(page.getByText(/This uncertain write contains protected fields/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled(); expect(controls.writes).toEqual(['/ssls/tls']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Encrypted journal enabled', exact: true }).click();
  await expect(journal(page).getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await expect(journal(page)).not.toHaveClass(/ant-zoom-enter|ant-zoom-appear/);
  await page.screenshot({ path: test.info().outputPath('journal-narrow.png'), animations: 'disabled' });
});

test('drift in a previously verified destination blocks resuming the remaining items', async ({ page }) => {
  const controls = await setup(page); controls.ignore.add('/routes/two'); await saveJournal(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click(); await apply(page, 3);
  await expect(page.getByText('Execution stopped. Remaining items were not applied.', { exact: true })).toBeVisible();
  controls.records.set('/routes/one', { ...controls.records.get('/routes/one'), uri: '/changed-elsewhere' });
  await page.getByRole('button', { name: 'Recheck after reconnect', exact: true }).click();
  await expect(page.getByText(/A previously verified destination has changed/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled(); expect(controls.writes).toHaveLength(2);
});


test('two tabs serialize encrypted checkpoints under the shared browser lock', async ({ page, context }) => {
  const first = await setup(page); await saveJournal(page);
  const other = await context.newPage(); const second = await setup(other);
  for (const tab of [page, other]) {
    await tab.getByRole('button', { name: /^Encrypted journal( enabled)?$/ }).click();
    await journal(tab).getByLabel('Journal password', { exact: true }).fill(password);
    await journal(tab).getByLabel('Confirm journal password', { exact: true }).fill(password);
  }
  await Promise.all([page, other].map((tab) => journal(tab).getByRole('button', { name: 'Encrypt and enable checkpoints', exact: true }).click()));
  await expect.poll(async () => (await Promise.all([page, other].map((tab) => journal(tab).getByText(/Encrypted journal saved/).count()))).reduce((a, b) => a + b, 0)).toBe(1);
  await expect.poll(async () => (await Promise.all([page, other].map((tab) => journal(tab).getByText(/changed in another tab|busy in another tab/).count()))).reduce((a, b) => a + b, 0)).toBe(1);
  expect([...first.writes, ...second.writes]).toEqual([]);
});


test('a held journal lock returns promptly without PUT and keeps drafts editable', async ({ page, context }) => {
  const controls = await setup(page); await saveJournal(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  const previous = await page.evaluate(() => localStorage.getItem('change-set-journal:v1'));
  const other = await context.newPage();
  await other.route('**/apisix/admin/**', (route) => route.fulfill({ json: { list: [], total: 0 } }));
  await other.goto('change_sets');
  await other.evaluate(async () => {
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => { acquired = resolve; });
    void navigator.locks.request('apisix-dashboard:change-set-journal:v1', () => new Promise<void>((resolve) => {
      (window as unknown as Record<string, unknown>).releaseJournalLock = resolve;
      acquired();
    }));
    await ready;
  });
  try {
    await apply(page, 3);
    await expect(page.getByText(/The journal is busy in another tab/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Preview destinations', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Remove draft', exact: true })).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Remove draft', exact: true }).first()).toBeEnabled();
    await expect(page.getByText('3 staged · 0 verified', { exact: true })).toBeVisible();
    expect(controls.writes).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('change-set-journal:v1'))).toBe(previous);
    expect(await other.evaluate(async () => (await navigator.locks.query()).pending?.filter((lock) => lock.name === 'apisix-dashboard:change-set-journal:v1').length)).toBe(0);
    await page.getByRole('menuitem', { name: 'Import / Export', exact: true }).click();
    await expect(page).toHaveURL(/\/export_import$/);
    await expect(page.getByRole('dialog', { name: 'Change set in progress', exact: true })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Change sets', exact: true }).click();
    await expect(page.getByText('3 staged · 0 verified', { exact: true })).toBeVisible();
  } finally {
    await other.evaluate(() => ((window as unknown as Record<string, unknown>).releaseJournalLock as () => void)());
  }
});

test('independent tabs applying one archive write once and the stale tab resumes without replay', async ({ page, context }) => {
  const controls = await setup(page); await saveJournal(page);
  await page.getByRole('button', { name: 'Preview destinations', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  const other = await context.newPage(); await setup(other, data, controls);
  await other.getByRole('button', { name: 'Encrypted journal', exact: true }).click();
  await journal(other).getByLabel('Journal password', { exact: true }).fill(password);
  await journal(other).getByRole('button', { name: 'Unlock and replace staged drafts', exact: true }).click();
  await expect(journal(other).getByText(/Journal unlocked/)).toBeVisible();
  await journal(other).getByRole('button', { name: 'Done', exact: true }).click();
  await other.getByRole('button', { name: 'Reconcile and preview', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Apply 3 changes', exact: true })).toBeEnabled();
  await Promise.all([page, other].map((tab) => apply(tab, 3)));
  await expect(page.getByText(/The encrypted journal changed in another tab/)).toBeVisible();
  await expect(page.getByText('3 staged · 0 verified', { exact: true })).toBeVisible();
  await expect(other.getByText('3 staged · 3 verified', { exact: true })).toBeVisible();
  expect(controls.writes).toEqual(['/routes/one', '/routes/two', '/routes/three']);
  await reload(page); await unlock(page);
  await page.getByRole('button', { name: 'Reconcile and preview', exact: true }).click();
  await expect(page.getByText('3 staged · 3 verified', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Apply.*changes$/ })).toBeDisabled();
  expect(controls.writes).toEqual(['/routes/one', '/routes/two', '/routes/three']);
});


test('journal explains that staged additions and removals wait for a checkpoint', async ({ page }) => {
  const controls = await setup(page); await saveJournal(page);
  const original = await page.evaluate(() => localStorage.getItem('change-set-journal:v1'));
  await page.locator('.ant-card').filter({ hasText: '/routes/three' }).getByRole('button', { name: 'Remove draft', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('2 staged · 0 verified', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Import / Export', exact: true }).click();
  const addition = { ...data, resources: { routes: [{ id: 'four', uri: '/journal-four' }] } };
  await page.locator('input[type="file"]').setInputFiles({ name: 'addition.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(addition)) });
  await page.getByRole('button', { name: 'Import Selected Resources', exact: true }).click();
  await page.getByRole('dialog', { name: 'Confirm Import', exact: true }).getByRole('button', { name: 'Stage for resumable import', exact: true }).click();
  await expect(page.getByText('3 staged · 0 verified', { exact: true })).toBeVisible();
  await expect(page.getByText(/Only checkpointed drafts survive reload/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('change-set-journal:v1'))).toBe(original);
  expect(controls.writes).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Encrypted journal enabled', exact: true }).click();
  await expect(journal(page).getByText(/Newly staged items and draft removals/)).toBeVisible();
  await expect(journal(page).getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await expect(journal(page)).not.toHaveClass(/ant-zoom-enter|ant-zoom-appear/);
  await expect(page.locator('.ant-message-notice')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('journal-checkpoint-scope-narrow.png'), animations: 'disabled' });
  await journal(page).getByLabel('Journal password', { exact: true }).fill(password);
  await journal(page).getByLabel('Confirm journal password', { exact: true }).fill(password);
  await journal(page).getByRole('button', { name: 'Encrypt and enable checkpoints', exact: true }).click();
  await expect(journal(page).getByText(/Encrypted journal saved/)).toBeVisible();
  await journal(page).getByRole('button', { name: 'Done', exact: true }).click();
  await reload(page); await unlock(page);
  await expect(page.locator('.ant-card')).toHaveCount(3);
  for (const id of ['one', 'two', 'four']) await expect(page.locator('.ant-card').filter({ hasText: `/routes/${id}` })).toBeVisible();
  await expect(page.locator('.ant-card').filter({ hasText: '/routes/three' })).toHaveCount(0);
  expect(controls.writes).toEqual([]);
});
