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
import { Input, Tooltip } from 'antd';
import { useCallback, useEffect, useId, useState } from 'react';

import IconLabel from '~icons/material-symbols/label';

type LabelSearchInputProps = {
  onSearch: (value: string) => void;
  defaultValue?: string;
};

export const LabelSearchInput = ({
  onSearch,
  defaultValue = '',
}: LabelSearchInputProps) => {
  const [value, setValue] = useState(defaultValue);
  const id = useId();

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  const handleSearch = useCallback(
    (val: string) => {
      onSearch(val.trim());
    },
    [onSearch],
  );

  return (
    <div className="resource-table-field resource-table-field-label">
      <label htmlFor={id}>Label</label>
      <Tooltip
        title="Use env to match a label key, or env:prod to match its exact value."
        placement="bottom"
      >
        <Input.Search
          id={id}
          prefix={<IconLabel style={{ opacity: 0.45 }} />}
          placeholder="env:prod"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onSearch={handleSearch}
          allowClear
          onClear={() => {
            setValue('');
            handleSearch('');
          }}
        />
      </Tooltip>
    </div>
  );
};
