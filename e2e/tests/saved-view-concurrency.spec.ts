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
import { type BrowserContext, expect, type Page, test } from '@playwright/test';

const key = 'resource-table:saved-views:v1:resource-table:v1:table-v6:routes';
async function setup(context: BrowserContext, page: Page) {
  const writes: string[] = [];
  await context.addInitScript(() => localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key')));
  await context.route('**/apisix/admin/**', async route => {
    if (route.request().method() !== 'GET') writes.push(route.request().method());
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/plugins')) return route.fulfill({json:{}});
    return route.fulfill({json:{list:[],total:0}});
  });
  await page.goto('routes'); const other = await context.newPage(); await other.goto('routes');
  return {other,writes};
}
const views = (page: Page) => page.getByRole('region',{name:'Saved table views'});
const dialog = (page: Page) => page.getByRole('dialog',{name:'Save table view'});
async function begin(page: Page, name: string) {
  await views(page).getByRole('button',{name:'Save view',exact:true}).click();
  await dialog(page).getByRole('textbox',{name:'View name'}).fill(name);
}
async function commit(page: Page, update=false) {
  await dialog(page).getByRole('button',{name:update?'Update view':'Save view',exact:true}).click();
  await expect(dialog(page)).toBeHidden();
}
async function select(page: Page, name: string) {
  await views(page).getByRole('combobox',{name:'Saved views',exact:true}).click();
  await page.getByRole('option',{name,exact:true}).click();
}
async function saved(page: Page) { return page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]') as {name:string;snapshot:{search:{q?:string}}}[],key); }
async function updateOther(page: Page) {
  await select(page,'Shared');
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill('server-change');
  await page.getByRole('searchbox',{name:'Search',exact:true}).press('Enter');
  await expect(page).toHaveURL(/q=server-change/);
  await begin(page,'Shared'); await commit(page,true);
}

test('two open save dialogs retain both additions and synchronize without changing the active table', async ({context,page}) => {
  const {other,writes}=await setup(context,page);
  await begin(page,'First tab'); await begin(other,'Second tab');
  await commit(other); await commit(page);
  expect((await saved(page)).map(v=>v.name).sort()).toEqual(['First tab','Second tab']);
  await views(other).getByRole('combobox',{name:'Saved views',exact:true}).click();
  await expect(other.getByRole('option',{name:'First tab',exact:true})).toBeVisible();
  await other.keyboard.press('Escape');
  await expect(other.getByRole('searchbox',{name:'Search',exact:true})).toHaveValue('');
  expect(writes).toEqual([]);
});

test('an update opened before another tab changes the same view is blocked', async ({context,page},info) => {
  const {other,writes}=await setup(context,page);
  await begin(page,'Shared'); await commit(page); await begin(page,'Shared');
  await updateOther(other);
  await dialog(page).getByRole('button',{name:'Update view',exact:true}).click();
  await expect(dialog(page).getByRole('alert')).toContainText('changed in another tab');
  expect((await saved(page))[0].snapshot.search.q).toBe('server-change');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath('saved-view-conflict-narrow.png'),animations:'disabled'});
  await dialog(page).getByRole('button',{name:'Cancel',exact:true}).click();
  await views(page).getByRole('button',{name:'Restore view',exact:true}).click();
  await expect(page.getByRole('searchbox',{name:'Search',exact:true})).toHaveValue('server-change');
  expect(writes).toEqual([]);
});

test('stale delete confirmation preserves a newer remote update; successful delete synchronizes selection', async ({context,page}) => {
  const {other,writes}=await setup(context,page);
  await begin(page,'Shared'); await commit(page);
  await views(page).getByRole('button',{name:'Delete view',exact:true}).click();
  await updateOther(other);
  await page.getByRole('tooltip').getByRole('button',{name:'Delete view',exact:true}).click();
  await expect(views(page).getByRole('alert')).toContainText('Review it before deleting');
  expect((await saved(page))[0].snapshot.search.q).toBe('server-change');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await views(page).getByRole('button',{name:'Delete view',exact:true}).click();
  await page.getByRole('tooltip').getByRole('button',{name:'Delete view',exact:true}).click();
  await expect(views(other).getByRole('button',{name:'Restore view',exact:true})).toHaveCount(0);
  expect(await saved(other)).toEqual([]); expect(writes).toEqual([]);
});

test('fresh mutation reads preserve a same-document addition when storage events and Web Locks are unavailable', async ({context,page}) => {
  await context.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));
  await setup(context,page); await begin(page,'Seed'); await commit(page); await begin(page,'New');
  await page.evaluate(key=>{const current=JSON.parse(localStorage.getItem(key)!);localStorage.setItem(key,JSON.stringify([...current,{...current[0],name:'External'}]));},key);
  await commit(page);
  expect((await saved(page)).map(v=>v.name)).toEqual(['Seed','External','New']);
});

test('browser-wide save lock prevents concurrent overwrite and retry remains explicit', async ({context,page}) => {
  const {other}=await setup(context,page); await begin(page,'Saved after lock');
  await other.evaluate(async key=> {
    await new Promise<void>(acquired=>{ void navigator.locks.request(key,()=>new Promise<void>(release=>{
      (window as unknown as {releaseViewLock:()=>void}).releaseViewLock=release; acquired();
    })); });
  },key);
  try {
    await dialog(page).getByRole('button',{name:'Save view',exact:true}).click();
    await expect(dialog(page).getByRole('alert')).toContainText('Another tab is saving');
    expect(await saved(page)).toEqual([]);
  } finally { await other.evaluate(()=>(window as unknown as {releaseViewLock:()=>void}).releaseViewLock()); }
  await commit(page); expect((await saved(page)).map(v=>v.name)).toEqual(['Saved after lock']);
});

test('unreadable stored views are preserved instead of being replaced by an empty list', async ({context,page}) => {
  await setup(context,page); await begin(page,'New');
  await page.evaluate(key=>localStorage.setItem(key,'{broken'),key);
  await dialog(page).getByRole('button',{name:'Save view',exact:true}).click();
  await expect(dialog(page).getByRole('alert')).toContainText('Existing browser storage was preserved');
  expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBe('{broken');
});
