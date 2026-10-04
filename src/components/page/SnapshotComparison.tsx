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
import { Alert, Button, Card, Col, Collapse, Grid, Input, Modal, Row, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import { useMemo, useRef, useState } from 'react';

import { IMPORT_ORDER, RESOURCE_LABELS } from '@/apis/export-import';
import { JsonChangeReview } from '@/components/form/JsonChangeReview';
import { downloadJson } from '@/utils/downloadJson';
import { compareConfigurationSnapshots, type ConfigurationSnapshot, parseConfigurationSnapshot, snapshotComparisonReport, type SnapshotDifference, snapshotJson, type SnapshotStatus } from '@/utils/snapshotComparison';

type FileState = { name?: string; data?: ConfigurationSnapshot; error?: string; loading?: boolean };
const statuses: SnapshotStatus[] = ['Added', 'Removed', 'Changed', 'Unchanged', 'Not comparable'];
const colors = { Added: 'green', Removed: 'red', Changed: 'orange', Unchanged: 'default', 'Not comparable': 'gold' };

export const SnapshotComparison = () => {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<Record<'before' | 'after', FileState>>({ before: {}, after: {} });
  const versions = useRef({ before: 0, after: 0 });
  const [status, setStatus] = useState<string>('Differences');
  const [kind, setKind] = useState<string>('All resources');
  const [search, setSearch] = useState('');
  const [review, setReview] = useState<SnapshotDifference | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const narrow = !Grid.useBreakpoint().md;
  const comparison = useMemo(() => files.before.data && files.after.data ? compareConfigurationSnapshots(files.before.data, files.after.data) : null, [files]);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return comparison?.items.filter((row) => (status === 'All results' || status === 'Differences' ? status !== 'Differences' || row.status !== 'Unchanged' : row.status === status) &&
      (kind === 'All resources' || row.resourceType === kind) && (!query || `${row.url} ${RESOURCE_LABELS[row.resourceType]} ${row.paths.join(' ')}`.toLowerCase().includes(query))) ?? [];
  }, [comparison, status, kind, search]);
  const close = () => {
    versions.current.before++; versions.current.after++;
    setOpen(false); setFiles({ before: {}, after: {} }); setReview(null); setDownloadOpen(false);
    setStatus('Differences'); setKind('All resources'); setSearch('');
  };
  const upload = async (side: 'before' | 'after', file: File) => {
    const version = ++versions.current[side];
    setReview(null);
    setFiles((current) => ({ ...current, [side]: { name: file.name, loading: true } }));
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a snapshot smaller than 10 MiB.');
      const data = parseConfigurationSnapshot(await file.text(), file.name);
      if (versions.current[side] === version) setFiles((current) => ({ ...current, [side]: { name: file.name, data } }));
    } catch (error) {
      if (versions.current[side] === version) setFiles((current) => ({ ...current, [side]: { name: file.name, error: error instanceof Error ? error.message : 'Could not read snapshot' } }));
    }
    return false;
  };
  const details = (row: SnapshotDifference) => <Space orientation="vertical" size={4} style={{ width: '100%' }}>
    {row.paths.length > 0 && <Typography.Text type="secondary" style={{ overflowWrap: 'anywhere' }}>{row.paths.slice(0, 3).join(', ')}{row.paths.length > 3 ? ` +${row.paths.length - 3} more` : ''}</Typography.Text>}
    {row.status === 'Not comparable' && <Typography.Text type="secondary">The other file omitted or skipped this collection.</Typography.Text>}
    <Button size="small" onClick={() => setReview(row)} aria-label={`Review snapshot ${row.url}`}>Review JSON</Button>
  </Space>;
  return <>
    <Button onClick={() => setOpen(true)}>Compare snapshots</Button>
    <Modal title="Compare configuration snapshots" open={open} onCancel={close} width={1150} style={{ top: narrow ? 16 : 24 }}
      styles={{ body: { maxHeight: narrow ? 'calc(100dvh - 250px)' : 'calc(100vh - 180px)', overflowY: 'auto' } }} destroyOnHidden
      footer={<Space wrap><Button disabled={!comparison} onClick={() => setDownloadOpen(true)}>Download comparison report</Button><Button onClick={close}>Close comparison</Button></Space>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph style={{ marginBottom: 0 }}>Compare two exported JSON files locally. Nothing is sent to the Admin API or saved in browser storage. Added and Removed describe file contents; absence from a file does not prove deletion from a gateway.</Typography.Paragraph>
        <Row gutter={[12, 12]} style={{ width: '100%', margin: 0 }}>
          {(['before', 'after'] as const).map((side) => <Col xs={24} md={12} key={side} style={{ paddingLeft: 0 }}>
            <Card size="small" title={side === 'before' ? 'Before snapshot' : 'After snapshot'}>
              <Space orientation="vertical" style={{ width: '100%' }}>
                <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(file) => upload(side, file)}>
                  <Button loading={files[side].loading}>Choose {side} snapshot</Button>
                </Upload>
                {files[side].name && <Typography.Text style={{ overflowWrap: 'anywhere' }}>{files[side].name}</Typography.Text>}
                {files[side].data && <Typography.Text type="secondary">Version {files[side].data.version}{files[side].data.exportedAt ? ` · ${files[side].data.exportedAt}` : ''}</Typography.Text>}
                {files[side].error && <Alert type="error" showIcon title={files[side].error} />}
                {files[side].data?.warnings.map((warning) => <Alert key={warning} type="warning" title={warning} />)}
              </Space>
            </Card>
          </Col>)}
        </Row>
        {comparison && <>
          <Space wrap>{statuses.map((item) => <Tag key={item} color={colors[item]}>{item}: {comparison.counts[item]}</Tag>)}</Space>
          <Collapse size="small" items={[{ key: 'coverage', label: 'Collection coverage: omitted and skipped are not empty', children:
            <Table size="small" pagination={false} rowKey="resourceType" dataSource={comparison.coverage} scroll={{ x: 480 }} columns={[
              { title: 'Resource', dataIndex: 'resourceType', render: (resource: keyof typeof RESOURCE_LABELS) => RESOURCE_LABELS[resource] },
              { title: 'Before', key: 'before', render: (_, row) => `${row.before} (${row.beforeCount})` },
              { title: 'After', key: 'after', render: (_, row) => `${row.after} (${row.afterCount})` },
            ]} /> }]} />
          <Space wrap style={{ width: '100%' }}>
            <Input aria-label="Search snapshot differences" placeholder="Search resource paths or changed fields" value={search} onChange={(event) => setSearch(event.target.value)} allowClear style={{ width: narrow ? '100%' : 320, maxWidth: '100%' }} />
            <Select virtual={false} aria-label="Filter snapshot status" value={status} onChange={setStatus} style={{ minWidth: 160 }} options={['Differences', 'All results', ...statuses].map((value) => ({ value, label: value }))} />
            <Select virtual={false} aria-label="Filter snapshot resource" value={kind} onChange={setKind} style={{ minWidth: 190 }} options={[{ value: 'All resources', label: 'All resources' }, ...IMPORT_ORDER.map((value) => ({ value, label: RESOURCE_LABELS[value] }))]} />
          </Space>
          <Typography.Text type="secondary">{rows.length} matching resources · Changed paths use JSON Pointer. Object key order and top-level system metadata are ignored; array order and unknown fields are preserved.</Typography.Text>
          <Table size="small" rowKey="url" dataSource={rows} pagination={{ pageSize: 10, showSizeChanger: false }}
            locale={{ emptyText: 'No resources match these filters.' }} columns={narrow ? [{ title: 'Snapshot differences', key: 'detail', render: (_, row) => <Space orientation="vertical" style={{ width: '100%' }}>
              <Tag color={colors[row.status]}>{row.status}</Tag><Typography.Text strong>{RESOURCE_LABELS[row.resourceType]}</Typography.Text>
              <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{row.url}</Typography.Text>{details(row)}
            </Space> }] : [
              { title: 'Resource', width: 150, key: 'kind', render: (_, row) => RESOURCE_LABELS[row.resourceType] },
              { title: 'Destination identity', width: 340, dataIndex: 'url', render: (url: string) => <Typography.Text code style={{ overflowWrap: 'anywhere' }}>{url}</Typography.Text> },
              { title: 'Difference', width: 145, dataIndex: 'status', render: (value: SnapshotStatus) => <Tag color={colors[value]}>{value}</Tag> },
              { title: 'Changed fields', key: 'details', render: (_, row) => details(row) },
            ]} />
        </>}
      </Space>
    </Modal>
    <JsonChangeReview open={!!review} title="Snapshot JSON comparison" description={`${review?.url ?? ''} — before file on the left; after file on the right. Missing sides mean absent from that file, not proven gateway deletion. ${review?.paths.length ? `Changed paths: ${review.paths.join(', ')}` : ''}`}
      original={JSON.stringify(snapshotJson(review?.before ?? {}), null, 2)} modified={JSON.stringify(snapshotJson(review?.after ?? {}), null, 2)}
      confirmText="Back to snapshot comparison" onSave={() => setReview(null)} onCancel={() => setReview(null)} />
    <Modal title="Download snapshot report" open={downloadOpen} onCancel={() => setDownloadOpen(false)} okText="Download JSON report" onOk={() => {
      if (files.before.data && files.after.data) downloadJson(snapshotComparisonReport(files.before.data, files.after.data), 'apisix-snapshot-comparison.json');
      setDownloadOpen(false);
    }}>
      <Typography.Paragraph>The report includes all compared resource payloads, including any credentials or private keys present in your files. Review it before sharing. Filters do not remove data from the downloaded report.</Typography.Paragraph>
    </Modal>
  </>;
};
