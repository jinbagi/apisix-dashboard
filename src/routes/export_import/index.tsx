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
import { createFileRoute } from '@tanstack/react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
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

import {
  type ConfigValidationResult,
  EXPORT_VERSION,
  exportAllResources,
  type ExportData,
  IMPORT_ORDER,
  importResources,
  type ImportResult,
  RESOURCE_LABELS,
  type ResourceKey,
  validateConfiguration,
} from '@/apis/export-import';
import PageHeader from '@/components/page/PageHeader';
import { downloadJson } from '@/utils/downloadJson';
import IconDownload from '~icons/material-symbols/download';
import IconUpload from '~icons/material-symbols/upload';

function ExportSection() {
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] =
    useState<ConfigValidationResult | null>(null);

  const handleExport = async () => {
    setLoading(true);
    try {
      const data = await exportAllResources();
      downloadJson(data, `apisix-export-${new Date().toISOString().slice(0, 10)}.json`);
      if (data.skippedResources?.length) {
        message.warning(`Exported with ${data.skippedResources.length} skipped: ${data.skippedResources.join(', ')}`);
      } else {
        message.success('Configuration exported successfully');
      }
    } catch {
      message.error('Failed to export configuration');
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
        <Button loading={validating} onClick={handleValidate} size="large">
          Validate Current Configuration
        </Button>
      </Space>
      {validation && (
        <ValidationResult result={validation} />
      )}
    </Card>
  );
}

function ImportSection() {
  const [fileData, setFileData] = useState<ExportData | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedResources, setSelectedResources] = useState<ResourceKey[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] =
    useState<ConfigValidationResult | null>(null);
  const abortRef = useRef(false);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string) as ExportData;
        if (!data.version || !data.resources) {
          message.error('Invalid export file format');
          return;
        }
        if (data.version > EXPORT_VERSION) {
          message.warning('This file was exported from a newer version. Some resources may not import correctly.');
        }
        setFileData(data);
        setFileName(file.name);
        // Auto-select all non-empty resources
        const nonEmpty = IMPORT_ORDER.filter(
          (key) => (data.resources[key]?.length ?? 0) > 0
        );
        setSelectedResources(nonEmpty);
        setResults([]);
        setShowResults(false);
        setValidation(null);
      } catch {
        message.error('Failed to parse JSON file');
      }
    };
    reader.readAsText(file);
    return false; // prevent antd upload
  }, []);

  const handleImport = async () => {
    if (!fileData || selectedResources.length === 0) return;

    Modal.confirm({
      title: 'Confirm Import',
      content: (
        <div>
          <p>This will create or overwrite the following resources:</p>
          <ul>
            {selectedResources.map((key) => (
              <li key={key}>
                {RESOURCE_LABELS[key]}: {fileData.resources[key]?.length ?? 0} items
              </li>
            ))}
          </ul>
          <Alert
            type="warning"
            message="Existing resources with the same ID will be overwritten."
            style={{ marginTop: 8 }}
          />
        </div>
      ),
      okText: 'Import',
      okType: 'primary',
      onOk: async () => {
        setImporting(true);
        setResults([]);
        setProgress(0);
        abortRef.current = false;

        const totalSteps = selectedResources.length;
        let completed = 0;

        const allResults = await importResources(
          fileData,
          selectedResources,
          (result) => {
            completed++;
            setProgress(Math.round((completed / totalSteps) * 100));
            setResults((prev) => [...prev, result]);
          },
        );

        setImporting(false);
        setShowResults(true);

        const totalSuccess = allResults.reduce((sum, r) => sum + r.success, 0);
        const totalErrors = allResults.reduce((sum, r) => sum + r.errors.length, 0);

        if (totalErrors === 0) {
          message.success(`Successfully imported ${totalSuccess} resources`);
        } else {
          message.warning(`Imported ${totalSuccess} resources with ${totalErrors} errors`);
        }
      },
    });
  };

  const handleValidate = async () => {
    if (!fileData || selectedResources.length === 0) return;
    setValidating(true);
    const result = await validateConfiguration(fileData, selectedResources);
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

      {fileData && (
        <>
          <Alert
            type="info"
            message={`Exported at ${fileData.exportedAt} (format v${fileData.version})`}
            style={{ marginBottom: 16 }}
          />

          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            Select resources to import:
          </Typography.Text>

          <div style={{ marginBottom: 8 }}>
            <Checkbox checked={allSelected} onChange={(e) => toggleAll(e.target.checked)}>
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
                    disabled={count === 0}
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
            <Button
              onClick={handleValidate}
              loading={validating}
              disabled={selectedResources.length === 0}
              size="large"
            >
              Validate Selected Resources
            </Button>
            <Button
              type="primary"
              icon={<IconUpload />}
              loading={importing}
              disabled={selectedResources.length === 0}
              onClick={handleImport}
              size="large"
            >
              Import Selected Resources
            </Button>
          </Space>

          {validation && <ValidationResult result={validation} />}
          {showResults && <ImportResults results={results} />}
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
        message={result.warnings?.length ? 'Configuration checks passed' : 'APISIX configuration validation passed'}
        description={result.warnings?.join(' ')}
        style={{ marginTop: 16 }}
      />
    );
  }

  return (
    <Alert
      type="error"
      showIcon
      message={`APISIX configuration validation failed (${result.errors.length})`}
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
        title={`Import Complete: ${totalSuccess} succeeded, ${totalErrors} failed`}
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
