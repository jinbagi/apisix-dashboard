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
import { Button, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { RESOURCE_LABELS } from '@/apis/export-import';
import type { ImportPreviewItem } from '@/apis/import-preview';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';

export const ImportChangePreview = ({ items, selectedKeys, onSelectionChange, disabled }: {
  items: ImportPreviewItem[]; selectedKeys?: string[]; onSelectionChange?: (keys: string[]) => void; disabled?: boolean;
}) => {
  const [review, setReview] = useState<ImportPreviewItem | null>(null);
  const colors = { New: 'green', Changed: 'orange', Unchanged: 'default', Blocked: 'red' };
  return (
    <>
      <Typography.Paragraph>
        Compare the exact PUT payloads before importing. Unchanged items are skipped.
        Blocked items remain errors; eligible items can still be imported.
        Select the new or changed items to apply. Each changed destination is checked again before writing. Imports can partially succeed.
      </Typography.Paragraph>
      <Table rowSelection={onSelectionChange ? {
        selectedRowKeys: selectedKeys,
        onChange: (keys) => onSelectionChange(keys.map(String)),
        getCheckboxProps: (row) => ({ disabled: disabled || !['New', 'Changed'].includes(row.status), 'aria-label': `Apply ${row.url ?? row.id}` }),
      } : undefined} size="small" rowKey="key" dataSource={items} pagination={{ pageSize: 8 }} scroll={{ x: 640 }}
        columns={[
          { title: 'Resource', key: 'resource', render: (_, row) => RESOURCE_LABELS[row.resourceType] },
          { title: 'Destination', key: 'destination', render: (_, row) => <Typography.Text style={{ overflowWrap: 'anywhere' }}>{row.url ?? row.id}</Typography.Text> },
          { title: 'Action', dataIndex: 'status', key: 'status', render: (status: ImportPreviewItem['status']) => <Tag color={colors[status]}>{status}</Tag> },
          { title: 'Details', key: 'details', render: (_, row) => row.error
            ? <Typography.Text type="danger">{row.error}</Typography.Text>
            : <Button size="small" onClick={() => setReview(row)}>Compare JSON</Button> },
        ]} />
      <JsonChangeReview open={review !== null} title="Import JSON comparison"
        description={`${review?.url ?? ''} — current configuration on the left; imported payload on the right. Fields absent from the imported payload may be removed by PUT.`}
        original={JSON.stringify(review?.before ?? {}, null, 2)} modified={JSON.stringify(review?.after ?? {}, null, 2)}
        confirmText="Back to import preview" onCancel={() => setReview(null)} onSave={() => setReview(null)} />
    </>
  );
};

