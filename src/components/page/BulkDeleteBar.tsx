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
import { Button, Modal, Space, Typography } from 'antd';
import { useState } from 'react';

import { queryClient } from '@/config/global';
import { req } from '@/config/req';
import { verifyAdminApiField } from '@/utils/adminApiVerification';
import { checkDependenciesForIds } from '@/utils/checkDependencies';
import { showNotification } from '@/utils/notification';

type BulkDeleteBarProps = {
  selectedCount: number;
  resourceName: string;
  apiBase: string;
  selectedIds: string[];
  onComplete: (failedIds?: string[]) => void;
  onClear: () => void;
  showStatusActions?: boolean;
};

export const BulkDeleteBar = ({
  selectedCount,
  resourceName,
  apiBase,
  selectedIds,
  onComplete,
  onClear,
  showStatusActions = false,
}: BulkDeleteBarProps) => {
  const [loading, setLoading] = useState(false);

  if (selectedCount === 0) return null;

  const verifyDeleteDependencies = async () => {
    if (resourceName !== 'Upstream' && resourceName !== 'Service') return true;

    setLoading(true);
    try {
      const affectedById = await checkDependenciesForIds(
        resourceName,
        selectedIds
      );
      const allAffected = Object.fromEntries(
        Object.entries(affectedById).filter(
          ([, affected]) => affected.length > 0
        )
      );

      if (Object.keys(allAffected).length === 0) return true;

      Modal.warning({
        centered: true,
        title: `Cannot delete referenced ${resourceName}(s)`,
        content: (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <Typography.Paragraph>
              Remove these references before deleting the selected resources.
            </Typography.Paragraph>
            {Object.entries(allAffected).map(([id, list]) => (
              <div key={id} style={{ marginBottom: 8 }}>
                <Typography.Text strong>{id}</Typography.Text>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {list.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ))}
          </div>
        ),
      });
      return false;
    } catch {
      showNotification({
        message: `Delete blocked: could not verify whether the selected ${resourceName}(s) are referenced. Retry after APISIX is reachable.`,
        type: 'error',
      });
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!(await verifyDeleteDependencies())) return;

    Modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      title: `Delete ${selectedCount} ${resourceName}(s)`,
      content: (
        <Typography.Text>
          Are you sure you want to delete {selectedCount} selected{' '}
          {resourceName}(s)? This action cannot be undone.
        </Typography.Text>
      ),
      okText: 'Delete All',
      cancelText: 'Cancel',
      onOk: async () => {
        setLoading(true);
        let successCount = 0;
        const errors: Array<{ id: string; message: string }> = [];

        for (const id of selectedIds) {
          try {
            await req.delete(`${apiBase}/${id}`);
            successCount++;
          } catch (error) {
            errors.push({
              id,
              message: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        setLoading(false);

        if (errors.length === 0) {
          showNotification({
            message: `Successfully deleted ${successCount} ${resourceName}(s)`,
            type: 'success',
          });
        } else {
          showNotification({
            message: `Deleted ${successCount}/${selectedIds.length}. ${errors.length} failed.`,
            type: 'error',
          });
        }

        await queryClient.invalidateQueries();
        onComplete(errors.map((error) => error.id));
      },
    });
  };

  const handleBulkStatus = (status: 0 | 1) => {
    const label = status === 1 ? 'Enable' : 'Disable';
    Modal.confirm({
      centered: true,
      title: `${label} ${selectedCount} ${resourceName}(s)`,
      content: (
        <Typography.Text>
          {label} {selectedCount} selected {resourceName}(s)?
        </Typography.Text>
      ),
      okText: label,
      cancelText: 'Cancel',
      onOk: async () => {
        setLoading(true);
        let successCount = 0;
        const errors: Array<{ id: string; message: string }> = [];

        for (const id of selectedIds) {
          try {
            await req.patch(`${apiBase}/${id}`, { status });
            await verifyAdminApiField(`${apiBase}/${id}`, 'status', status);
            successCount++;
          } catch (error) {
            errors.push({
              id,
              message: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        setLoading(false);

        if (errors.length === 0) {
          showNotification({
            message: `${label}d and verified ${successCount} ${resourceName}(s)`,
            type: 'success',
          });
        } else {
          const errorSummary = errors
            .slice(0, 3)
            .map((error) => `${error.id}: ${error.message}`)
            .join('; ');
          showNotification({
            message: `${label}d and verified ${successCount}/${selectedIds.length}. ${errors.length} failed: ${errorSummary}`,
            type: 'error',
          });
        }

        await queryClient.invalidateQueries();
        onComplete(errors.map((error) => error.id));
      },
    });
  };

  return (
    <div className="bulk-delete-bar-inline" role="region" aria-label="Selected resource actions">
      <Typography.Text>
        Selected{' '}
        <Typography.Text
          strong
          style={{ color: 'var(--ant-color-primary)' }}
        >
          {selectedCount}
        </Typography.Text>{' '}
        item(s)
      </Typography.Text>
      <Space size="middle">
        <Button size="middle" disabled={loading} onClick={onClear}>
          Clear
        </Button>
        {showStatusActions && (
          <>
            <Button
              size="middle"
              loading={loading}
              onClick={() => handleBulkStatus(1)}
            >
              Enable
            </Button>
            <Button
              size="middle"
              loading={loading}
              onClick={() => handleBulkStatus(0)}
            >
              Disable
            </Button>
          </>
        )}
        <Button
          size="middle"
          danger
          type="primary"
          loading={loading}
          onClick={handleBulkDelete}
        >
          Delete
        </Button>
      </Space>
    </div>
  );
};
