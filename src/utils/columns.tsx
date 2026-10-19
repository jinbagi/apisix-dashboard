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
import { Button, Popover, Tag } from 'antd';
import dayjs from 'dayjs';

import { TableValueTag } from '@/components/TableValueTag';

const MAX_VISIBLE_PLUGINS = 3;

type PluginListItem = {
  value?: {
    plugins?: Record<string, unknown>;
  };
};

export const getPluginFilterOptions = <T extends PluginListItem>(list?: T[]) => {
  const names = new Set<string>();

  for (const item of list ?? []) {
    for (const name of Object.keys(item.value?.plugins ?? {})) {
      names.add(name);
    }
  }

  if (names.size === 0) return undefined;
  return Array.from(names).sort().map((name) => ({ text: name, value: name }));
};

export const hasPluginName = (
  plugins: Record<string, unknown> | undefined,
  value: unknown
) => !!plugins && Object.prototype.hasOwnProperty.call(plugins, String(value));

export const renderPluginCount = (
  plugins: Record<string, unknown> | undefined
) => {
  if (!plugins) return '-';
  const names = Object.keys(plugins).sort();
  if (names.length === 0) return '-';

  const visible = names.slice(0, MAX_VISIBLE_PLUGINS);
  const remaining = names.length - MAX_VISIBLE_PLUGINS;

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 3, maxWidth: '100%' }}>
      {visible.map((n) => (
        <TableValueTag key={n} value={n} style={{ margin: 0, fontSize: 'var(--app-font-size-xs)' }} />
      ))}
      {remaining > 0 && (
        <Popover
          title={`${names.length} plugins`}
          trigger={['hover', 'click']}
          content={
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 360 }}>
              {names.map((name) => (
                <Tag key={name} style={{ margin: 0 }}>
                  {name}
                </Tag>
              ))}
            </div>
          }
        >
          <Button
            type="link"
            size="small"
            aria-label={`Show all ${names.length} plugins`}
            style={{ height: 22, padding: '0 4px', fontSize: 'var(--app-font-size-xs)' }}
          >
            +{remaining}
          </Button>
        </Popover>
      )}
    </span>
  );
};

export const renderUnixDateTime = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return '-';
  return dayjs.unix(n).format('YYYY-MM-DD HH:mm:ss');
};

export const unixFieldSorter = <T extends { value?: Record<string, unknown> }>(
  field: string
) => {
  return (a: T, b: T) => {
    const aNum = Number(a.value?.[field] ?? 0);
    const bNum = Number(b.value?.[field] ?? 0);
    return aNum - bNum;
  };
};
