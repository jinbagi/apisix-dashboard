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
import { Select } from 'antd';
import { useEffect, useId, useMemo } from 'react';

type ResourceSortSelectProps = {
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  onChange: (next: { sort_by: string; sort_order: 'asc' | 'desc' }) => void;
  fields?: SortField[];
};

type SortField = {
  label: string;
  value: string;
};

const DEFAULT_FIELDS: SortField[] = [
  { label: 'ID', value: 'id' },
  { label: 'Name', value: 'name' },
];

const TIME_OPTIONS = [
  { label: 'Created At (oldest first)', value: 'create_time:asc' },
  { label: 'Created At (newest first)', value: 'create_time:desc' },
  { label: 'Updated At (oldest first)', value: 'update_time:asc' },
  { label: 'Updated At (newest first)', value: 'update_time:desc' },
];

const buildFieldOptions = (fields: SortField[]) =>
  fields.flatMap((field) => [
    { label: `${field.label} (A-Z)`, value: `${field.value}:asc` },
    { label: `${field.label} (Z-A)`, value: `${field.value}:desc` },
  ]);

export const ResourceSortSelect = ({
  sortBy,
  sortOrder,
  onChange,
  fields = DEFAULT_FIELDS,
}: ResourceSortSelectProps) => {
  const id = useId();
  const options = useMemo(
    () => [...TIME_OPTIONS, ...buildFieldOptions(fields)],
    [fields],
  );
  const currentValue = `${sortBy}:${sortOrder}`;
  const selectedValue = options.some((option) => option.value === currentValue)
    ? currentValue
    : options[0].value;

  useEffect(() => {
    if (selectedValue === currentValue) return;
    const [sort_by, sort_order] = selectedValue.split(':') as [
      string,
      'asc' | 'desc',
    ];
    onChange({ sort_by, sort_order });
  }, [currentValue, onChange, selectedValue]);

  return (
    <div className="resource-table-field resource-table-field-sort">
      <label htmlFor={id}>Sort results</label>
      <Select
        id={id}
        virtual={false}
        value={selectedValue}
        options={options}
        onChange={(value) => {
          const [sort_by, sort_order] = value.split(':') as [
            string,
            'asc' | 'desc',
          ];
          onChange({ sort_by, sort_order });
        }}
      />
    </div>
  );
};
