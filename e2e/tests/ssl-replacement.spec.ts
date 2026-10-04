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
import { createPrivateKey } from 'node:crypto';

import { PemConverter, SubjectAlternativeNameExtension, X509CertificateGenerator } from '@peculiar/x509';
import { expect, type Page, test } from '@playwright/test';

import { checkCertificatePair, inspectCertificate, sslReplacementPayload } from '../../src/utils/sslCertificate';

type Pair = { cert: string; key: string; legacy: string };
async function generatePair(name: string, ec = false, validity?: { start: Date; end: Date }): Promise<Pair> {
  const algorithm = ec ? { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }
    : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const keys = await crypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
  const certificate = await X509CertificateGenerator.createSelfSigned({ name: `CN=${name}`, keys,
    notBefore: validity?.start ?? new Date(Date.now() - 86400000), notAfter: validity?.end ?? new Date(Date.now() + 86400000 * 60),
    signingAlgorithm: algorithm, extensions: [new SubjectAlternativeNameExtension([{ type: 'dns', value: 'api.example.com' }])],
  });
  const key = PemConverter.encode(await crypto.subtle.exportKey('pkcs8', keys.privateKey), 'PRIVATE KEY');
  return { cert: certificate.toString('pem'), key, legacy: createPrivateKey(key).export({ format: 'pem', type: ec ? 'sec1' : 'pkcs1' }).toString() };
}
let current: Pair;
let next: Pair;
let ec: Pair;

test.beforeAll(async () => { [current, next, ec] = await Promise.all([generatePair('Current certificate'), generatePair('Replacement certificate'), generatePair('EC replacement', true)]); });

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Replace SSL certificate: fixture-ssl', exact: true });
async function setup(page: Page, options: { additional?: boolean; masked?: boolean; viaList?: boolean } = {}) {
  const initial: Record<string, unknown> = { id: 'fixture-ssl', cert: current.cert, key: current.key, snis: ['api.example.com'], status: 1, type: 'server', labels: { env: 'fixture' }, ssl_protocols: ['TLSv1.2', 'TLSv1.3'], create_time: 1, update_time: 1, validity_start: 1, validity_end: 2,
    ...(options.additional ? { certs: [ec.cert], keys: [options.masked ? '******' : ec.key] } : {}) };
  const state = { value: structuredClone(initial), writes: [] as Record<string, unknown>[], reads: 0, failRead: false, wrongIdentity: false, failAfter: false, staleAfter: false, maskAfter: false };
  await page.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await page.route('**/apisix/admin/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/apisix/admin', '');
    if (path === '/ssls/fixture-ssl') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON(); state.writes.push(body);
        if (!state.staleAfter) state.value = { ...body, id: 'fixture-ssl', update_time: state.writes.length + 1 };
        return route.fulfill({ json: { value: { id: 'fixture-ssl' } } });
      }
      state.reads++;
      if (state.failRead || (state.failAfter && state.writes.length)) return route.fulfill({ status: 503, json: { error_msg: 'fixture unavailable' } });
      return route.fulfill({ json: { key: '/apisix/ssls/fixture-ssl', value: { ...state.value,
        ...(state.maskAfter && state.writes.length ? { key: '******' } : {}), ...(state.wrongIdentity ? { id: 'wrong-id' } : {}) } } });
    }
    if (path === '/ssls') return route.fulfill({ json: { list: [{ value: state.value }], total: 1 } });
    if (path === '/plugins/list') return route.fulfill({ json: [] });
    if (path === '/plugins') return route.fulfill({ json: {} });
    return route.fulfill({ json: { list: [], total: 0 } });
  });
  if (options.viaList) {
    await page.goto('ssls');
    await page.getByRole('link', { name: 'api.example.com', exact: true }).click();
  } else await page.goto('ssls/detail/fixture-ssl');
  await page.getByRole('button', { name: 'Replace certificate', exact: true }).click();
  await expect(dialog(page).getByRole('region', { name: 'Current certificate' })).toContainText('Current certificate');
  await expect(dialog(page).getByRole('button', { name: 'Refresh current SSL' })).toBeEnabled();
  return state;
}
async function fill(page: Page, pair = next, key = pair.key) {
  await dialog(page).getByLabel('Replacement certificate PEM (leaf first, optional chain)', { exact: true }).fill(pair.cert);
  await dialog(page).getByLabel('Replacement private key PEM', { exact: true }).fill(key);
}
async function review(page: Page, pair = next, key = pair.key) {
  await fill(page, pair, key);
  await dialog(page).getByRole('button', { name: 'Inspect replacement' }).click();
  await expect(dialog(page).getByText('Private key match verified', { exact: true })).toBeVisible();
}

test('real RSA and ECDSA keys match through PKCS#8 and common legacy PEM containers', async () => {
  for (const pair of [current, ec]) for (const key of [pair.key, pair.legacy]) {
    const result = await checkCertificatePair(pair.cert, key, ['api.example.com']);
    expect(result.warnings).toEqual([]);
    expect(result.certificate.fingerprint).toMatch(/^(?:[a-f0-9]{2}:){31}[a-f0-9]{2}$/);
  }
  await expect(checkCertificatePair(next.cert, current.key, [])).rejects.toThrow('does not match');
  await expect(checkCertificatePair(next.cert, ec.legacy, [])).rejects.toThrow('type does not match');
  await expect(checkCertificatePair(next.cert, '-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----', [])).rejects.toThrow('Encrypted');
  await expect(checkCertificatePair(next.cert, '$secret://vault/key', [])).rejects.toThrow('Secret reference');
  await expect(inspectCertificate('not a PEM')).rejects.toThrow('PEM CERTIFICATE');
  const chain = await checkCertificatePair(`${next.cert}\n${current.cert}`, next.key, ['api.example.com']);
  expect(chain.certificate.chainLength).toBe(2);
});

test('inspection reviews metadata without writes; explicit replacement preserves SSL settings and verifies readable fields', async ({ page }) => {
  const state = await setup(page, { additional: true }); state.maskAfter = true;
  await review(page, next, next.legacy);
  expect(state.writes).toHaveLength(0);
  await expect(dialog(page).getByRole('region', { name: 'Current certificate' })).toContainText('CN=Current certificate');
  await expect(dialog(page).getByRole('region', { name: 'Replacement certificate' })).toContainText('CN=Replacement certificate');
  await expect(dialog(page)).toContainText('Changed fields: /cert and /key');
  await expect(dialog(page)).not.toContainText('BEGIN PRIVATE KEY');
  await page.screenshot({ path: test.info().outputPath('ssl-replacement-review.png'), animations: 'disabled' });
  const readsBefore = state.reads;
  await dialog(page).getByRole('button', { name: 'Save replacement' }).click();
  await expect(dialog(page)).toContainText('Replacement accepted; readable fields verified');
  expect(state.reads).toBeGreaterThanOrEqual(readsBefore + 2);
  expect(state.writes).toHaveLength(1);
  const expected = sslReplacementPayload({ id: 'fixture-ssl', cert: current.cert, key: current.key, certs: [ec.cert], keys: [ec.key], snis: ['api.example.com'], status: 1, type: 'server', labels: { env: 'fixture' }, ssl_protocols: ['TLSv1.2', 'TLSv1.3'] }, 0, next.cert, next.legacy);
  expect(state.writes[0]).toEqual(expected);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('PRIVATE KEY'); expect(storage).not.toContain(next.key);
  await dialog(page).getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Replace certificate', exact: true }).click();
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue('');
});

test('a selected additional EC pair replaces only its array position', async ({ page }) => {
  const state = await setup(page, { additional: true });
  await dialog(page).getByRole('combobox', { name: 'Certificate pair to replace' }).click();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await review(page, next);
  await expect(dialog(page)).toContainText('Changed fields: /certs/0 and /keys/0');
  await dialog(page).getByRole('button', { name: 'Save replacement' }).click();
  await expect(dialog(page)).toContainText('Replacement accepted; readable fields verified');
  expect(state.writes[0].cert).toBe(current.cert); expect(state.writes[0].key).toBe(current.key);
  expect(state.writes[0].certs).toEqual([next.cert.trim()]); expect(state.writes[0].keys).toEqual([next.key.trim()]);
});

test('mismatched, encrypted and masked keys never produce a save action', async ({ page }) => {
  const state = await setup(page);
  await fill(page, next, current.key); await dialog(page).getByRole('button', { name: 'Inspect replacement' }).click();
  await expect(dialog(page)).toContainText('The private key does not match');
  await expect(dialog(page).getByRole('button', { name: 'Save replacement' })).toHaveCount(0);
  await fill(page, next, '-----BEGIN ENCRYPTED PRIVATE KEY-----\nabc\n-----END ENCRYPTED PRIVATE KEY-----');
  await dialog(page).getByRole('button', { name: 'Inspect replacement' }).click();
  await expect(dialog(page)).toContainText('Encrypted private keys');
  expect(state.writes).toHaveLength(0);
  expect(() => sslReplacementPayload({ cert: current.cert, key: current.key, certs: [ec.cert], keys: ['******'] }, 0, next.cert, next.key)).toThrow('unchanged private key');
});

test('fresh-read conflict and wrong identity block writes and preserve replacement inputs', async ({ page }) => {
  const state = await setup(page);
  await review(page); state.value = { ...state.value, labels: { env: 'changed elsewhere' }, update_time: 9 };
  await dialog(page).getByRole('button', { name: 'Save replacement' }).click();
  await expect(dialog(page)).toContainText('The SSL changed after this review');
  expect(state.writes).toHaveLength(0);
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue(next.key);
  await dialog(page).getByRole('button', { name: 'Refresh current SSL' }).click();
  await dialog(page).getByRole('button', { name: 'Inspect replacement' }).click();
  await expect(dialog(page).getByText('Private key match verified', { exact: true })).toBeVisible();
  state.wrongIdentity = true;
  await dialog(page).getByRole('button', { name: 'Save replacement' }).click();
  await expect(dialog(page)).toContainText('The latest SSL could not be verified');
  expect(state.writes).toHaveLength(0);
});

for (const mode of ['failAfter', 'staleAfter'] as const) test(`accepted SSL write with ${mode} is unverified and never automatically retried`, async ({ page }) => {
  const state = await setup(page); await review(page); state[mode] = true;
  await dialog(page).getByRole('button', { name: 'Save replacement' }).click();
  await expect(dialog(page)).toContainText('read-back could not verify the readable fields');
  await expect(dialog(page).getByRole('button', { name: 'Inspect replacement' })).toBeDisabled();
  expect(state.writes).toHaveLength(1);
});

test('phone review keeps save reachable and validity warnings require acknowledgement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page);
  const expired = await generatePair('Expired replacement', true, { start: new Date('2020-01-01'), end: new Date('2021-01-01') });
  state.value = { ...state.value, snis: ['not-covered.example.com'] };
  await dialog(page).getByRole('button', { name: 'Refresh current SSL' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Refresh current SSL' })).toBeEnabled();
  await review(page, expired, expired.legacy);
  await expect(dialog(page)).toContainText('has expired');
  await expect(dialog(page)).toContainText('not covered');
  const save = dialog(page).getByRole('button', { name: 'Save replacement' });
  await expect(save).toBeDisabled();
  await dialog(page).getByRole('checkbox').check();
  await expect(save).toBeEnabled();
  const bounds = await save.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: test.info().outputPath('ssl-replacement-narrow.png'), animations: 'disabled' });
  await save.focus(); await page.keyboard.press('Shift+Tab'); await expect(dialog(page).getByRole('button', { name: 'Edit replacement' })).toBeFocused();
  expect(state.writes).toHaveLength(0);
});

test('closing unsaved replacement asks once and reopening clears in-memory PEM inputs', async ({ page }) => {
  const state = await setup(page); await fill(page);
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue(next.key);
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard replacement', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Replace certificate', exact: true }).click();
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue('');
  expect(state.writes).toHaveLength(0);
});

test('an older cryptographic check cannot approve a newly edited private key', async ({ page }) => {
  const state = await setup(page); await fill(page);
  await page.evaluate(() => {
    const original = crypto.subtle.sign.bind(crypto.subtle);
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    crypto.subtle.verify = async (...args) => {
      const result = await verify(...args);
      (window as unknown as { sslCheckFinished: boolean }).sslCheckFinished = true;
      return result;
    };
    crypto.subtle.sign = async (...args) => {
      await new Promise<void>((resolve) => { (window as unknown as { releaseSSLCheck: () => void }).releaseSSLCheck = resolve; });
      return original(...args);
    };
  });
  await dialog(page).getByRole('button', { name: 'Inspect replacement' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseSSLCheck?: () => void }).releaseSSLCheck)).toBe('function');
  await dialog(page).getByLabel('Replacement private key PEM', { exact: true }).fill('changed during verification');
  await page.evaluate(() => (window as unknown as { releaseSSLCheck: () => void }).releaseSSLCheck());
  await expect.poll(() => page.evaluate(() => (window as unknown as { sslCheckFinished?: boolean }).sslCheckFinished)).toBe(true);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(dialog(page).getByRole('button', { name: 'Inspect replacement' })).toBeEnabled();
  await expect(dialog(page).getByRole('button', { name: 'Save replacement' })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('file loading is local, size limited, and an unavailable baseline cannot be saved', async ({ page }) => {
  const state = await setup(page);
  await dialog(page).getByLabel('Certificate PEM file', { exact: true }).setInputFiles({ name: 'certificate.pem', mimeType: 'text/plain', buffer: Buffer.from(next.cert) });
  await dialog(page).getByLabel('Private key PEM file', { exact: true }).setInputFiles({ name: 'key.pem', mimeType: 'text/plain', buffer: Buffer.from(next.key) });
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue(next.key);
  await dialog(page).getByLabel('Private key PEM file', { exact: true }).setInputFiles({ name: 'oversized.pem', mimeType: 'text/plain', buffer: Buffer.alloc(1024 * 1024 + 1) });
  await expect(dialog(page).getByRole('alert')).toContainText('no larger than 1 MiB');
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue(next.key);
  state.failRead = true;
  await dialog(page).getByRole('button', { name: 'Refresh current SSL' }).click();
  await expect(dialog(page)).toContainText('The current SSL could not be read');
  await expect(dialog(page).getByRole('button', { name: 'Inspect replacement' })).toBeDisabled();
  state.failRead = false;
  await dialog(page).getByRole('button', { name: 'Refresh current SSL' }).click();
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue(next.key);
  expect(state.writes).toHaveLength(0);
});

test('replacement starts from Configuration only and preserves unsaved form values', async ({ page }) => {
  await setup(page);
  await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  const launch = page.getByRole('button', { name: 'Replace certificate', exact: true });
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill('Unsaved SSL description');
  await expect(launch).toBeDisabled();
  await page.getByRole('tab', { name: 'Payload JSON', exact: true }).click();
  await expect(launch).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
  await page.getByRole('tab', { name: 'Configuration', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Description', exact: true })).toHaveValue('Unsaved SSL description');
  await expect(launch).toBeDisabled();
});

test('browser back preserves pending PEM until explicit discard and forward starts a fresh dialog', async ({ page }) => {
  const state = await setup(page, { viaList: true }); await fill(page);
  await page.goBack();
  const leave = page.getByRole('dialog', { name: 'Discard certificate replacement and leave?', exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Stay here', exact: true }).click();
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue(next.key);
  await page.goBack();
  await leave.getByRole('button', { name: 'Discard and leave', exact: true }).click();
  await expect(page).toHaveURL(/\/ssls\/?(?:\?.*)?$/);
  await page.goForward();
  await page.getByRole('button', { name: 'Replace certificate', exact: true }).click();
  await expect(dialog(page).getByLabel('Replacement private key PEM', { exact: true })).toHaveValue('');
  expect(state.writes).toHaveLength(0);
});