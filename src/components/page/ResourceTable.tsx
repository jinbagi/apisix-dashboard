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
import './ResourceTable.css';

import {
  type ProColumns,
  ProTable,
  type ProTableProps,
} from '@ant-design/pro-components';
import {
  Button,
  Checkbox,
  Empty,
  Grid,
  Popover,
  Radio,
  Tag,
  Tooltip,
} from 'antd';
import dayjs from 'dayjs';
import {
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CopyableID } from '@/components/CopyableID';
import IconChevronRight from '~icons/material-symbols/chevron-right';
import IconRefresh from '~icons/material-symbols/refresh';
import IconViewColumn from '~icons/material-symbols/view-column-outline';

type ResourceRecord = {
  value: {
    id?: string | number;
    name?: string;
    username?: string;
    create_time?: number;
    update_time?: number;
  };
};
type View = { columns?: string[]; density: 'small' | 'middle' | 'large' };
type Props<T extends ResourceRecord> = ProTableProps<
  T,
  Record<string, unknown>
> & {
  resourceName: string;
  query?: string;
  label?: string;
  onClearFilters?: () => void;
  selectionActions?: ReactNode;
  primaryColumn?: string;
};

const readView = (key: string): View => {
  try {
    const value = JSON.parse(
      localStorage.getItem(key) ?? 'null',
    ) as View | null;
    if (
      value &&
      ['small', 'middle', 'large'].includes(value.density) &&
      (value.columns === undefined ||
        (Array.isArray(value.columns) &&
          value.columns.every((column) => typeof column === 'string')))
    )
      return value;
  } catch {
    /* Storage is optional. */
  }
  return { density: 'middle' };
};

/** Shared presentation for the existing Admin API resource lists. */
export function ResourceTable<T extends ResourceRecord>({
  resourceName,
  query,
  label,
  onClearFilters,
  selectionActions,
  primaryColumn,
  ...props
}: Props<T>) {
  const {
    columns = [],
    dataSource = [],
    pagination,
    headerTitle,
    rowSelection,
  } = props;
  const tableId = useId();
  const tableRef = useRef<HTMLElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const identityId = (record: T) =>
    `${tableId}-${encodeURIComponent(String(typeof props.rowKey === 'function' ? props.rowKey(record) : (record.value.id ?? record.value.username)))}`;
  const screens = Grid.useBreakpoint();
  const storageKey = `resource-table:v1:${props.columnsState?.persistenceKey ?? resourceName}`;
  const savedView = useMemo(() => readView(storageKey), [storageKey]);
  const [changedView, setChangedView] = useState<{
    key: string;
    value: View;
  }>();
  const view = changedView?.key === storageKey ? changedView.value : savedView;
  const [filters, setFilters] = useState<
    Record<string, (string | number | bigint | boolean)[] | null>
  >({});
  const primaryKey =
    primaryColumn ??
    (columns.some((column) => column.key === 'name')
      ? 'name'
      : columns.some((column) => column.key === 'username')
        ? 'username'
        : 'id');
  const defaultKeys = columns
    .filter(
      (column) =>
        !column.hideInTable &&
        props.columnsState?.defaultValue?.[String(column.key)]?.show !==
          false &&
        column.key !== 'create_time' &&
        !(primaryKey === 'name' && column.key === 'id'),
    )
    .map((column) => String(column.key));
  const visibleKeys = view.columns ?? defaultKeys;
  const requiredKeys = [primaryKey, 'raw', 'option'];
  const hasRawAction = columns.some((column) => column.key === 'raw');
  const total = pagination
    ? (pagination.total ?? dataSource.length)
    : dataSource.length;
  const activeColumnFilters = Object.entries(filters).filter(
    ([, values]) => values?.length,
  );
  const hasFilters = Boolean(query || label || activeColumnFilters.length);

  useEffect(() => {
    const scroller =
      tableRef.current?.querySelector<HTMLElement>('.ant-table-content');
    if (!scroller) return;
    const update = () => {
      const scrollable = scroller.scrollWidth > scroller.clientWidth;
      scroller.tabIndex = scrollable ? 0 : -1;
      if (scrollable) {
        scroller.setAttribute('role', 'region');
        scroller.setAttribute(
          'aria-label',
          `${resourceName} columns. Use left and right arrow keys to scroll.`,
        );
      } else {
        scroller.removeAttribute('role');
        scroller.removeAttribute('aria-label');
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    update();
    return () => observer.disconnect();
  }, [dataSource, resourceName, view]);

  const updateView = (value: View) => {
    setChangedView({ key: storageKey, value });
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Storage is optional. */
    }
  };
  const clearFilters = () => {
    setFilters({});
    onClearFilters?.();
  };
  const tableColumns: ProColumns<T>[] = columns
    .map((column) => {
      const key = String(column.key);
      const next: ProColumns<T> = {
        ...column,
        // Sorting has one visible control, instead of two conflicting sort states.
        sorter: undefined,
        defaultSortOrder: undefined,
        sortOrder: undefined,
        hideInTable: !requiredKeys.includes(key) && !visibleKeys.includes(key),
        filteredValue: filters[key] ?? null,
        fixed:
          key === 'raw' || (key === primaryKey && screens.md)
            ? 'left'
            : undefined,
        className: key === 'raw' ? 'resource-table-raw' : column.className,
        width:
          key === 'raw'
            ? 80
            : (column.width ?? (key === primaryKey ? 240 : 170)),
      };
      if (key === primaryKey) {
        next.width = primaryKey === 'name' ? 260 : 220;
        next.render = (dom, record, index, action, schema) => {
          const rendered =
            column.render?.(dom, record, index, action, schema) ?? dom;
          const content =
            typeof rendered === 'object' &&
            rendered !== null &&
            'children' in rendered &&
            'props' in rendered
              ? rendered.children
              : rendered;
          return (
            <div className="resource-table-identity" id={identityId(record)}>
              <div className="resource-table-name">{content}</div>
              {primaryKey === 'name' && record.value.id !== undefined && (
                <CopyableID id={String(record.value.id)} />
              )}
            </div>
          );
        };
      }
      if (key === 'create_time' || key === 'update_time') {
        next.width = 132;
        next.valueType = 'text';
        next.render = (_, record) => {
          const timestamp = record.value[key];
          if (!timestamp)
            return <span className="resource-table-muted">—</span>;
          const date = dayjs.unix(timestamp);
          return (
            <Tooltip title={date.format('YYYY-MM-DD HH:mm:ss')}>
              <time
                className="resource-table-date"
                dateTime={date.toISOString()}
                aria-label={date.format('YYYY-MM-DD HH:mm:ss')}
              >
                {date.format('YYYY-MM-DD')}
                <span>{date.format('HH:mm')}</span>
              </time>
            </Tooltip>
          );
        };
      }
      return next;
    })
    .sort((a, b) => {
      const order = (key: unknown) =>
        key === 'raw' ? -2 : key === primaryKey ? -1 : key === 'option' ? 1 : 0;
      return order(a.key) - order(b.key);
    });

  const viewSettings = (
    <div
      ref={viewRef}
      id={`${tableId}-view`}
      role="dialog"
      aria-label="Table view settings"
      className="resource-table-view"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setViewOpen(false);
          viewButtonRef.current?.focus();
          event.preventDefault();
        }
      }}
    >
      <strong>Row spacing</strong>
      <Radio.Group
        aria-label="Row spacing"
        value={view.density}
        onChange={(event) =>
          updateView({ ...view, density: event.target.value })
        }
      >
        <Radio.Button value="small">Compact</Radio.Button>
        <Radio.Button value="middle">Default</Radio.Button>
        <Radio.Button value="large">Roomy</Radio.Button>
      </Radio.Group>
      <strong>Visible columns</strong>
      <div className="resource-table-columns">
        {columns.map((column) => (
          <Checkbox
            key={String(column.key)}
            checked={
              requiredKeys.includes(String(column.key)) ||
              visibleKeys.includes(String(column.key))
            }
            disabled={requiredKeys.includes(String(column.key))}
            onChange={(event) =>
              updateView({
                ...view,
                columns: event.target.checked
                  ? [...visibleKeys, String(column.key)]
                  : visibleKeys.filter((key) => key !== String(column.key)),
              })
            }
          >
            {typeof column.title === 'string'
              ? column.title
              : String(column.key)}
          </Checkbox>
        ))}
      </div>
      <Button block onClick={() => updateView({ density: 'middle' })}>
        Reset view
      </Button>
      <span className="resource-table-muted">
        Saved for this table on this browser.
      </span>
    </div>
  );

  return (
    <section
      ref={tableRef}
      className="resource-table"
      aria-label={`${resourceName} list`}
    >
      <div className="resource-table-heading">
        <div className="resource-table-heading-title">
          {headerTitle || <strong>{resourceName}</strong>}
          <span
            className="resource-table-count"
            aria-label={`${total} results`}
          >
            {total.toLocaleString()}
          </span>
          {(query || label) && (
            <span className="resource-table-muted">Filtered results</span>
          )}
        </div>
        <div className="resource-table-controls">
          <Button
            icon={<IconRefresh />}
            loading={Boolean(props.loading)}
            onClick={(event) => {
              if (props.options && typeof props.options.reload === 'function')
                void props.options.reload(event);
            }}
          >
            Refresh
          </Button>
          <Popover
            trigger="click"
            placement="bottomRight"
            title="Table view"
            content={viewSettings}
            open={viewOpen}
            onOpenChange={setViewOpen}
            afterOpenChange={(open) => {
              if (open)
                viewRef.current
                  ?.querySelector<HTMLInputElement>('input:checked')
                  ?.focus();
            }}
          >
            <Button
              ref={viewButtonRef}
              icon={<IconViewColumn />}
              aria-haspopup="dialog"
              aria-expanded={viewOpen}
              aria-controls={`${tableId}-view`}
            >
              View
            </Button>
          </Popover>
        </div>
      </div>
      {hasFilters && (
        <div
          className="resource-table-filter-summary"
          role="region"
          aria-label="Active filters"
        >
          {query && <Tag>Search: {query}</Tag>}
          {label && <Tag>Label: {label}</Tag>}
          {activeColumnFilters.map(([key, values]) => (
            <Tag key={key}>
              {String(
                columns.find((column) => String(column.key) === key)?.title ??
                  key,
              )}
              :{' '}
              {values
                ?.map((value) => {
                  const option = columns.find(
                    (column) => String(column.key) === key,
                  )?.filters;
                  return Array.isArray(option)
                    ? String(
                        option.find((item) => item.value === value)?.text ??
                          value,
                      )
                    : String(value);
                })
                .join(', ')}{' '}
              (loaded rows)
            </Tag>
          ))}
          <Button type="link" size="small" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
      {selectionActions}
      <ProTable<T, Record<string, unknown>>
        {...props}
        className="resource-table-grid"
        columns={tableColumns}
        columnsState={undefined}
        size={view.density}
        options={false}
        headerTitle={false}
        expandable={
          props.expandable && {
            ...props.expandable,
            columnWidth: 44,
            fixed: hasRawAction || screens.md ? 'left' : undefined,
            expandIcon: ({ expanded, expandable, record, onExpand }) =>
              expandable ? (
                <button
                  type="button"
                  className="resource-table-expand"
                  aria-label={expanded ? 'Collapse row' : 'Expand row'}
                  aria-expanded={expanded}
                  aria-describedby={identityId(record)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onExpand(record, event);
                  }}
                >
                  <IconChevronRight aria-hidden="true" />
                </button>
              ) : null,
          }
        }
        tableAlertRender={false}
        tableAlertOptionRender={false}
        rowSelection={
          rowSelection && {
            ...rowSelection,
            fixed: hasRawAction || Boolean(screens.md),
            columnWidth: 44,
            getCheckboxProps: (record) => ({
              ...rowSelection.getCheckboxProps?.(record),
              'aria-label': 'Select row',
              'aria-describedby': identityId(record),
            }),
          }
        }
        onChange={(page, nextFilters, sorter, extra) => {
          setFilters(nextFilters);
          if (extra.action !== 'sort' && rowSelection)
            rowSelection.onChange?.([], [], { type: 'none' });
          props.onChange?.(page, nextFilters, sorter, extra);
        }}
        locale={{
          ...props.locale,
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div className="resource-table-empty">
                  <strong>
                    {hasFilters ? 'No matching resources' : 'No resources yet'}
                  </strong>
                  <span>
                    {hasFilters
                      ? 'Try another search or clear your filters to see more results.'
                      : 'Create your first resource using the Add button above.'}
                  </span>
                  {hasFilters && (
                    <Button onClick={clearFilters}>Clear filters</Button>
                  )}
                </div>
              }
            />
          ),
        }}
      />
      {onClearFilters && (
        <div className="resource-table-footnote">
          Search finds resources across pages. Column filters and sorting apply
          to loaded results.
        </div>
      )}
    </section>
  );
}
