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
import { useMutation } from '@tanstack/react-query';
import { Alert, Button } from 'antd';
import { toJS } from 'mobx';
import { useLocalObservable } from 'mobx-react-lite';
import { difference } from 'rambdax';
import { useDeepCompareEffect } from 'react-use';

import { deletePluginMetadataReq, putPluginMetadataReq } from '@/apis/plugins';
import { trackResourceWrite } from '@/apis/tracked-resource-write';
import type { PluginCardProps } from '@/components/form-slice/FormItemPlugins/PluginCard';
import {
  PluginCardList,
  PluginCardListSearch,
} from '@/components/form-slice/FormItemPlugins/PluginCardList';
import {
  type PluginConfig,
  PluginEditorDrawer,
} from '@/components/form-slice/FormItemPlugins/PluginEditorDrawer';
import { SelectPluginsDrawer } from '@/components/form-slice/FormItemPlugins/SelectPluginsDrawer';
import { API_PLUGIN_METADATA } from '@/config/constant';
import { stripSystemReadonlyFields } from '@/utils/apisixEditable';
import { showNotification } from '@/utils/notification';

import { type PluginInfo, usePluginMetadataList } from './hooks';
import classes from './PluginMetadata.module.css';

export const PluginMetadata = () => {
  const getMetadataListReq = usePluginMetadataList();
  const putMetadata = useMutation({
    mutationFn: async (variables: Parameters<typeof putPluginMetadataReq>[0]) => (await trackResourceWrite({
      source: 'form', method: 'PUT', api: `${API_PLUGIN_METADATA}/${variables.name}`,
      body: stripSystemReadonlyFields(variables.config),
    }, () => putPluginMetadataReq(variables))).response,
    async onSuccess(_, variables) {
      await getMetadataListReq.refetch();
      showNotification({
        message: `Plugin Metadata for ${variables.name} saved and verified`,
        type: 'success',
      });
    },
  });
  const deleteMetadata = useMutation({
    mutationFn: async (name: string) => (await trackResourceWrite({
      source: 'form', method: 'DELETE', api: `${API_PLUGIN_METADATA}/${name}`,
    }, () => deletePluginMetadataReq(name))).response,
    async onSuccess(_, name) {
      await getMetadataListReq.refetch();
      showNotification({
        message: `Plugin Metadata for ${name} deleted and verified`,
        type: 'success',
      });
    },
    onError(_, name) {
      showNotification({
        message: `Plugin Metadata deletion for ${name} failed or could not be verified`,
        type: 'error',
      });
    },
  });

  const pluginsOb = useLocalObservable(() => ({
    __map: new Map<string, PluginConfig>(),
    __schemaMap: new Map<string, object>(),
    init(map: Map<string, PluginInfo>, hasConfigNames: string[]) {
      // we need to clear the map first
      this.__map.clear();
      this.__schemaMap.clear();
      this.allPluginNames = [];
      for (const [name, info] of map.entries()) {
        if (hasConfigNames.includes(name)) {
          this.__map.set(name, info);
        }
        this.__schemaMap.set(name, info.schema);
        this.allPluginNames.push(name);
      }
    },
    delete(name: string) {
      void deleteMetadata.mutateAsync(name).catch(() => {});
    },
    async update(config: PluginConfig) {
      await putMetadata.mutateAsync(config);
    },
    allPluginNames: [] as string[],
    get selected() {
      return Array.from(this.__map.keys());
    },
    get unSelected() {
      return difference(this.allPluginNames, this.selected);
    },
    curPlugin: {} as PluginConfig,
    curPluginSchema: {} as object,
    setCurPlugin(name: string) {
      this.curPlugin = this.__map.get(name) || { name, config: {} };
      this.curPluginSchema = this.__schemaMap.get(name)!;
      this.setEditorOpened(true);
    },
    editorOpened: false,
    setEditorOpened(val: boolean) {
      this.editorOpened = val;
    },
    closeEditor() {
      this.setEditorOpened(false);
      this.setSelectPluginsOpened(false);
      this.curPlugin = {} as PluginConfig;
    },
    search: '',
    setSearch(val: string) {
      this.search = val;
    },
    mode: 'edit' as PluginCardProps['mode'],
    selectPluginsOpened: false,
    setSelectPluginsOpened(val: boolean) {
      this.selectPluginsOpened = val;
    },
    on(mode: PluginCardProps['mode'], name: string) {
      this.setCurPlugin(name);
      this.mode = mode;
    },
  }));

  const { pluginInfoMap, hasConfigNames, isLoading } = getMetadataListReq;
  // init the selected plugins
  useDeepCompareEffect(() => {
    if (isLoading) return;
    pluginsOb.init(pluginInfoMap, hasConfigNames);
  }, [pluginInfoMap, hasConfigNames, pluginsOb, isLoading]);

  return (
    <>
      {getMetadataListReq.isError && (
        <Alert
          type="warning"
          showIcon
          message="Plugin metadata catalog is unavailable"
          description="The page remains available, but metadata cannot be listed or added until APISIX returns the plugin schema catalog."
          action={
            <Button size="small" onClick={getMetadataListReq.refetch}>
              Retry
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}
      <div className={classes.toolbar}>
        <PluginCardListSearch
          search={pluginsOb.search}
          setSearch={pluginsOb.setSearch}
        />
        <SelectPluginsDrawer
          plugins={pluginsOb.unSelected}
          onAdd={(name) => pluginsOb.on('add', name)}
          opened={pluginsOb.selectPluginsOpened}
          setOpened={pluginsOb.setSelectPluginsOpened}
          disabled={getMetadataListReq.isError || isLoading}
        />
      </div>
      <PluginCardList
        mode="edit"
        placeholder="Search Plugin Metadata"
        mah="60vh"
        search={pluginsOb.search}
        plugins={pluginsOb.selected}
        emptyDescription="No plugin metadata configured"
        onDelete={pluginsOb.delete}
        onEdit={(name) => pluginsOb.on('edit', name)}
      />
      <PluginEditorDrawer
        mode={pluginsOb.mode}
        schema={toJS(pluginsOb.curPluginSchema)}
        opened={pluginsOb.editorOpened}
        onClose={pluginsOb.closeEditor}
        plugin={toJS(pluginsOb.curPlugin)}
        onSave={pluginsOb.update}
      />
    </>
  );
};
