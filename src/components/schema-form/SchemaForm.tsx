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
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  theme,
  Tooltip,
  Typography,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getSchemaControlKind } from '@/components/schema-form/schemaControls';
import { placeholderForJsonSchema } from '@/components/schema-form/schemaTemplate';
import {
  getActiveRequiredFields,
  getResolvedSchema,
  getSchemaProperties,
  type JSONSchema,
  schemaType,
  validateSchemaValue,
} from '@/components/schema-form/schemaValidation';
import IconAdd from '~icons/material-symbols/add';
import IconDelete from '~icons/material-symbols/delete-forever-outline';
import IconInfo from '~icons/material-symbols/info-outline';

export type SchemaFormProps = {
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
  requiredFields?: string[];
  rootSchema?: JSONSchema;
};

type JSONSchemaProperty = JSONSchema;

type FieldRendererProps = {
  fieldKey: string;
  schema: JSONSchemaProperty;
  value: unknown;
  onChange: (val: unknown) => void;
  disabled?: boolean;
  required?: boolean;
  rootSchema: JSONSchema;
};

const FieldLabel = ({
  label,
  description,
  required,
}: {
  label: string;
  description?: string;
  required?: boolean;
}) => {
  const { token } = theme.useToken();
  return (
    <div style={{ marginBottom: 4 }}>
      <Typography.Text>
        {required && (
          <span style={{ color: token.colorError, marginRight: 4 }}>*</span>
        )}
        {label}
        {description && (
          <Tooltip title={description}>
            <IconInfo style={{ marginLeft: 6, color: token.colorTextSecondary, cursor: 'help', fontSize: 'var(--app-font-size-base)' }} />
          </Tooltip>
        )}
      </Typography.Text>
    </div>
  );
};

const FieldWrapper = ({
  fieldKey,
  schema,
  required,
  children,
}: {
  fieldKey: string;
  schema: JSONSchemaProperty;
  required?: boolean;
  children: React.ReactNode;
}) => {
  const label = schema.title || fieldKey;
  return (
    <div style={{ marginBottom: 16 }}>
      <FieldLabel label={label} description={schema.description} required={required} />
      {children}
    </div>
  );
};

const getFieldLabel = (fieldKey: string, schema: JSONSchemaProperty) =>
  schema.title || fieldKey;

const ArrayOfObjectsField = ({
  fieldKey,
  schema,
  value,
  onChange,
  disabled,
  required,
  rootSchema,
}: FieldRendererProps) => {
  const { token } = theme.useToken();
  const items = useMemo(
    () => Array.isArray(value) ? (value as Record<string, unknown>[]) : [],
    [value]
  );
  const itemSchema = schema.items as JSONSchemaProperty | undefined;

  // Stable keys ensure React keeps the correct component instance when items are
  // added or removed from any position. Without this, deleting item at index N
  // causes React to reuse wrong instances for all subsequent items, corrupting
  // the state of nested SchemaForm components.
  const keyCountRef = useRef(0);
  const [itemKeys, setItemKeys] = useState<string[]>(() =>
    items.map(() => String(keyCountRef.current++))
  );
  // Sync keys when the item list is reset externally (e.g. applying an AI template)
  useEffect(() => {
    if (items.length !== itemKeys.length) {
      setItemKeys(Array.from({ length: items.length }, () => String(keyCountRef.current++)));
    }
  }, [items.length, itemKeys.length]);

  const handleAdd = useCallback(() => {
    setItemKeys((prev) => [...prev, String(keyCountRef.current++)]);
    onChange([
      ...items,
      (itemSchema
        ? defaultForSchema(itemSchema, rootSchema)
        : {}) as Record<string, unknown>,
    ]);
  }, [itemSchema, items, onChange, rootSchema]);

  const handleRemove = useCallback((index: number) => {
    setItemKeys((prev) => prev.filter((_, i) => i !== index));
    onChange(items.filter((_, i) => i !== index));
  }, [items, onChange]);

  const handleItemChange = useCallback((index: number, itemVal: Record<string, unknown>) => {
    const next = items.map((item, i) => (i === index ? itemVal : item));
    onChange(next);
  }, [items, onChange]);

  return (
    <FieldWrapper fieldKey={fieldKey} schema={schema} required={required}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {items.map((item, index) => (
          <Card
            key={itemKeys[index] ?? index}
            size="small"
            style={{ background: token.colorFillAlter }}
            extra={
              !disabled && (
                <Tooltip title={`Remove item ${index + 1}`}>
                  <Button
                    type="text"
                    danger
                    size="small"
                    icon={<IconDelete />}
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => handleRemove(index)}
                    disabled={
                      schema.minItems !== undefined &&
                      items.length <= schema.minItems
                    }
                  />
                </Tooltip>
              )
            }
          >
            {itemSchema &&
            Object.keys(
              getSchemaProperties(itemSchema, rootSchema, item)
            ).length > 0 ? (
              <SchemaForm
                schema={itemSchema}
                value={item}
                onChange={(val) => handleItemChange(index, val)}
                disabled={disabled}
                requiredFields={itemSchema.required}
                rootSchema={rootSchema}
              />
            ) : (
              <Input
                aria-label={`${getFieldLabel(fieldKey, schema)} item ${index + 1}`}
                value={String(item ?? '')}
                disabled={disabled}
                onChange={(e) => {
                  const next = items.map((v, i) => (i === index ? e.target.value : v));
                  onChange(next);
                }}
              />
            )}
          </Card>
        ))}
        {!disabled && (
          <Button
            type="dashed"
            onClick={handleAdd}
            icon={<IconAdd />}
            size="small"
            disabled={
              schema.maxItems !== undefined &&
              items.length >= schema.maxItems
            }
          >
            Add item
          </Button>
        )}
      </Space>
    </FieldWrapper>
  );
};


const isSchemaValueCompatible = (
  schema: JSONSchemaProperty,
  value: unknown
): boolean => {
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  if (types.length === 0) return true;
  return types.some((type) => {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    }
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (type === 'number') return typeof value === 'number';
    return typeof value === type;
  });
};

const defaultForSchema = (
  schema: JSONSchemaProperty,
  rootSchema = schema
): unknown => placeholderForJsonSchema(schema, rootSchema);

const inputPlaceholder = (
  schema: JSONSchemaProperty,
  controlKind: ReturnType<typeof getSchemaControlKind>
): string | undefined => {
  if (schema.format === 'uri') return 'https://example.com/path';
  if (schema.format === 'email') return 'name@example.com';
  if (controlKind === 'password') {
    return 'Enter a value or $secret:// reference';
  }
  return undefined;
};

const FreeFormJsonField = ({
  fieldKey,
  schema,
  value,
  onChange,
  disabled,
  required,
}: FieldRendererProps) => {
  const expectedType = schemaType(schema);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(() =>
    typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)
  );
  // Track the last serialized value so we only reset the textarea when the
  // *content* actually changes, not just the object reference. Skipping no-op
  // resets preserves the user's cursor position across parent re-renders.
  const prevSerializedRef = useRef<string>(
    typeof value === 'string' ? '' : JSON.stringify(value ?? {}, null, 2)
  );

  useEffect(() => {
    if (typeof value !== 'string') {
      const serialized = JSON.stringify(value ?? {}, null, 2);
      if (serialized !== prevSerializedRef.current) {
        prevSerializedRef.current = serialized;
        setText(serialized);
        setError(null);
      }
    }
  }, [value]);

  const handleChange = (nextText: string) => {
    setText(nextText);
    try {
      const parsed = JSON.parse(nextText) as unknown;
      const isExpectedType =
        expectedType === 'array' ? Array.isArray(parsed) :
        expectedType === 'object' ? !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) :
        true;
      if (!isExpectedType) {
        setError(`Value must be a JSON ${expectedType}.`);
        onChange(nextText);
        return;
      }
      setError(null);
      onChange(parsed);
    } catch {
      setError('JSON format is not valid.');
      onChange(nextText);
    }
  };

  return (
    <FieldWrapper fieldKey={fieldKey} schema={schema} required={required}>
      <Input.TextArea
        aria-label={getFieldLabel(fieldKey, schema)}
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        disabled={disabled}
        status={error ? 'error' : undefined}
        autoSize={{ minRows: 3, maxRows: 10 }}
      />
      {error && (
        <Alert
          type="error"
          showIcon
          title={error}
          style={{ marginTop: 8 }}
        />
      )}
    </FieldWrapper>
  );
};

const ArrayOfScalarsField = ({
  fieldKey,
  schema,
  value,
  onChange,
  disabled,
  required,
  rootSchema,
}: FieldRendererProps) => {
  const items = Array.isArray(value) ? value : [];
  const itemSchema = schema.items ?? {};
  const itemType = schemaType(itemSchema);
  const fieldLabel = getFieldLabel(fieldKey, schema);

  const updateItem = (index: number, itemValue: unknown) => {
    onChange(items.map((item, itemIndex) =>
      itemIndex === index ? itemValue : item
    ));
  };

  const defaultItem = defaultForSchema(itemSchema, rootSchema) ??
    (itemType === 'number' || itemType === 'integer' ? 0 :
      itemType === 'boolean' ? false : '');

  const keyCountRef = useRef(0);
  const [itemKeys, setItemKeys] = useState<string[]>(() =>
    items.map(() => String(keyCountRef.current++))
  );
  useEffect(() => {
    if (items.length !== itemKeys.length) {
      setItemKeys(Array.from({ length: items.length }, () => String(keyCountRef.current++)));
    }
  }, [items.length, itemKeys.length]);

  return (
    <FieldWrapper fieldKey={fieldKey} schema={schema} required={required}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        {items.map((item, index) => (
          <Space key={itemKeys[index] ?? index} style={{ width: '100%' }}>
            {itemSchema.enum ? (
              <Select
                aria-label={`${fieldLabel} item ${index + 1}`}
                options={itemSchema.enum.map((option) => ({
                  label: String(option),
                  value: option as string | number | boolean,
                }))}
                value={item as string | number | boolean}
                onChange={(nextValue) => updateItem(index, nextValue)}
                disabled={disabled}
                style={{ width: 320 }}
              />
            ) : itemType === 'number' || itemType === 'integer' ? (
              <InputNumber
                aria-label={`${fieldLabel} item ${index + 1}`}
                value={item as number}
                onChange={(nextValue) => updateItem(index, nextValue)}
                min={itemSchema.minimum}
                max={itemSchema.maximum}
                precision={itemType === 'integer' ? 0 : undefined}
                disabled={disabled}
                style={{ width: 320 }}
              />
            ) : itemType === 'boolean' ? (
              <Switch
                aria-label={`${fieldLabel} item ${index + 1}`}
                checked={Boolean(item)}
                onChange={(nextValue) => updateItem(index, nextValue)}
                disabled={disabled}
              />
            ) : (
              <Input
                aria-label={`${fieldLabel} item ${index + 1}`}
                value={String(item ?? '')}
                onChange={(event) => updateItem(index, event.target.value)}
                maxLength={itemSchema.maxLength}
                disabled={disabled}
                style={{ width: 320 }}
              />
            )}
            {!disabled && (
              <Tooltip title={`Remove item ${index + 1}`}>
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<IconDelete />}
                  aria-label={`Remove item ${index + 1}`}
                  onClick={() => {
                    setItemKeys((prev) => prev.filter((_, i) => i !== index));
                    onChange(items.filter((_, itemIndex) => itemIndex !== index));
                  }}
                  disabled={
                    schema.minItems !== undefined &&
                    items.length <= schema.minItems
                  }
                />
              </Tooltip>
            )}
          </Space>
        ))}
        {!disabled && (
          <Button
            type="dashed"
            size="small"
            icon={<IconAdd />}
            onClick={() => {
              setItemKeys((prev) => [...prev, String(keyCountRef.current++)]);
              onChange([...items, defaultItem]);
            }}
            disabled={
              schema.maxItems !== undefined &&
              items.length >= schema.maxItems
            }
          >
            Add item
          </Button>
        )}
      </Space>
    </FieldWrapper>
  );
};

const OneOfField = ({
  fieldKey,
  schema,
  value,
  onChange,
  disabled,
  required,
  rootSchema,
}: FieldRendererProps) => {
  const variants = useMemo(
    () => (schema.oneOf || schema.anyOf) ?? [],
    [schema.anyOf, schema.oneOf]
  );

  const detectedIndex = useMemo(() => {
    const exact = variants.findIndex(
      (variant) =>
        validateSchemaValue(variant, value, '', rootSchema).length === 0
    );
    return exact >= 0 ? exact : 0;
  }, [rootSchema, value, variants]);

  const [selectedIndex, setSelectedIndex] = useState(detectedIndex);
  const selectedVariant = variants[selectedIndex] ?? variants[0];

  // Only reset the selected variant when the *schema* changes (different plugin or
  // field), not on every value change. Without this guard, typing in any field
  // triggers a detectedIndex recalculation that can override the user's manually
  // chosen variant, making the selector jump unexpectedly.
  const prevVariantsRef = useRef(variants);
  useEffect(() => {
    if (prevVariantsRef.current !== variants) {
      prevVariantsRef.current = variants;
      setSelectedIndex(detectedIndex);
    }
  }, [variants, detectedIndex]);

  const options = variants.map((v, i) => ({
    label: v.title || (schemaType(v) ? `${schemaType(v)} value` : `Option ${i + 1}`),
    value: i,
  }));

  const handleVariantChange = useCallback((idx: number) => {
    const hasData = value !== undefined && value !== null && value !== '';
    const applyVariant = () => {
      setSelectedIndex(idx);
      onChange(defaultForSchema(variants[idx] ?? {}, rootSchema));
    };
    if (hasData) {
      Modal.confirm({
        title: 'Switch variant?',
        content: 'Switching will clear the current configuration for this field.',
        okText: 'Switch',
        cancelText: 'Cancel',
        onOk: applyVariant,
      });
    } else {
      applyVariant();
    }
  }, [onChange, rootSchema, value, variants]);

  return (
    <FieldWrapper fieldKey={fieldKey} schema={schema} required={required}>
      <Select
        aria-label={`${getFieldLabel(fieldKey, schema)} variant`}
        options={options}
        value={selectedIndex}
        onChange={handleVariantChange}
        disabled={disabled}
        style={{ width: '100%', marginBottom: 12 }}
      />
      {selectedVariant && (
        <FieldRenderer
          fieldKey={selectedVariant.title || 'Value'}
          schema={selectedVariant}
          value={value}
          onChange={onChange}
          disabled={disabled}
          rootSchema={rootSchema}
        />
      )}
    </FieldWrapper>
  );
};

const FieldRenderer = ({
  fieldKey,
  schema,
  value,
  onChange,
  disabled,
  required,
  rootSchema,
}: FieldRendererProps) => {
  const resolvedSchema = getResolvedSchema(schema, rootSchema);
  const effectiveType = schemaType(resolvedSchema);
  const schemaProperties = getSchemaProperties(
    resolvedSchema,
    rootSchema,
    value
  );
  const controlKind = getSchemaControlKind(
    fieldKey,
    resolvedSchema,
    rootSchema
  );
  const fieldLabel = getFieldLabel(fieldKey, resolvedSchema);

  // oneOf / anyOf
  if (controlKind === 'union') {
    return (
      <OneOfField
        fieldKey={fieldKey}
        schema={resolvedSchema}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        rootSchema={rootSchema}
      />
    );
  }

  // Objects with dynamic keys are edited as JSON so no schema-defined
  // provider option or authentication key is hidden from the user.
  if (
    controlKind === 'json'
  ) {
    return (
      <FreeFormJsonField
        fieldKey={fieldKey}
        schema={resolvedSchema}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        rootSchema={rootSchema}
      />
    );
  }

  // object
  if (controlKind === 'object') {
    return (
      <FieldWrapper
        fieldKey={fieldKey}
        schema={resolvedSchema}
        required={required}
      >
        <Card size="small" style={{ marginBottom: 0 }}>
          <SchemaForm
            schema={{ ...resolvedSchema, properties: schemaProperties }}
            value={(value as Record<string, unknown>) ?? {}}
            onChange={onChange}
            disabled={disabled}
            rootSchema={rootSchema}
          />
        </Card>
      </FieldWrapper>
    );
  }

  // array of objects
  if (
    controlKind === 'object-array'
  ) {
    return (
      <ArrayOfObjectsField
        fieldKey={fieldKey}
        schema={resolvedSchema}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required={required}
        rootSchema={rootSchema}
      />
    );
  }

  // array of strings → tags select
  if (
    controlKind === 'scalar-array' ||
    controlKind === 'multi-select' ||
    controlKind === 'tags'
  ) {
    const itemSchema = resolvedSchema.items
      ? getResolvedSchema(resolvedSchema.items, rootSchema)
      : undefined;
    const itemEnum = itemSchema?.enum;

    if (controlKind === 'scalar-array') {
      return (
        <ArrayOfScalarsField
          fieldKey={fieldKey}
          schema={{ ...resolvedSchema, items: itemSchema }}
          value={value}
          onChange={onChange}
          disabled={disabled}
          required={required}
          rootSchema={rootSchema}
        />
      );
    }

    return (
      <FieldWrapper
        fieldKey={fieldKey}
        schema={resolvedSchema}
        required={required}
      >
        <Select
          aria-label={fieldLabel}
          mode={controlKind === 'multi-select' ? 'multiple' : 'tags'}
          options={itemEnum?.map((item) => ({
            label: String(item),
            value: item as string | number,
          }))}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          disabled={disabled}
          style={{ width: '100%' }}
          maxCount={resolvedSchema.maxItems}
        />
      </FieldWrapper>
    );
  }

  // string with enum → Select
  if (controlKind === 'select') {
    const options = (resolvedSchema.enum ?? []).map((v) => ({
      label: String(v),
      value: v as string | number | boolean,
    }));
    return (
      <FieldWrapper
        fieldKey={fieldKey}
        schema={resolvedSchema}
        required={required}
      >
        <Select
          aria-label={fieldLabel}
          options={options}
          value={value as string | number | undefined}
          onChange={onChange}
          disabled={disabled}
          style={{ width: '100%' }}
          allowClear
        />
      </FieldWrapper>
    );
  }

  // number / integer
  if (controlKind === 'number') {
    return (
      <FieldWrapper
        fieldKey={fieldKey}
        schema={resolvedSchema}
        required={required}
      >
        <InputNumber
          aria-label={fieldLabel}
          value={value as number | undefined}
          onChange={onChange}
          min={resolvedSchema.minimum}
          max={resolvedSchema.maximum}
          precision={effectiveType === 'integer' ? 0 : undefined}
          disabled={disabled}
          style={{ width: '100%' }}
        />
      </FieldWrapper>
    );
  }

  // boolean
  if (controlKind === 'boolean') {
    return (
      <FieldWrapper
        fieldKey={fieldKey}
        schema={resolvedSchema}
        required={required}
      >
        <Switch
          aria-label={fieldLabel}
          checked={!!value}
          onChange={onChange}
          disabled={disabled}
        />
      </FieldWrapper>
    );
  }

  // string (default)
  const maxLength = resolvedSchema.maxLength;
  const placeholder = inputPlaceholder(resolvedSchema, controlKind);

  return (
    <FieldWrapper
      fieldKey={fieldKey}
      schema={resolvedSchema}
      required={required}
    >
      {controlKind === 'textarea' ? (
        <Input.TextArea
          aria-label={fieldLabel}
          value={value as string | undefined}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          minLength={resolvedSchema.minLength}
          disabled={disabled}
          placeholder={placeholder}
          autoSize={{ minRows: 3, maxRows: 8 }}
        />
      ) : controlKind === 'password' ? (
        <Input.Password
          aria-label={fieldLabel}
          value={value as string | undefined}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
        />
      ) : (
        <Input
          aria-label={fieldLabel}
          type={controlKind === 'email' ? 'email' : controlKind === 'url' ? 'url' : 'text'}
          value={value as string | undefined}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          disabled={disabled}
          placeholder={placeholder}
        />
      )}
    </FieldWrapper>
  );
};

export const SchemaForm = ({
  schema,
  value,
  onChange,
  disabled,
  requiredFields,
  rootSchema,
}: SchemaFormProps) => {
  const s = schema as JSONSchemaProperty;
  const root = rootSchema ?? s;
  const properties = getSchemaProperties(s, root, value);

  if (Object.keys(properties).length === 0) return null;

  const safeValue = value ?? {};
  const required = [
    ...new Set([
      ...(requiredFields ?? []),
      ...getActiveRequiredFields(s, safeValue, root),
    ]),
  ];

  return (
    <div>
      {Object.entries(properties).map(([key, propSchema]) => {
        const ps = getResolvedSchema(
          propSchema as JSONSchemaProperty,
          root
        );
        const rawValue = safeValue[key];
        const schemaDefault =
          'default' in ps && isSchemaValueCompatible(ps, ps.default)
            ? ps.default
            : undefined;
        const hasObjectProperties =
          Object.keys(ps.properties ?? {}).length > 0;
        // Provide safe defaults for nested types to prevent "Cannot read properties of undefined"
        const fieldValue = rawValue ?? schemaDefault ?? (
          ps.type === 'object' || hasObjectProperties ? {} :
          ps.type === 'array' ? [] :
          undefined
        );
        const isRequired = required.includes(key);

        const handleChange = (val: unknown) => {
          onChange({ ...safeValue, [key]: val });
        };

        return (
          <FieldRenderer
            key={key}
            fieldKey={key}
            schema={propSchema as JSONSchemaProperty}
            value={fieldValue}
            onChange={handleChange}
            disabled={disabled}
            required={isRequired}
            rootSchema={root}
          />
        );
      })}
    </div>
  );
};
