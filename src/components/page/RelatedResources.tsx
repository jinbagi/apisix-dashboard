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
import { Alert, Button, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

import { SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isRecord, sortJsonKeys } from '@/utils/apisixEditable';
import { referenceFor, relatedReferences } from '@/utils/relatedResources';

import classes from './RelatedResources.module.css';

type ResourceRead = { api?: string; value?: Record<string, unknown>; error?: string; at?: string; loading: boolean };
function useRelatedResource(api: string | undefined, refresh: number, active: boolean) {
  const [state, setState] = useState<ResourceRead>({ loading: false });
  useEffect(() => {
    if (!api || !active) return;
    const controller = new AbortController();
    setState({ api, loading: true });
    req.get(api, { signal: controller.signal, timeout: 15_000, headers: { [SKIP_INTERCEPTOR_HEADER]: ['404'] } })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        const value: unknown = data?.value;
        if (!isRecord(value) || !Object.hasOwn(value, 'id') || !['string', 'number'].includes(typeof value.id) || String(value.id) !== decodeURIComponent(api.split('/').at(-1)!))
          throw new Error('The Admin API did not return the requested resource.');
        setState({ api, value, loading: false, at: new Date().toLocaleTimeString() });
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ api, loading: false, error: error instanceof Error ? error.message : 'Unable to read reference' });
      });
    return () => controller.abort();
  }, [api, refresh, active]);
  return state.api === api ? state : { api, loading: Boolean(api) };
}
const resourceLinks = { services: '/services/detail/$id', upstreams: '/upstreams/detail/$id', plugin_configs: '/plugin_configs/detail/$id' } as const;
export const RelatedResources = ({ api, draft, active, onClose }: { api: string; draft: string; active: boolean; onClose: () => void }) => {
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [selectOpen, setSelectOpen] = useState(false);
  useEffect(() => { if (!active) setSelectOpen(false); }, [active]);
  const { references, warnings } = relatedReferences(api, draft);
  const serviceApi = references.find((item) => item.api.startsWith('/services/'))?.api;
  const service = useRelatedResource(serviceApi, refresh, active);
  const inherited = service.value?.upstream_id == null ? undefined : referenceFor('upstreams', service.value.upstream_id, 'Service Upstream');
  const targets = inherited && !references.some((item) => item.api === inherited.api) ? [...references, inherited] : references;
  const selectedApi = targets.find((item) => item.api === selected)?.api ?? targets[0]?.api;
  const targetRead = useRelatedResource(selectedApi === serviceApi ? undefined : selectedApi, refresh, active);
  const result = selectedApi === serviceApi ? service : targetRead;
  const kind = selectedApi?.split('/')[1] as keyof typeof resourceLinks | undefined;
  return <aside className={classes.panel} aria-label="Related resource inspector">
    <Space className={classes.header} wrap><Typography.Text strong>Related resources</Typography.Text><Button size="small" onClick={onClose}>Close references</Button></Space>
    <Typography.Paragraph type="secondary" className={classes.help}>References follow your current draft. Source JSON is read-only saved data; your edits stay in the editor.</Typography.Paragraph>
    {warnings.map((warning) => <Alert key={warning} type="warning" showIcon title={warning} />)}
    {targets.length === 0 ? <Typography.Paragraph>No linked Service, Upstream or Plugin Config IDs in this draft. Inline configuration stays in the editor.</Typography.Paragraph> : <>
      <Select aria-label="Reference to inspect" className={classes.select} value={selectedApi} onChange={setSelected} open={active && selectOpen} onOpenChange={setSelectOpen}
        options={targets.map((target) => ({ value: target.api, label: target.label }))} virtual={false} />
      <Space wrap className={classes.actions}>
        <Button size="small" onClick={() => setRefresh((current) => current + 1)} loading={result.loading}>Refresh reference</Button>
        {selectedApi && kind && <Link to={resourceLinks[kind]} params={{ id: decodeURIComponent(selectedApi.split('/').at(-1)!) }} target="_blank" rel="noopener noreferrer">Open detail in new tab</Link>}
      </Space>
      {service.error && selectedApi !== serviceApi && <Alert type="warning" showIcon title="Service references could not be loaded" description={service.error} />}
      {service.value?.upstream_id != null && !inherited && <Alert type="warning" showIcon title="The saved Service upstream_id is invalid." />}
      {result.loading ? <Spin aria-label="Loading related resource" /> : result.error ? <Alert type="error" showIcon title="Unable to inspect reference" description={result.error} /> : result.value && <>
        <Typography.Text type="secondary" className={classes.help}>Saved source / {selectedApi} / Read at {result.at}</Typography.Text>
        <pre className={classes.json} tabIndex={0} aria-label="Related resource JSON">{JSON.stringify(sortJsonKeys(result.value), null, 2)}</pre>
      </>}
      <Typography.Paragraph type="secondary" className={classes.help}>A saved reference may be overridden by inline configuration or plugins. This panel does not predict request execution.</Typography.Paragraph>
    </>}
  </aside>;
};
