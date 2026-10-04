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
import { Alert, Button, Grid, Input, message, Space, Table, Tag, Typography, Upload } from 'antd';
import { useMemo } from 'react';

import { environmentMappingRows, mapImportEnvironment, parseIdMappings, updateIdMapping } from '@/apis/environment-import';
import { type ExportData, RESOURCE_LABELS } from '@/apis/export-import';
import { downloadJson } from '@/utils/downloadJson';

export const EnvironmentIdMapping = ({ data, text, onChange, disabled }: {
  data: ExportData; text: string; onChange: (text: string) => void; disabled: boolean;
}) => {
  const screens = Grid.useBreakpoint();
  const narrow = !screens.md;
  const state = useMemo(() => {
    let error = ''; let rows: ReturnType<typeof environmentMappingRows> = [];
    try { rows = environmentMappingRows(data, text); mapImportEnvironment(data, text); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid ID mappings'; }
    return { rows, error };
  }, [data, text]);
  return <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
    <Typography.Paragraph style={{ margin: 0 }}>
      Map resource IDs and reference-only IDs before comparing with {window.location.origin}.
      Leave a destination blank to retain its original ID. Supported plugin references and child owners follow these mappings.
      Other plugin-internal IDs remain unchanged.
    </Typography.Paragraph>
    {state.error && <Alert type="error" showIcon title={state.error} />}
    <Table size="small" rowKey="key" dataSource={state.rows} pagination={{ pageSize: 6, showSizeChanger: false }} scroll={narrow ? undefined : { x: 650 }}
      columns={narrow ? [{ title: 'ID mapping', key: 'mapping', render: (_, row) => <Space orientation="vertical" size={6} style={{ width: '100%' }}>
        <Typography.Text strong>{RESOURCE_LABELS[row.kind]}</Typography.Text>
        <Typography.Text style={{ overflowWrap: 'anywhere' }}>Source: {row.source}</Typography.Text>
        <Input aria-label={`Destination ${row.kind}/${row.source}`} value={row.destination} placeholder={`Keep ${row.source}`}
          disabled={disabled} onChange={(event) => onChange(updateIdMapping(text, row.kind, row.source, event.target.value))} />
        <Typography.Text type="secondary">{row.contexts.includes('Resource in file') ? 'Resource in file' : 'Reference or explicit mapping'}</Typography.Text>
      </Space> }] : [
        { title: 'Resource', key: 'kind', width: 130, render: (_, row) => RESOURCE_LABELS[row.kind] },
        { title: 'Source ID', key: 'source', width: 200, render: (_, row) => <Space orientation="vertical" size={2}>
          <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{row.source}</Typography.Text>
          <Typography.Text type="secondary">{row.contexts.includes('Resource in file') ? 'Resource in file' : 'Reference or explicit mapping'}</Typography.Text>
        </Space> },
        { title: 'Destination ID', key: 'destination', width: 230, render: (_, row) => <Input
          aria-label={`Destination ${row.kind}/${row.source}`} value={row.destination} placeholder={row.source}
          disabled={disabled} onChange={(event) => onChange(updateIdMapping(text, row.kind, row.source, event.target.value))} /> },
        { title: 'Mapping', key: 'mapping', width: 90, render: (_, row) => <Tag color={row.destination && row.destination !== row.source ? 'blue' : 'default'}>
          {row.destination && row.destination !== row.source ? 'Remapped' : 'Keep ID'}
        </Tag> },
      ]} />
    <Space wrap>
      <Button disabled={disabled || !!state.error} onClick={() => downloadJson(parseIdMappings(text), 'apisix-id-mappings.json')}>Export mapping JSON</Button>
      <Upload accept=".json" showUploadList={false} disabled={disabled} beforeUpload={async (file) => {
        try { onChange(await file.text()); }
        catch { message.error('Could not read the mapping JSON file.'); }
        return false;
      }}><Button disabled={disabled}>Import mapping JSON</Button></Upload>
      <Button disabled={disabled} onClick={() => onChange('{}')}>Reset mappings</Button>
    </Space>
    <Typography.Text strong>Mapping JSON</Typography.Text>
    <Input.TextArea aria-label="Environment ID mappings" rows={4} value={text} disabled={disabled}
      onChange={(event) => onChange(event.target.value)} />
  </Space>;
};
