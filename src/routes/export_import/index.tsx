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
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  message,
  Modal,
  Progress,
  Result,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useCallback, useRef, useState } from 'react';

import { checkEnvironmentReferences, mapImportEnvironment, selectImportItems, unselectedImportDependencies, verifyEnvironmentReferences } from '@/apis/environment-import';
import {
  type ConfigValidationResult,
  EXPORT_VERSION,
  exportAllResources,
  type ExportData,
  getImportRequest,
  IMPORT_ORDER,
  importResources,
  type ImportResult,
  RESOURCE_LABELS,
  type ResourceKey,
  validateConfiguration,
} from '@/apis/export-import';
import { InvalidExportCollection } from '@/apis/export-snapshot';
import { type ImportPreviewItem,previewImport, verifyImportPreview } from '@/apis/import-preview';
import { EnvironmentIdMapping } from '@/components/page/EnvironmentIdMapping';
import { ImportChangePreview } from '@/components/page/ImportChangePreview';
import PageHeader from '@/components/page/PageHeader';
import { SharingRedaction } from '@/components/page/SharingRedaction';
import { SnapshotComparison } from '@/components/page/SnapshotComparison';
import { stageChanges } from '@/stores/changeSets';
import { downloadJson } from '@/utils/downloadJson';
import { assertRestorableExport } from '@/utils/sharingFormat';
import IconDownload from '~icons/material-symbols/download';
import IconUpload from '~icons/material-symbols/upload';

function ExportSection() {
  const [loading, setLoading] = useState(false);
  const [exportNotice, setExportNotice] = useState<{ type: 'warning' | 'error'; text: string }>();
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] =
    useState<ConfigValidationResult | null>(null);

  const handleExport = async () => {
    setLoading(true); setExportNotice(undefined);
    try {
      const data = await exportAllResources();
      downloadJson(data, `apisix-export-${new Date().toISOString().slice(0, 10)}.json`);
      if (data.skippedResources?.length) {
        setExportNotice({ type: 'warning', text: `Partial export downloaded. Unread collections: ${data.skippedResources.join(', ')}. The file marks these scopes incomplete.` });
        message.warning(`Exported with ${data.skippedResources.length} skipped: ${data.skippedResources.join(', ')}`);
      } else {
        message.success('Configuration exported successfully');
      }
    } catch (cause) {
      setExportNotice({ type: 'error', text: cause instanceof InvalidExportCollection ? cause.message : 'Failed to export configuration. No file was exported. Refresh and retry.' });
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidation(null);
    try {
      const data = await exportAllResources();
      const result = await validateConfiguration(data);
      setValidation(result);
      if (result.valid) {
        message.success('Current APISIX configuration is valid');
      } else {
        message.error(
          `Configuration validation found ${result.errors.length} error(s)`
        );
      }
    } catch {
      message.error('Failed to load current configuration for validation');
    } finally {
      setValidating(false);
    }
  };

  return (
    <Card
      title={
        <Space>
          <IconDownload style={{ fontSize: 'var(--app-font-size-icon-lg)' }} />
          <span>Export Configuration</span>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        Export all APISIX resources (routes, services, upstreams, consumers, SSLs, etc.)
        as a JSON file. Use this for backup or migration to another cluster.
      </Typography.Paragraph>
      <Space wrap>
        <Button
          type="primary"
          icon={<IconDownload />}
          loading={loading}
          onClick={handleExport}
          size="large"
        >
          Export All Resources
        </Button>
        <SharingRedaction />
        <Button loading={validating} onClick={handleValidate} size="large">
          Validate Current Configuration
        </Button>
      </Space>
      {exportNotice && <Alert style={{ marginTop: 16 }} type={exportNotice.type} showIcon title={exportNotice.type === 'error' ? 'Export blocked' : 'Incomplete export'} description={exportNotice.text} />}
      {validation && (
        <ValidationResult result={validation} />
      )}
    </Card>
  );
}

function ImportSection() {
  const [fileData, setFileData] = useState<ExportData | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileError, setFileError] = useState('');
  const fileGeneration = useRef(0);
  const [mappingText, setMappingText] = useState('{}');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedResources, setSelectedResources] = useState<ResourceKey[]>([]);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ items: ImportPreviewItem[]; data: ExportData; selected: ResourceKey[] } | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] =
    useState<ConfigValidationResult | null>(null);
  const abortRef = useRef(false);
  const navigationBlocker = useBlocker({ shouldBlockFn: () => importing, enableBeforeUnload: () => importing, withResolver: true });
  const missingDependencies = preview ? unselectedImportDependencies(preview.items, selectedItems) : [];

  const handleFile = useCallback((file: File) => {
    const request = ++fileGeneration.current;
    setFileData(null); setFileName(''); setPreview(null); setSelectedItems([]); setSelectedResources([]); setValidation(null); setResults([]); setShowResults(false); setFileError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      if (request !== fileGeneration.current) return;
      try {
        const data = JSON.parse(e.target?.result as string) as ExportData;
        assertRestorableExport(data);
        if (!data.version || !data.resources) {
          setFileError('Invalid export file format');
          return;
        }
        if (data.version > EXPORT_VERSION) {
          message.warning('This file was exported from a newer version. Some resources may not import correctly.');
        }
        setFileData(data); setMappingText('{}'); setPreview(null); setSelectedItems([]);
        setFileName(file.name);
        // Auto-select all non-empty resources
        const nonEmpty = IMPORT_ORDER.filter(
          (key) => (data.resources[key]?.length ?? 0) > 0
        );
        setSelectedResources(nonEmpty);
        setResults([]);
        setShowResults(false);
        setValidation(null);
      } catch (cause) {
        setFileError(cause instanceof Error && cause.message.includes('sharing copy') ? cause.message : 'Failed to parse JSON file');
      }
    };
    reader.onerror = () => { if (request === fileGeneration.current) setFileError('The file could not be read. Choose it again.'); };
    reader.readAsText(file);
    return false; // prevent antd upload
  }, []);

  const handleImport = async () => {
    if (!fileData || selectedResources.length === 0) return;
    setPreviewing(true);
    try {
      const mapped = mapImportEnvironment(fileData, mappingText);
      const items = await checkEnvironmentReferences(await previewImport(mapped, selectedResources));
      for (const row of items) {
        try {
          const source = getImportRequest(row.resourceType, fileData.resources[row.resourceType]![row.index]);
          row.sourceUrl = source.url; row.sourceBody = source.body;
        } catch { /* Invalid identities are already reported by the import preview. */ }
      }
      setSelectedItems(items.filter((row) => ['New', 'Changed'].includes(row.status)).map((row) => row.key));
      setPreview({ items, data: mapped, selected: [...selectedResources] });
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not prepare import preview. Nothing was imported.');
    } finally { setPreviewing(false); }
  };

  const applyImport = async () => {
    if (!preview || importing || missingDependencies.length || !selectedItems.length) return;
    const selection = selectImportItems(preview.data, preview.items, selectedItems);
        setImporting(true);
        setResults([]);
        setProgress(0);
        abortRef.current = false;

        const totalSteps = preview.selected.length;
        let completed = 0;

        const allResults = await importResources(
          selection.data,
          preview.selected,
          (result) => {
            completed++;
            setProgress(Math.round((completed / totalSteps) * 100));
            setResults((prev) => [...prev, result]);
          },
          async (resourceType, item, index, latest) => {
            const row = selection.rows.get(resourceType)?.[index];
            const changed = await verifyImportPreview(row, item, latest);
            if (changed && latest === undefined) await verifyEnvironmentReferences(row!);
            return changed;
          },
        );

        setImporting(false);
        setShowResults(true);
        setPreview(null);

        const totalSuccess = allResults.reduce((sum, r) => sum + r.success, 0);
        const totalErrors = allResults.reduce((sum, r) => sum + r.errors.length, 0);

        if (totalErrors === 0) {
          message.success(`Successfully imported ${totalSuccess} resources`);
        } else {
          message.warning(`Imported ${totalSuccess} resources with ${totalErrors} errors`);
        }
  };

  const handleValidate = async () => {
    if (!fileData || selectedResources.length === 0) return;
    setValidating(true);
    let mapped: ExportData;
    try { mapped = mapImportEnvironment(fileData, mappingText); }
    catch (error) { message.error(error instanceof Error ? error.message : 'Invalid ID mappings'); setValidating(false); return; }
    const result = await validateConfiguration(mapped, selectedResources);
    setValidation(result);
    setValidating(false);
    if (result.valid) {
      message.success('Selected configuration is valid');
    } else {
      message.error(
        `Configuration validation found ${result.errors.length} error(s)`
      );
    }
  };

  const toggleResource = (key: ResourceKey, checked: boolean) => {
    setSelectedResources((prev) =>
      checked ? [...prev, key] : prev.filter((k) => k !== key)
    );
  };

  const allSelected = fileData
    ? IMPORT_ORDER.filter((k) => (fileData.resources[k]?.length ?? 0) > 0).every((k) =>
        selectedResources.includes(k)
      )
    : false;

  const toggleAll = (checked: boolean) => {
    if (!fileData) return;
    if (checked) {
      setSelectedResources(
        IMPORT_ORDER.filter((k) => (fileData.resources[k]?.length ?? 0) > 0)
      );
    } else {
      setSelectedResources([]);
    }
  };

  return (
    <Card
      title={
        <Space>
          <IconUpload style={{ fontSize: 'var(--app-font-size-icon-lg)' }} />
          <span>Import Configuration</span>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        Import resources from a previously exported JSON file.
        Resources are imported in dependency order (upstreams first, then services, then routes).
      </Typography.Paragraph>

      <Upload.Dragger
        disabled={previewing || importing}
        accept=".json"
        showUploadList={false}
        beforeUpload={handleFile}
        style={{ marginBottom: 16 }}
      >
        <p style={{ fontSize: 'var(--app-font-size-error-code)', color: 'var(--ant-color-text-quaternary)', margin: '8px 0' }}>
          <IconUpload />
        </p>
        <p>Click or drag a JSON file to upload</p>
        {fileName && (
          <Tag color="blue" style={{ marginTop: 4 }}>{fileName}</Tag>
        )}
      </Upload.Dragger>

      {fileError && <Alert role="alert" type="error" showIcon title={fileError} style={{ marginBottom: 16 }} />}
      {fileData && (
        <>
          <Alert
            type="info"
            title={`Exported at ${fileData.exportedAt} (format v${fileData.version})`}
            style={{ marginBottom: 16 }}
          />

          <Collapse style={{ marginBottom: 16 }} items={[{ key: 'mappings', label: 'Environment ID mappings (optional)', children:
            <EnvironmentIdMapping data={fileData} text={mappingText} disabled={previewing || importing || validating}
              onChange={(value) => { setMappingText(value); setValidation(null); setPreview(null); }} />
          }]} />
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            Select resources to import:
          </Typography.Text>

          <div style={{ marginBottom: 8 }}>
            <Checkbox disabled={previewing || importing} checked={allSelected} onChange={(e) => toggleAll(e.target.checked)}>
              Select All
            </Checkbox>
          </div>

          <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
            {IMPORT_ORDER.map((key) => {
              const count = fileData.resources[key]?.length ?? 0;
              return (
                <Col key={key} xs={12} sm={8} md={6}>
                  <Checkbox
                    checked={selectedResources.includes(key)}
                    disabled={count === 0 || previewing || importing}
                    onChange={(e) => toggleResource(key, e.target.checked)}
                  >
                    {RESOURCE_LABELS[key]} ({count})
                  </Checkbox>
                </Col>
              );
            })}
          </Row>

          {importing && (
            <Progress percent={progress} status="active" style={{ marginBottom: 16 }} />
          )}

          <Space wrap>
            <Button size="large" onClick={handleImport} loading={previewing} disabled={importing || selectedResources.length === 0}>
              Compare with current environment
            </Button>
            <Button
              onClick={handleValidate}
              loading={validating}
              disabled={selectedResources.length === 0 || previewing || importing}
              size="large"
            >
              Validate Selected Resources
            </Button>
            <Button
              type="primary"
              icon={<IconUpload />}
              loading={importing || previewing}
              disabled={selectedResources.length === 0}
              onClick={handleImport}
              size="large"
            >
              Import Selected Resources
            </Button>
          </Space>

          {validation && <ValidationResult result={validation} />}
          {showResults && <ImportResults results={results} />}
          <Modal open={navigationBlocker.status === 'blocked'} title="Import in progress"
            onCancel={() => navigationBlocker.reset?.()} footer={<Button onClick={() => navigationBlocker.reset?.()}>Keep waiting</Button>}>
            Wait for the current import to finish before leaving this page.
          </Modal>
          <Modal open={preview !== null} title="Confirm Import" width={1100} okText="Import"
            style={{ top: 24 }} styles={{ body: { maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } }}
            onCancel={() => setPreview(null)} onOk={applyImport} confirmLoading={importing}
            closable={!importing} mask={{ closable: !importing }} keyboard={!importing}
            cancelButtonProps={{ disabled: importing }} destroyOnHidden
            okButtonProps={{ disabled: !selectedItems.length || missingDependencies.length > 0 }}>
            {preview && <>
              <Typography.Paragraph>{selectedItems.length} item(s) selected for application. Unselected changes remain untouched.</Typography.Paragraph>
              <Button disabled={importing || !selectedItems.length || missingDependencies.length > 0} onClick={() => {
                try {
                  stageChanges(preview.items.filter((row) => selectedItems.includes(row.key) && ['New', 'Changed'].includes(row.status)).map((row) => ({
                    resourceType: row.resourceType, item: preview.data.resources[row.resourceType]![row.index], baseline: row.before,
                  })));
                  message.success('Selected drafts added to Change sets. Nothing was imported.'); setPreview(null);
                } catch (error) { message.error(error instanceof Error ? error.message : 'Could not stage selected changes.'); }
              }}>Stage selected</Button>
              {missingDependencies.length > 0 && <Alert type="error" showIcon title="Select required new dependencies"
                description={missingDependencies.join(', ')} />}
              <ImportChangePreview items={preview.items} selectedKeys={selectedItems} onSelectionChange={setSelectedItems} disabled={importing} />
            </>}
          </Modal>
        </>
      )}
    </Card>
  );
}

function ValidationResult({ result }: { result: ConfigValidationResult }) {
  if (result.valid) {
    return (
      <Alert
        type="success"
        showIcon
        title={result.warnings?.length ? 'Configuration checks passed' : 'APISIX configuration validation passed'}
        description={result.warnings?.join(' ')}
        style={{ marginTop: 16 }}
      />
    );
  }

  return (
    <Alert
      type="error"
      showIcon
      title={`APISIX configuration validation failed (${result.errors.length})`}
      description={
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {result.errors.map((error, index) => (
            <li key={`${error.resource_type}-${error.resource_id}-${index}`}>
              {[error.resource_type, error.resource_id]
                .filter(Boolean)
                .join(' / ') || 'configuration'}
              {error.index !== undefined ? ` [${error.index}]` : ''}: {' '}
              {error.error}
            </li>
          ))}
        </ul>
      }
      style={{ marginTop: 16 }}
    />
  );
}

function ImportResults({ results }: { results: ImportResult[] }) {
  const totalSuccess = results.reduce((sum, r) => sum + r.success, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalSkipped = results.reduce((sum, r) => sum + (r.skipped ?? 0), 0);

  const columns = [
    {
      title: 'Resource',
      dataIndex: 'resourceType',
      key: 'resourceType',
      render: (type: ResourceKey) => RESOURCE_LABELS[type],
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
    },
    {
      title: 'Success',
      dataIndex: 'success',
      key: 'success',
      render: (val: number) => <Tag color="green">{val}</Tag>,
    },
    {
      title: 'Unchanged',
      key: 'skipped',
      render: (_: unknown, record: ImportResult) => record.skipped ?? 0,
    },
    {
      title: 'Errors',
      key: 'errors',
      render: (_: unknown, record: ImportResult) =>
        record.errors.length > 0 ? (
          <Tag color="red">{record.errors.length}</Tag>
        ) : (
          <Tag color="default">0</Tag>
        ),
    },
  ];

  return (
    <div style={{ marginTop: 24 }}>
      <Result
        status={totalErrors === 0 ? 'success' : 'warning'}
        title={`Import Complete: ${totalSuccess} succeeded, ${totalErrors} failed${totalSkipped ? `, ${totalSkipped} unchanged` : ''}`}
      />
      <Table
        columns={columns}
        dataSource={results}
        rowKey="resourceType"
        pagination={false}
        size="small"
        expandable={{
          expandedRowRender: (record) =>
            record.errors.length > 0 ? (
              <ul style={{ margin: 0 }}>
                {record.errors.map((err, i) => (
                  <li key={i}>
                    <Typography.Text type="danger">
                      {err.id}: {err.error}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            ) : null,
          rowExpandable: (record) => record.errors.length > 0,
        }}
      />
    </div>
  );
}

function ExportImportPage() {
  return (
    <>
      <PageHeader
        title="Import / Export"
        desc="Backup and restore APISIX configuration"
        extra={<SnapshotComparison />}
      />
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <ExportSection />
        </Col>
        <Col xs={24} lg={12}>
          <ImportSection />
        </Col>
      </Row>
    </>
  );
}

export const Route = createFileRoute('/export_import/')({
  component: ExportImportPage,
});
