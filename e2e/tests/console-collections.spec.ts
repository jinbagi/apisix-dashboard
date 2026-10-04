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

import { type ConsoleTemplate,parseRequestPresets, presetIdentity, resolveConsoleTemplate } from '../../src/utils/consoleTemplates';

const template: ConsoleTemplate = { method: 'PUT', resource: '/routes', pathSuffix: '{{id}}', queryString: 'label={{label}}', body: '{"uri":"{{uri}}"}', endpoint: '' };
const preset = (id: string, collection?: string) => ({ ...template, id, name: 'Saved '+id, collection, createdAt: 1, pathSuffix: id, queryString: '', body: '{}', endpoint: '/routes/'+id });

test('variables encode path/query and replace only JSON string values without losing keys', () => {
  const output = resolveConsoleTemplate({ ...template, body: '{"__proto__":{"constructor":"{{uri}}"},"items":[true,42,"{{uri}}"],"{{literal-key}}":null}' }, [
    { name: 'id', value: 'a/b?x=1' }, { name: 'label', value: '..' }, { name: 'uri', value: '/say"hi\\{{keep}}' },
  ]);
  expect(output.pathSuffix).toBe('a%2Fb%3Fx%3D1'); expect(output.queryString).toBe('label=..');
  const json = JSON.parse(output.body);
  expect(Object.hasOwn(json, '__proto__')).toBe(true);
  expect(json.__proto__.constructor).toBe('/say"hi\\{{keep}}');
  expect(json.items).toEqual([true,42,'/say"hi\\{{keep}}']); expect(json['{{literal-key}}']).toBe(null);
});

test('missing, duplicate, invalid and unclosed variables block resolution; path traversal and invalid JSON block', () => {
  const vars = [{ name: 'id', value: 'one' }, { name: 'label', value: 'env=prod&admin=1' }, { name: 'uri', value: '/one' }];
  expect(resolveConsoleTemplate(template, vars).queryString).toBe('label=env%3Dprod%26admin%3D1');
  expect(() => resolveConsoleTemplate(template, [])).toThrow('Define variable');
  expect(() => resolveConsoleTemplate(template, [...vars,vars[0]])).toThrow('Duplicate');
  expect(() => resolveConsoleTemplate(template, [{name:'bad name',value:'x'}])).toThrow('Variable names');
  expect(() => resolveConsoleTemplate({...template,pathSuffix:'{{id'}, vars)).toThrow('Close every');
  expect(() => resolveConsoleTemplate(template, vars.map(v=>v.name==='id'?{...v,value:'..'}:v))).toThrow('dot path');
  expect(() => resolveConsoleTemplate({...template,body:'{"id":{{id}}}'}, vars)).toThrow('valid JSON');
});

test('legacy presets remain unfiled, malformed records are discarded, and collection identity is unambiguous', () => {
  const old = preset('legacy');
  expect(parseRequestPresets([old,old,{...preset('other'), method:'BOGUS'}, {...preset('third'),resource:'https://evil.invalid'}])).toEqual([{...old,collection:''}]);
  expect(presetIdentity(' Name ', ' COL ')).toBe(presetIdentity('name','col'));
  expect(presetIdentity('a:b','c')).not.toBe(presetIdentity('b','c:a'));
});

async function setup(page: Page, presets: ReturnType<typeof preset>[] = [], storageFails = false) {
  const writes: { path: string; body: unknown }[] = [];
  await page.addInitScript(({presets,storageFails}) => {
    localStorage.setItem('settings:adminKey', JSON.stringify('fixture-key'));
    sessionStorage.setItem('api-console:session-presets', JSON.stringify(presets));
    if (storageFails) { const original=Storage.prototype.setItem; Storage.prototype.setItem=function(key,value){ if(key==='api-console:session-presets') throw new DOMException('Full','QuotaExceededError'); return original.call(this,key,value); }; }
  }, {presets,storageFails});
  await page.route('**/apisix/admin/**', async route => {
    const request=route.request(); const path=new URL(request.url()).pathname.replace('/apisix/admin','');
    if(request.method()!=='GET') writes.push({path,body:request.postDataJSON()});
    if(path.startsWith('/plugins')) return route.fulfill({json:{}});
    return route.fulfill({json: path.split('/').length>2 ? {value:{id:path.split('/')[2],uri:'/saved'}} : {list:[],total:0}});
  });
  await page.goto('raw_api'); await expect(page.getByRole('button',{name:'Variables',exact:true})).toBeVisible();
  return writes;
}
async function variable(page: Page, index: number, name: string, value: string) {
  await page.getByRole('button',{name:'Add variable',exact:true}).click();
  await page.getByRole('textbox',{name:`Variable ${index} name`,exact:true}).fill(name);
  await page.getByRole('textbox',{name:`Variable ${index} value`,exact:true}).fill(value);
}
async function save(page: Page, name: string, collection: string) {
  await expect(page.getByRole('dialog', { name: 'Save session preset' })).toBeHidden();
  await page.getByRole('button',{name:'Save preset',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Save session preset'});
  await dialog.getByRole('textbox',{name:'Preset name',exact:true}).fill(name);
  await dialog.getByRole('combobox',{name:'Preset collection',exact:true}).fill(collection);
  await dialog.getByRole('button',{name:'Save preset',exact:true}).click();
}

test('variable preview prepares an unsent draft, keeps values out of storage, and blocks send shortcut', async ({page},info) => {
  const writes=await setup(page);
  await page.getByRole('combobox',{name:/Path suffix/}).fill('{{id}}');
  await page.getByRole('textbox',{name:'Query parameters'}).fill('label={{label}}');
  await uiFillMonacoEditor(page,page.locator('.monaco-editor').first(),template.body);
  await page.getByRole('button',{name:'Variables',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Resolve request variables'});
  await dialog.getByRole('button',{name:'Preview resolved request',exact:true}).click();
  await expect(dialog.getByText('Define variable: id')).toBeVisible();
  await variable(page,1,'id','variable-route'); await variable(page,2,'label','env:prod&x=1'); await variable(page,3,'uri','/quoted"value');
  await dialog.getByRole('button',{name:'Preview resolved request',exact:true}).click();
  await expect(dialog.getByText('/routes/variable-route?label=env%3Aprod%26x%3D1',{exact:true})).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('dialog',{name:/^PUT /})).toHaveCount(0); expect(writes).toEqual([]);
  await page.screenshot({path:info.outputPath('console-variables-desktop.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Use resolved request',exact:true}).click();
  await expect(page.getByRole('combobox',{name:/Path suffix/})).toHaveValue('variable-route');
  await expect(page.getByText('Unsent changes',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('quoted');
  expect(writes).toEqual([]);
  await page.getByRole('button',{name:/Send PUT/}).click(); await page.getByRole('button',{name:'Execute',exact:true}).click();
  await expect.poll(()=>writes.length).toBe(1); expect(writes[0].body).toEqual({uri:'/quoted"value'});
});

test('variable edits invalidate preview and Keep template preserves the draft on a short narrow viewport', async({page},info)=>{
  const writes=await setup(page); await page.setViewportSize({width:390,height:640});
  await page.getByRole('combobox',{name:/Path suffix/}).fill('{{id}}');
  await page.getByRole('button',{name:'Variables',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Resolve request variables'});
  await variable(page,1,'id','one'); await dialog.getByRole('button',{name:'Preview resolved request',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Use resolved request',exact:true})).toBeEnabled();
  await dialog.getByRole('textbox',{name:'Variable 1 value',exact:true}).fill('two');
  await expect(dialog.getByRole('button',{name:'Use resolved request',exact:true})).toBeDisabled();
  await dialog.getByRole('button',{name:'Preview resolved request',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Use resolved request',exact:true})).toBeInViewport({ratio:1});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('console-variables-narrow.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'Keep template',exact:true}).click();
  await expect(page.getByRole('combobox',{name:/Path suffix/})).toHaveValue('{{id}}'); expect(writes).toEqual([]);
});

test('presets with the same name coexist across collections; organize and filter without requests', async({page},info)=>{
  const writes=await setup(page,[preset('legacy')]);
  await save(page,'List routes','Development'); await save(page,'List routes','Production');
  await page.getByRole('button',{name:/Presets \(3\)/}).click();
  const drawer=page.getByRole('dialog',{name:'Session presets',exact:true});
  await expect(drawer.getByRole('button',{name:'Load preset List routes',exact:true})).toHaveCount(2);
  await drawer.getByRole('combobox',{name:'Filter preset collection'}).click(); await page.getByRole('option',{name:'Development',exact:true}).click();
  await expect(drawer.getByRole('button',{name:'Load preset List routes',exact:true})).toHaveCount(1);
  await drawer.getByRole('button',{name:'Edit preset details List routes',exact:true}).click();
  const organize=page.getByRole('dialog',{name:'Organize session preset'});
  await organize.getByRole('combobox',{name:'Collection',exact:true}).fill('Production');
  await organize.getByRole('button',{name:'Save preset details',exact:true}).click();
  await expect(organize.getByRole('alert')).toContainText('already contains');
  await organize.getByRole('textbox',{name:'Preset name',exact:true}).fill('Inspect routes');
  await organize.getByRole('button',{name:'Save preset details',exact:true}).click();
  await expect(drawer.getByRole('button',{name:'Load preset Inspect routes',exact:true})).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter'); await expect(page.getByRole('dialog',{name:/^PUT /})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('console-collections-narrow.png'),animations:'disabled'});
  expect(writes).toEqual([]);
});

test('failed preset delete and organize preserve the saved list', async({page})=>{
  await setup(page,[preset('one','Development')],true);
  await page.getByRole('button',{name:/Presets \(1\)/}).click();
  const drawer=page.getByRole('dialog',{name:'Session presets',exact:true});
  await drawer.getByRole('button',{name:'Delete preset Saved one',exact:true}).click();
  await expect(page.getByText('Could not save preset changes. The existing list is unchanged.')).toBeVisible();
  await expect(drawer.getByRole('button',{name:'Load preset Saved one',exact:true})).toBeVisible();
  await drawer.getByRole('button',{name:'Edit preset details Saved one',exact:true}).click();
  const organize=page.getByRole('dialog',{name:'Organize session preset'});
  await organize.getByRole('textbox',{name:'Preset name',exact:true}).fill('Changed'); await organize.getByRole('button',{name:'Save preset details',exact:true}).click();
  await expect(organize).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('api-console:session-presets')!)[0].name)).toBe('Saved one');
});

test('a 21st preset cannot silently evict the oldest saved request', async({page})=>{
  await setup(page,Array.from({length:20},(_,i)=>preset(String(i),'Development')));
  await save(page,'New request','Development');
  await expect(page.getByText(/The 20-preset limit is reached/)).toBeVisible();
  const names=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('api-console:session-presets')!).map((p:{name:string})=>p.name));
  expect(names).toHaveLength(20); expect(names).toContain('Saved 19'); expect(names).not.toContain('New request');
});


test('loading a preset respects draft replacement and never sends implicitly', async ({page}) => {
  const writes=await setup(page,[preset('saved','Development')]);
  await page.getByRole('combobox',{name:/Path suffix/}).fill('draft');
  await page.getByRole('button',{name:'Presets (1)',exact:true}).click();
  await page.getByRole('button',{name:'Load preset Saved saved',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'Replace request draft?'});
  await confirmation.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(page.getByRole('combobox',{name:/Path suffix/})).toHaveValue('draft');
  await page.getByRole('button',{name:'Presets (1)',exact:true}).click();
  await page.getByRole('button',{name:'Load preset Saved saved',exact:true}).click();
  await confirmation.getByRole('button',{name:'Discard and replace',exact:true}).click();
  await expect(page.getByRole('combobox',{name:/Path suffix/})).toHaveValue('saved');
  expect(writes).toEqual([]);
});

test('an explicit replacement at capacity preserves all other presets and blocks send shortcut', async ({page}) => {
  const writes=await setup(page,Array.from({length:20},(_,i)=>preset(String(i),'Development')));
  await page.getByRole('button',{name:'Save preset',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Save session preset'});
  await dialog.getByRole('textbox',{name:'Preset name',exact:true}).fill('saved 19');
  await dialog.getByRole('combobox',{name:'Preset collection',exact:true}).fill('development');
  await expect(dialog.getByRole('status')).toContainText('replaces the existing preset');
  await dialog.getByRole('textbox',{name:'Preset name',exact:true}).focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByRole('dialog',{name:/^PUT /})).toHaveCount(0);
  // Enter in the name field uses the preset dialog action; never the underlying Send action.
  await expect(dialog).toBeHidden();
  const items=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('api-console:session-presets')!));
  expect(items).toHaveLength(20); expect(items[0]).toMatchObject({name:'saved 19',collection:'Development'});
  expect(items.slice(1).map((item:{id:string})=>item.id)).toEqual(Array.from({length:19},(_,i)=>String(i)));
  expect(writes).toEqual([]);
});


test('resolved variables clear the prior response and resource-history outcome without sending', async ({ page }) => {
  await setup(page);
  let writes = 0;
  let current: Record<string, unknown> = { id: 'history-variables', uri: '/before' };
  await page.route('**/apisix/admin/routes/history-variables', async route => {
    if (route.request().method() === 'PUT') {
      writes++;
      current = { ...route.request().postDataJSON(), id: 'history-variables' };
    }
    await route.fulfill({ json: { key: '/apisix/routes/history-variables', value: current } });
  });
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('history-variables');
  await uiFillMonacoEditor(page, page.locator('.monaco-editor').first(), '{"uri":"/after"}');
  await page.getByRole('button', { name: /Send PUT/ }).click();
  await page.getByRole('button', { name: 'Execute', exact: true }).click();
  const outcome = page.getByText('Read-back verified. Resource history includes the observed before and after values.', { exact: true });
  await expect(outcome).toBeVisible();
  expect(writes).toBe(1);
  await page.getByRole('combobox', { name: /Path suffix/ }).fill('{{id}}');
  await page.getByRole('button', { name: 'Variables', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Resolve request variables' });
  await variable(page, 1, 'id', 'next-draft');
  await dialog.getByRole('button', { name: 'Preview resolved request', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use resolved request', exact: true }).click();
  await expect(outcome).toBeHidden();
  await expect(page.getByRole('combobox', { name: /Path suffix/ })).toHaveValue('next-draft');
  await expect(page.getByText('Unsent changes', { exact: true })).toBeVisible();
  expect(writes).toBe(1);
});
