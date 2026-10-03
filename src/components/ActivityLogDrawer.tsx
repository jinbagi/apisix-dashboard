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
import { Badge, Button, Drawer, Empty, Space, Tag, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import { useAtomValue } from 'jotai';
import { useState } from 'react';

import { ResourceHistory } from '@/components/page/ResourceHistory';
import {
  activityLogAtom,
  type ActivityLogEntry,
  clearActivityLog,
  clearUnreadErrors,
  unreadErrorCountAtom,
} from '@/stores/activityLog';
import IconHistory from '~icons/material-symbols/history';

const TAG_COLORS: Record<ActivityLogEntry['type'], string> = {
  success: 'success',
  error: 'error',
  warning: 'warning',
  info: 'processing',
};

const TIMELINE_COLORS: Record<ActivityLogEntry['type'], string> = {
  success: 'green',
  error: 'red',
  warning: 'orange',
  info: 'blue',
};

export const ActivityLogButton = () => {
  const [open, setOpen] = useState(false);
  const entries = useAtomValue(activityLogAtom);
  const unreadCount = useAtomValue(unreadErrorCountAtom);

  const handleOpen = () => {
    setOpen(true);
    clearUnreadErrors();
  };

  return (
    <>
      <Badge count={unreadCount} size="small" offset={[-4, 4]}>
        <Button
          type="text"
          size="small"
          icon={<IconHistory />}
          onClick={handleOpen}
          aria-label="Activity Log"
          title="Activity Log"
        />
      </Badge>
      <Drawer
        title="Activity Log"
        placement="right"
        styles={{ wrapper: { width: 420 } }}
        open={open}
        onClose={() => setOpen(false)}
        extra={
          <Button size="small" onClick={clearActivityLog} disabled={entries.length === 0}>
            Clear
          </Button>
        }
      >
        <div style={{ marginBottom: 16 }}><ResourceHistory /></div>
        {entries.length === 0 ? (
          <Empty description="No activity yet" />
        ) : (
          <Timeline
            items={entries.map((entry) => ({
              key: entry.id,
              color: TIMELINE_COLORS[entry.type],
              children: (
                <div>
                  <Space size={4} style={{ marginBottom: 2 }}>
                    <Tag
                      color={TAG_COLORS[entry.type]}
                      style={{ margin: 0, fontSize: 'var(--app-font-size-xs)', lineHeight: '18px', padding: '0 4px' }}
                    >
                      {entry.type.toUpperCase()}
                    </Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 'var(--app-font-size-xs)' }}>
                      {dayjs(entry.timestamp).format('HH:mm:ss')}
                    </Typography.Text>
                  </Space>
                  <Typography.Text
                    style={{ display: 'block', fontSize: 'var(--app-font-size-base)', wordBreak: 'break-word' }}
                  >
                    {entry.message}
                  </Typography.Text>
                </div>
              ),
            }))}
          />
        )}
      </Drawer>
    </>
  );
};
