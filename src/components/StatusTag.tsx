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
import { useQuery } from '@tanstack/react-query';
import { Button, Switch, Tag } from 'antd';
import { useEffect, useState } from 'react';

import { formHistoryReq } from '@/apis/tracked-resource-write';
import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { showNotification } from '@/utils/notification';

export const StatusTag = ({ status }: { status?: 0 | 1 }) => {
  if (status === 1) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="pulsing-dot-success" />
        <Tag color="success">Enabled</Tag>
      </div>
    );
  }
  if (status === 0) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span className="pulsing-dot-inactive" />
        <Tag color="default">Disabled</Tag>
      </div>
    );
  }
  return <Tag>Unknown</Tag>;
};

type StatusSwitchProps = {
  /** Current status; if omitted, it is loaded from the Admin API. */
  status?: 0 | 1;
  api: string;
};

export const StatusSwitch = ({ status: statusProp, api }: StatusSwitchProps) => {
  const [loading, setLoading] = useState(false);
  const [confirmedStatus, setConfirmedStatus] = useState<0 | 1 | undefined>(
    statusProp
  );

  const {
    data: fetchedStatus,
    isError: statusError,
    isFetching: statusFetching,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['status', api],
    queryFn: () =>
      req
        .get(api)
        .then(
          (response) =>
            (response.data?.value?.status as 0 | 1 | null | undefined) ?? null
        ),
    enabled: statusProp === undefined,
    staleTime: 10_000,
  });

  useEffect(() => {
    const nextStatus = statusProp ?? fetchedStatus;
    if (nextStatus !== undefined && nextStatus !== null) {
      setConfirmedStatus(nextStatus);
    } else if (nextStatus === null) {
      setConfirmedStatus(1);
    }
  }, [fetchedStatus, statusProp]);

  if (confirmedStatus === undefined && statusError) {
    return (
      <Button
        type="link"
        danger
        size="small"
        loading={statusFetching}
        onClick={() => void refetchStatus()}
      >
        Status unavailable · Retry
      </Button>
    );
  }

  if (confirmedStatus === undefined) return <Tag>Loading status...</Tag>;

  const handleToggle = async (checked: boolean) => {
    if (loading) return;
    const nextStatus = checked ? 1 : 0;
    setLoading(true);
    try {
      await formHistoryReq.patch(api, { status: nextStatus });
      setConfirmedStatus(nextStatus);
      await queryClient.invalidateQueries();
      showNotification({
        message: `Status changed to ${checked ? 'Enabled' : 'Disabled'} and verified`,
        type: 'success',
      });
    } catch {
      showNotification({
        message:
          'Status change could not be verified. The last confirmed state is still shown.',
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        className={
          confirmedStatus === 1
            ? 'pulsing-dot-success'
            : 'pulsing-dot-inactive'
        }
      />
      <Switch
        checked={confirmedStatus === 1}
        onChange={handleToggle}
        loading={loading}
        aria-label={`Status for ${api}`}
        checkedChildren="On"
        unCheckedChildren="Off"
        size="small"
      />
    </div>
  );
};
