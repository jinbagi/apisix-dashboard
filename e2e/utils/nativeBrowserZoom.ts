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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type BrowserContext, chromium, expect, type Page, type Worker } from '@playwright/test';

type ChromeTabs = { query: (query: object) => Promise<Array<{ id: number; url?: string }>>; setZoom: (id: number, factor: number) => Promise<void>; getZoom: (id: number) => Promise<number> };
export const zoomMetrics = (page: Page) => page.evaluate(() => ({ innerWidth, innerHeight, outerWidth, outerHeight, dpr: devicePixelRatio,
  visualScale: visualViewport?.scale, cssZoom: getComputedStyle(document.documentElement).zoom, scrollWidth: document.documentElement.scrollWidth }));
export async function settledLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => undefined)));
  });
}
/** A fresh test-owned profile; never use the operator's browser/profile. */
export async function nativeZoomContext() {
  const directory = await mkdtemp(path.join(tmpdir(), 'apisix-native-zoom-'));
  const extension = path.join(directory, 'extension');
  await mkdir(extension);
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Native zoom test fixture', version: '1.0',
    permissions: ['tabs'], background: { service_worker: 'worker.js' } }));
  await writeFile(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});\n');
  let context: BrowserContext | undefined;
  const close = async () => {
    await context?.close();
    // Only delete the private directory created by this invocation, after closing Chromium.
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith('apisix-native-zoom-')) throw new Error('Unexpected zoom fixture directory');
    await rm(directory, { recursive: true, force: true });
  };
  try {
    context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
      channel: 'chromium', headless: true, viewport: null, deviceScaleFactor: undefined, isMobile: undefined,
      ...(process.env.E2E_NATIVE_ZOOM_EXECUTABLE ? { executablePath: process.env.E2E_NATIVE_ZOOM_EXECUTABLE } : {}),
      args: ['--window-size=1440,1080', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const initialDpr = await context.pages()[0].evaluate(() => devicePixelRatio);
    return { context, worker, initialDpr, close };
  } catch (error) { await close(); throw error; }
}
export async function setNativeZoom(page: Page, worker: Worker, initialDpr: number) {
  const tabId = await worker.evaluate(async url => {
    const tabs = (globalThis as unknown as { chrome: { tabs: ChromeTabs } }).chrome.tabs;
    const tab = (await tabs.query({})).find(tab => tab.url === url);
    if (!tab) throw new Error('Test tab was not found');
    return tab.id;
  }, page.url());
  await worker.evaluate(id => (globalThis as unknown as { chrome: { tabs: ChromeTabs } }).chrome.tabs.setZoom(id, 1), tabId);
  await page.waitForFunction(dpr => devicePixelRatio === dpr, initialDpr);
  const normal = await zoomMetrics(page);
  await worker.evaluate(id => (globalThis as unknown as { chrome: { tabs: ChromeTabs } }).chrome.tabs.setZoom(id, 2), tabId);
  await page.waitForFunction(before => Math.abs(innerWidth * 2 - before.innerWidth) <= 1 && devicePixelRatio === before.dpr * 2, normal);
  await settledLayout(page);
  const scaled = await zoomMetrics(page);
  const factor = await worker.evaluate(id => (globalThis as unknown as { chrome: { tabs: ChromeTabs } }).chrome.tabs.getZoom(id), tabId);
  expect(factor).toBe(2); expect(scaled.outerWidth).toBe(normal.outerWidth); expect(scaled.outerHeight).toBe(normal.outerHeight);
  expect(Math.abs(scaled.innerWidth * 2 - normal.innerWidth)).toBeLessThanOrEqual(1);
  expect(scaled.dpr).toBe(normal.dpr * 2); expect(scaled.visualScale).toBe(1); expect(scaled.cssZoom).toBe('1');
  return { factor, normal, scaled };
}
/** Native zoom is misclipped by Playwright's CSS-sized screenshot clip. Capture the full Chromium surface. */
export async function captureNativeViewport(page: Page, file: string) {
  await settledLayout(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const png = Buffer.from(data, 'base64');
    const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    const current = await zoomMetrics(page);
    expect(Math.abs(dimensions.width - current.innerWidth * current.dpr)).toBeLessThanOrEqual(2);
    expect(Math.abs(dimensions.height - current.innerHeight * current.dpr)).toBeLessThanOrEqual(2);
    await writeFile(file, png);
    return { ...dimensions, current };
  } finally { await cdp.detach(); }
}
