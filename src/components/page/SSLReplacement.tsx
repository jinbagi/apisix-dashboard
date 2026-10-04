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
import { useBlocker } from '@tanstack/react-router';
import { Alert, Button, Checkbox, Descriptions, Input, Modal, Select, Space, Spin, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';

import { trackResourceWrite, UnverifiedResourceWriteError } from '@/apis/tracked-resource-write';
import { API_SSLS, SKIP_INTERCEPTOR_HEADER } from '@/config/constant';
import { req } from '@/config/req';
import { isDeepEqual } from '@/utils/apisixEditable';
import { refreshResourceCaches } from '@/utils/resourceCache';
import { validateExactResourceSnapshot } from '@/utils/resourceIdentity';
import type { CertificateCheck, CertificateSummary } from '@/utils/sslCertificate';

const skips = { [SKIP_INTERCEPTOR_HEADER]: ['network', '400', '401', '403', '404', '409', '422', '500', '502', '503', '504'] };
const styles = { stack: { display: 'flex', flexDirection: 'column' as const, gap: 12 }, wrap: { overflowWrap: 'anywhere' as const } };
function CertificateDetails({ title, certificate, fallback }: { title: string; certificate?: CertificateSummary; fallback?: string }) {
  return <section aria-label={title} style={{ minWidth: 0, flex: '1 1 280px' }}>
    <Typography.Title level={5}>{title}</Typography.Title>
    {certificate ? <Descriptions size="small" column={1} bordered styles={{ content: styles.wrap }} items={[
      { key: 'subject', label: 'Subject', children: certificate.subject },
      { key: 'names', label: 'Names', children: certificate.names.join(', ') || 'No DNS/IP names or common name' },
      { key: 'start', label: 'Valid from', children: certificate.notBefore },
      { key: 'end', label: 'Valid until', children: certificate.notAfter },
      { key: 'issuer', label: 'Issuer', children: certificate.issuer },
      { key: 'algorithm', label: 'Key algorithm', children: certificate.algorithm },
      { key: 'chain', label: 'PEM chain', children: `${certificate.chainLength} certificate${certificate.chainLength === 1 ? '' : 's'}` },
      { key: 'fingerprint', label: 'SHA-256', children: <Typography.Text code style={styles.wrap}>{certificate.fingerprint}</Typography.Text> },
    ]} /> : <Alert type="info" title={fallback || 'Certificate details unavailable.'} />}
  </section>;
}
function ReplacementDialog({ id, onClose, onSaved }: { id: string; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const api = `${API_SSLS}/${encodeURIComponent(id)}`;
  const [baseline, setBaseline] = useState<Record<string, unknown>>();
  const [pair, setPair] = useState(0);
  const [cert, setCert] = useState('');
  const [key, setKey] = useState('');
  const [oldCertificate, setOldCertificate] = useState<CertificateSummary>();
  const [oldError, setOldError] = useState('');
  const [review, setReview] = useState<CertificateCheck>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(true);
  const certFile = useRef<HTMLInputElement>(null);
  const keyFile = useRef<HTMLInputElement>(null);
  const dirty = !!(cert || key) && !saved;
  const navigation = useBlocker({ shouldBlockFn: () => dirty || saving, enableBeforeUnload: () => dirty || saving, withResolver: true });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = async () => {
    const version = ++revision.current;
    setLoading(true); setError(''); setReview(undefined); setChecking(false);
    try {
      const response = await req.get(api, { timeout: 15_000, headers: skips });
      validateExactResourceSnapshot(api, response.data?.value, response.data?.key);
      if (!mounted.current || version !== revision.current) return;
      setBaseline(structuredClone(response.data.value)); setNeedsRefresh(false);
    } catch {
      if (mounted.current && version === revision.current) { setBaseline(undefined); setError('The current SSL could not be read. No write was sent. Retry the current SSL read.'); }
    } finally { if (mounted.current && version === revision.current) setLoading(false); }
  };
  useEffect(() => { void load(); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    setOldCertificate(undefined); setOldError('');
    const value = pair === 0 ? baseline?.cert : (baseline?.certs as unknown[] | undefined)?.[pair - 1];
    if (typeof value === 'string') void import('@/utils/sslCertificate').then(({ inspectCertificate }) => inspectCertificate(value))
      .then((summary) => { if (!cancelled) setOldCertificate(summary); })
      .catch((cause: unknown) => { if (!cancelled) setOldError(cause instanceof Error ? cause.message : 'Certificate details unavailable.'); });
    return () => { cancelled = true; };
  }, [baseline, pair]);
  const invalidate = () => { revision.current++; setReview(undefined); setAcknowledged(false); setError(''); setChecking(false); setSaved(false); };
  const change = (target: 'cert' | 'key', value: string) => { invalidate(); (target === 'cert' ? setCert : setKey)(value); };
  const readFile = async (target: 'cert' | 'key', file?: File) => {
    if (!file) return;
    const version = ++revision.current;
    setReview(undefined); setChecking(false); setAcknowledged(false);
    if (file.size > 1024 * 1024) { setError('PEM files must be no larger than 1 MiB.'); return; }
    try {
      const text = await file.text();
      if (mounted.current && version === revision.current) change(target, text);
    } catch { if (mounted.current && version === revision.current) setError('The PEM file could not be read.'); }
  };
  const inspect = async () => {
    if (!baseline) return;
    const version = ++revision.current;
    setChecking(true); setError(''); setReview(undefined); setAcknowledged(false);
    try {
      const { checkCertificatePair, sslReplacementPayload } = await import('@/utils/sslCertificate');
      sslReplacementPayload(baseline, pair, cert, key);
      const names = baseline.type === 'client' ? [] : typeof baseline.sni === 'string' ? [baseline.sni]
        : Array.isArray(baseline.snis) ? baseline.snis.filter((name): name is string => typeof name === 'string') : [];
      const result = await checkCertificatePair(cert, key, names);
      if (mounted.current && version === revision.current) setReview(result);
    } catch (cause) {
      if (mounted.current && version === revision.current) setError(cause instanceof Error ? cause.message : 'Certificate inspection failed.');
    } finally { if (mounted.current && version === revision.current) setChecking(false); }
  };
  const save = async () => {
    if (!review || !baseline || saving || needsRefresh || (review.warnings.length && !acknowledged)) return;
    setSaving(true); setError('');
    let writeStarted = false;
    let conflict = false;
    try {
      const { sslReplacementPayload } = await import('@/utils/sslCertificate');
      const body = sslReplacementPayload(baseline, pair, cert, key);
      await trackResourceWrite({ source: 'form', method: 'PUT', api, body, beforeWrite(before) {
        if (!isDeepEqual(before, baseline)) { conflict = true; throw new Error('SSL changed'); }
      } }, () => { writeStarted = true; return req.put(api, body, { timeout: 15_000, headers: skips }); });
      setSaved(true); setCert(''); setKey(''); setReview(undefined);
      await Promise.allSettled([onSaved(), refreshResourceCaches('ssls', API_SSLS)]);
    } catch (cause) {
      setNeedsRefresh(writeStarted || conflict); setReview(undefined);
      setError(conflict ? 'The SSL changed after this review. No write was sent. Refresh current SSL and review your replacement again.'
        : cause instanceof UnverifiedResourceWriteError ? 'APISIX accepted the replacement, but read-back could not verify the readable fields. Refresh current SSL before any retry.'
          : writeStarted ? 'The save result could not be confirmed. Refresh current SSL before retrying; the request may have reached APISIX.'
            : 'The latest SSL could not be verified. No write was sent. Refresh current SSL and try again.');
    } finally { setSaving(false); }
  };
  const close = () => {
    if (saving) return;
    if (dirty) Modal.confirm({ title: 'Discard this certificate replacement?', content: 'The certificate and private key are held only in this dialog and will be cleared.', okText: 'Discard replacement', cancelText: 'Keep editing', onOk: onClose });
    else onClose();
  };
  const pairs = Math.max(Array.isArray(baseline?.certs) ? baseline.certs.length : 0, Array.isArray(baseline?.keys) ? baseline.keys.length : 0) + 1;
  return <>
    <Modal title={`Replace SSL certificate: ${id}`} open onCancel={close} width={920} style={{ top: 16, paddingBottom: 16 }} mask={{ closable: false }} closable={!saving} keyboard={!saving}
      styles={{ body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto', overflowX: 'hidden' }, footer: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 } }}
      footer={saved ? <Button type="primary" onClick={onClose}>Done</Button> : <>
        <Button onClick={close} disabled={saving}>Cancel</Button>
        {review && <Button onClick={() => setReview(undefined)} disabled={saving}>Edit replacement</Button>}
        {review ? <Button type="primary" loading={saving} disabled={needsRefresh || (!!review.warnings.length && !acknowledged)} onClick={() => void save()}>Save replacement</Button>
          : <Button type="primary" loading={checking} disabled={!baseline || loading || needsRefresh || !cert.trim() || !key.trim()} onClick={() => void inspect()}>Inspect replacement</Button>}
      </>}>
      <div style={styles.stack}>
        {saved ? <Alert type="success" showIcon title="Replacement accepted; readable fields verified" description="APISIX was read again after saving. Protected private keys cannot be verified by read-back. The matching certificate/key pair was verified locally before submission. Check your gateway TLS connection separately." /> : <>
          <Typography.Paragraph style={{ margin: 0 }}>Inspect a replacement certificate and private key before saving. Inputs remain in memory until this dialog closes. Verification checks key possession and certificate metadata; it does not validate chain trust, revocation, or a live TLS connection.</Typography.Paragraph>
          {error && <Alert type="error" showIcon title={error} />}
          <Space wrap><Button onClick={() => void load()} disabled={saving || loading}>Refresh current SSL</Button>{loading && <Spin size="small" />}</Space>
          {baseline && <>
            <Select aria-label="Certificate pair to replace" value={pair} disabled={saving || loading || !!review} options={Array.from({ length: pairs }, (_, index) => ({ value: index, label: index === 0 ? 'Pair 1 (default)' : `Pair ${index + 1}` }))}
              onChange={(value) => { invalidate(); setPair(value); }} style={{ width: '100%' }} />
            {review ? <>
              <Alert type="success" showIcon title="Private key match verified" description="A random challenge was signed with this private key and verified using the leaf certificate public key." />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <CertificateDetails title="Current certificate" certificate={oldCertificate} fallback={oldError} />
                <CertificateDetails title="Replacement certificate" certificate={review.certificate} />
              </div>
              <Alert type="info" title={`Changed fields: ${pair === 0 ? '/cert and /key' : `/certs/${pair - 1} and /keys/${pair - 1}`}`} description="The selected pair is replaced together. All other SSL settings and certificate pairs are preserved. Private key contents are hidden from this review." />
              {review.warnings.length > 0 && <><Alert type="warning" showIcon title="Review certificate warnings" description={<ul style={{ margin: 0, paddingInlineStart: 20 }}>{review.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>} />
                <Checkbox checked={acknowledged} disabled={saving} onChange={(event) => setAcknowledged(event.target.checked)}>I reviewed these validity and server-name warnings.</Checkbox></>}
            </> : <>
              <CertificateDetails title="Current certificate" certificate={oldCertificate} fallback={oldError} />
              <label htmlFor="ssl-replacement-cert">Replacement certificate PEM (leaf first, optional chain)</label>
              <Input.TextArea id="ssl-replacement-cert" value={cert} onChange={(event) => change('cert', event.target.value)} disabled={saving || loading} autoSize={{ minRows: 3, maxRows: 7 }} spellCheck={false} autoComplete="off" />
              <Button onClick={() => certFile.current?.click()} disabled={saving || loading}>Load certificate file</Button>
              <input ref={certFile} type="file" accept=".pem,.crt,.cer" aria-label="Certificate PEM file" hidden onChange={(event) => { void readFile('cert', event.target.files?.[0]); event.target.value = ''; }} />
              <label htmlFor="ssl-replacement-key">Replacement private key PEM</label>
              <Input.TextArea id="ssl-replacement-key" value={key} onChange={(event) => change('key', event.target.value)} disabled={saving || loading} autoSize={{ minRows: 3, maxRows: 7 }} spellCheck={false} autoComplete="off" />
              <Button onClick={() => keyFile.current?.click()} disabled={saving || loading}>Load private key file</Button>
              <input ref={keyFile} type="file" accept=".pem,.key" aria-label="Private key PEM file" hidden onChange={(event) => { void readFile('key', event.target.files?.[0]); event.target.value = ''; }} />
              <Typography.Text type="secondary">Supports unencrypted PKCS#8, RSA PKCS#1 and EC SEC1 keys. Secret references and encrypted keys require the SSL form or RAW.</Typography.Text>
            </>}
          </>}
        </>}
      </div>
    </Modal>
    <Modal open={navigation.status === 'blocked'} title={saving ? 'Wait for certificate saving' : 'Discard certificate replacement and leave?'}
      okText="Discard and leave" okButtonProps={{ disabled: saving }} cancelText="Stay here" onCancel={() => navigation.reset?.()} onOk={() => { onClose(); navigation.proceed?.(); }}>
      {saving ? 'The request is still being verified. Keep this page open.' : 'The replacement inputs will be cleared from memory.'}
    </Modal>
  </>;
}
export function SSLReplacement({ id, disabled, onSaved }: { id: string; disabled: boolean; onSaved: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  return <div style={{ marginBottom: 16 }}>
    <Button onClick={() => setOpen(true)} disabled={disabled}>Replace certificate</Button>
    {disabled && <Typography.Text type="secondary" style={{ marginInlineStart: 8 }}>Save or reset form changes before replacing a certificate.</Typography.Text>}
    {open && <ReplacementDialog id={id} onClose={() => setOpen(false)} onSaved={onSaved} />}
  </div>;
}