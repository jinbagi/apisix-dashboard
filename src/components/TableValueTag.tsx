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
import { Tag, type TagProps, Tooltip } from 'antd';

import classes from './TableValueTag.module.css';

type TableValueTagProps = Omit<TagProps, 'children'> & { value: string };

/** Keep long tag values compact without losing hover or keyboard access. */
export const TableValueTag = ({ value, className, ...props }: TableValueTagProps) => (
  <Tooltip title={value} trigger={['hover', 'focus']}>
    <Tag {...props} className={[classes.tag, className].filter(Boolean).join(' ')} tabIndex={0} aria-label={value}>
      <span className={classes.text}>{value}</span>
    </Tag>
  </Tooltip>
);
