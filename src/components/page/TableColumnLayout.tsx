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
import { Button, Checkbox, InputNumber, Select } from 'antd';

import type { ColumnPin, TablePresentation } from '@/utils/tablePresentation';
import IconArrowDown from '~icons/material-symbols/arrow-downward';
import IconArrowUp from '~icons/material-symbols/arrow-upward';

export type LayoutColumn = { key: string; title: string; width: number };

export function TableColumnLayout({ columns, view, visibleKeys, primaryKey, onChange }: {
  columns: LayoutColumn[];
  view: TablePresentation;
  visibleKeys: string[];
  primaryKey: string;
  onChange: (view: TablePresentation) => void;
}) {
  const anchors = ['raw', primaryKey, 'option'];
  const move = (key: string, direction: number) => {
    const keys = columns.map((column) => column.key);
    const index = keys.indexOf(key);
    [keys[index], keys[index + direction]] = [keys[index + direction], keys[index]];
    onChange({ ...view, order: keys });
  };
  return (
    <div className="resource-table-column-layout">
      <p className="resource-table-muted">RAW and resource identity stay first. Move columns within their pin group. Pins release on narrow tables to leave room for other columns.</p>
      <div className="resource-table-columns">
        {columns.map((column, index) => {
          const required = anchors.includes(column.key);
          const movable = !required;
          const pin = view.pins?.[column.key] ?? 'none';
          const canMove = (offset: number) => {
            const neighbor = columns[index + offset];
            return movable && neighbor && !anchors.includes(neighbor.key) && (view.pins?.[neighbor.key] ?? 'none') === pin;
          };
          return (
            <div className="resource-table-column-setting" key={column.key} role="group" aria-label={`${column.title} column`}>
              <Checkbox checked={required || visibleKeys.includes(column.key)} disabled={required} onChange={(event) => onChange({ ...view, columns: event.target.checked ? [...visibleKeys, column.key] : visibleKeys.filter((key) => key !== column.key) })}>{column.title}</Checkbox>
              <div className="resource-table-column-actions">
                <Button size="small" icon={<IconArrowUp />} aria-label={`Move ${column.title} earlier`} disabled={!canMove(-1)} onClick={() => move(column.key, -1)} />
                <Button size="small" icon={<IconArrowDown />} aria-label={`Move ${column.title} later`} disabled={!canMove(1)} onClick={() => move(column.key, 1)} />
              </div>
              <label className="resource-table-column-width">
                <span>Width (px)</span>
                <InputNumber aria-label={`${column.title} width`} size="small" min={column.key === primaryKey ? 180 : 80} max={600} step={20} precision={0} disabled={column.key === 'raw'} value={column.width} onChange={(width) => {
                  const widths = { ...view.widths };
                  if (width === null) delete widths[column.key];
                  else widths[column.key] = Math.max(column.key === primaryKey ? 180 : 80, Math.min(600, width));
                  onChange({ ...view, widths });
                }} />
              </label>
              <label className="resource-table-column-pin">
                <span>Pin</span>
                <Select<ColumnPin> aria-label={`${column.title} pin`} size="small" virtual={false} disabled={required} value={column.key === 'raw' || column.key === primaryKey ? 'left' : pin} options={[{ value: 'none', label: 'Scroll' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(value) => onChange({ ...view, pins: { ...view.pins, [column.key]: value } })} />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
