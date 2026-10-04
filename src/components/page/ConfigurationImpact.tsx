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

import { Link } from '@tanstack/react-router';
import { Alert, Button, Modal, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';

import { getConfigurationImpact, impactTarget } from '@/apis/configuration-impact';

export const ConfigurationImpact = ({ api, disabled = false }: { api: string; disabled?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof getConfigurationImpact>>>();
  const [error, setError] = useState('');
  const target = impactTarget(api);
  if (!target) return null;
  const refresh = async () => {
    setLoading(true); setData(undefined); setError('');
    try { setData(await getConfigurationImpact(target.kind, target.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read dependencies'); }
    finally { setLoading(false); }
  };
  return <>
    <Button size="small" disabled={disabled} onClick={() => { setOpen(true); void refresh(); }}>Analyze impact</Button>
    <Modal title="Configuration impact" open={open} width={1000} onCancel={() => setOpen(false)}
      footer={<Button onClick={() => setOpen(false)}>Close impact</Button>} destroyOnHidden>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text code>{api}</Typography.Text>
        <Typography.Paragraph style={{ margin: 0 }}>
          Potential impact through saved service_id, upstream_id and plugin_config_id references.
          Unsaved edits, plugin-internal references, scripts and dynamic routing are not evaluated.
          Plugin overrides can reduce the actual impact. Reads are not an atomic snapshot.
        </Typography.Paragraph>
        <Button loading={loading} onClick={() => void refresh()}>Refresh impact</Button>
        {error && <Alert type="error" showIcon title="Impact could not be verified" description={error} />}
        {data && <>
          <Space wrap><Tag color="blue">{data.affected} potentially affected route(s)</Tag>
            <Typography.Text type="secondary">Read at {data.readAt}</Typography.Text></Space>
          {data.services.length > 0 && <Typography.Paragraph>
            Referencing Services (including those without Routes): {data.services.join(', ')}
          </Typography.Paragraph>}
          <Table rowKey="key" size="small" dataSource={data.rows} pagination={{ pageSize: 8 }} scroll={{ x: 700 }}
            locale={{ emptyText: 'No routes found through the supported references' }}
            columns={[
              { title: 'Route', key: 'route', render: (_, row) => <Link target="_blank" rel="noopener noreferrer"
                to={row.kind === 'routes' ? '/routes/detail/$id' : '/stream_routes/detail/$id'} params={{ id: row.id }}>{row.name}</Link> },
              { title: 'Reference path', key: 'path', render: (_, row) => <span style={{ overflowWrap: 'anywhere' }}>{row.path.join(' → ')}</span> },
              { title: 'Impact', key: 'impact', render: (_, row) => <Tag color={row.referenceOnly ? 'default' : 'orange'}>
                {row.referenceOnly ? 'Route overrides Service upstream' : 'Potential change'}</Tag> },
            ]} />
        </>}
      </Space>
    </Modal>
  </>;
};

