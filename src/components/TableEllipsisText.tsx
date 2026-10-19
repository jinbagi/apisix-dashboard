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
import { Tooltip, Typography } from 'antd';
import { useRef, useState } from 'react';

type TableEllipsisTextProps = {
  value: string;
  displayValue?: string;
  code?: boolean;
  strong?: boolean;
  keyboardAccessible?: boolean;
};

export const TableEllipsisText = ({
  value,
  displayValue,
  code,
  strong,
  keyboardAccessible = false,
}: TableEllipsisTextProps) => {
  const textRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  const checkTruncation = () => {
    const element = textRef.current;
    setTruncated(
      (displayValue !== undefined && displayValue !== value) ||
      (!!element && element.scrollWidth > element.clientWidth)
    );
  };

  return (
    <Tooltip title={keyboardAccessible || truncated ? value : undefined} trigger={keyboardAccessible ? ['hover', 'focus'] : ['hover']}>
      <Typography.Text
        ref={textRef}
        code={code}
        strong={strong}
        ellipsis
        tabIndex={keyboardAccessible ? 0 : undefined}
        onMouseEnter={checkTruncation}
        onFocus={checkTruncation}
        style={{ display: 'block', maxWidth: '100%', fontSize: code ? 12 : undefined }}
      >
        {displayValue ?? value}
      </Typography.Text>
    </Tooltip>
  );
};
