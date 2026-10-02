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
import { useNavigate } from '@tanstack/react-router';
import { Alert, Button, Input, type InputRef, Modal, Select, Spin, Tag } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';

import { RESOURCES } from '@/apis/dashboard';
import {
  loadSearchCollection, rankSearchItems, RESOURCE_LABELS,
  type ResourceSearchItem, type SearchCollection, type SearchResource,
} from '@/apis/resourceSearch';
import IconArrowForward from '~icons/material-symbols/arrow-forward';
import IconSearch from '~icons/material-symbols/search';

import classes from './GlobalSearch.module.css';

const PAGE_SIZE = 20;
const QUICK_ACTIONS = [
  { key: 'routes', name: 'Browse Routes', context: 'Match incoming requests', detailPath: '/routes', group: 'Navigate' },
  { key: 'services', name: 'Browse Services', context: 'Shared traffic configuration', detailPath: '/services', group: 'Navigate' },
  { key: 'upstreams', name: 'Browse Upstreams', context: 'Backend targets and load balancing', detailPath: '/upstreams', group: 'Navigate' },
  { key: 'topology', name: 'Open Topology', context: 'Explore resource relationships', detailPath: '/topology', group: 'Navigate' },
  { key: 'console', name: 'Open API Console', context: 'Inspect Admin API requests', detailPath: '/raw_api', group: 'Navigate' },
  { key: 'new-route', name: 'Create Route', context: 'Open a new route draft', detailPath: '/routes/add', group: 'Create' },
  { key: 'new-service', name: 'Create Service', context: 'Open a new service draft', detailPath: '/services/add', group: 'Create' },
  { key: 'new-upstream', name: 'Create Upstream', context: 'Open a new upstream draft', detailPath: '/upstreams/add', group: 'Create' },
];

export const GlobalSearch = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchResource['key'] | 'all'>('all');
  const [results, setResults] = useState<ResourceSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [retry, setRetry] = useState(0);
  const [resultKey, setResultKey] = useState('');
  const cache = useRef(new Map<string, SearchCollection>());
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<InputRef>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const navigate = useNavigate();
  const normalizedQuery = query.trim().toLowerCase();
  const searchKey = `${scope}:${normalizedQuery}`;
  const isSearching = !!normalizedQuery;
  const currentResults = resultKey === searchKey ? results : [];
  const isLoading = isSearching && (loading || resultKey !== searchKey);
  const visibleResults = currentResults.slice(0, limit);
  const choices = isSearching ? (isLoading ? [] : visibleResults) : QUICK_ACTIONS;
  const selected = Math.min(selectedIndex, Math.max(choices.length - 1, 0));
  const collections = scope === 'all' ? RESOURCES : RESOURCES.filter((r) => r.key === scope);

  const resetSelection = () => { setSelectedIndex(0); setLimit(PAGE_SIZE); };
  const close = () => {
    abort.current?.abort();
    setOpen(false);
    setQuery('');
    setScope('all');
    setResults([]);
    setResultKey('');
    setUnavailable([]);
    resetSelection();
    cache.current.clear();
  };
  const select = (choice: { detailPath: string }) => {
    close();
    void navigate({ to: choice.detailPath });
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!open || !normalizedQuery) return;
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(async () => {
      setLoading(true);
      const requested = scope === 'all' ? RESOURCES : RESOURCES.filter((r) => r.key === scope);
      const loaded = await Promise.all(requested.map(async (resource) => {
        const saved = cache.current.get(resource.key);
        if (saved && !saved.incomplete) return { resource, collection: saved };
        try {
          const collection = await loadSearchCollection(resource, controller.signal);
          if (!controller.signal.aborted) cache.current.set(resource.key, collection);
          return { resource, collection };
        } catch {
          return { resource, collection: { items: [], incomplete: true } };
        }
      }));
      if (controller.signal.aborted) return;
      setResults(rankSearchItems(loaded.flatMap(({ collection }) => collection.items), normalizedQuery));
      setUnavailable(loaded.filter(({ collection }) => collection.incomplete).map(({ resource }) => RESOURCE_LABELS[resource.key]));
      setResultKey(`${scope}:${normalizedQuery}`);
      setLoading(false);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, normalizedQuery, scope, retry]);

  useEffect(() => {
    resultsRef.current?.querySelector(`[id="${listId}-${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [listId, selected, isLoading, open]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.target !== inputRef.current?.input) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!choices.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((selected + direction + choices.length) % choices.length);
    } else if (event.key === 'Enter' && choices[selected]) {
      event.preventDefault();
      select(choices[selected]);
    }
  };

  return (
    <>
      <Button className={classes.trigger} icon={<IconSearch />} onClick={() => setOpen(true)} aria-label="Search resources" size="small">
        <span className={classes.triggerLabel}>Search resources</span>
        <kbd className={classes.shortcut}>Ctrl / ⌘ K</kbd>
      </Button>
      <Modal className={classes.modal} title="Find resources & go to" open={open} onCancel={close} footer={null} width={680}
        afterOpenChange={(visible) => { if (visible) inputRef.current?.focus(); }}>
        <div className={classes.inputArea}>
          <Input ref={inputRef} prefix={<IconSearch />} placeholder="Search by name, ID, URI, host or label"
            aria-label="Search all resources" role="combobox" aria-autocomplete="list" aria-expanded={open}
            aria-controls={listId} aria-activedescendant={choices.length ? `${listId}-${selected}` : undefined}
            value={query} onChange={(event) => { abort.current?.abort(); setQuery(event.target.value); resetSelection(); }}
            onKeyDown={handleKeyDown} allowClear size="large" />
          <Select aria-label="Resource type" value={scope} className={classes.scope}
            options={[{ value: 'all', label: 'All resources' }, ...RESOURCES.map((r) => ({ value: r.key, label: RESOURCE_LABELS[r.key] }))]}
            onChange={(value) => { abort.current?.abort(); setScope(value); resetSelection(); inputRef.current?.focus(); }} />
        </div>
        <div className={classes.summary} role="status">
          {!isSearching ? 'Jump to a workspace or start a new draft. Type to search gateway resources.'
            : isLoading ? 'Searching gateway resources…'
            : `${currentResults.length} ${unavailable.length ? 'available ' : ''}result${currentResults.length === 1 ? '' : 's'} · ${scope === 'all' ? 'All resources' : RESOURCE_LABELS[scope]}`}
        </div>
        {isSearching && !isLoading && unavailable.length > 0 && (
          <Alert className={classes.searchAlert} type="warning" showIcon
            message={unavailable.length === collections.length && !currentResults.length ? 'Search unavailable' : 'Results may be incomplete'}
            description={`Could not completely search: ${unavailable.join(', ')}. Available results are shown.`}
            action={<Button size="small" onClick={() => { setResultKey(''); setRetry((value) => value + 1); resetSelection(); }}>Retry</Button>} />
        )}
        <div className={classes.results} ref={resultsRef}>
          {isLoading && <div className={classes.emptyState}><Spin aria-label="Searching" /></div>}
          {!isLoading && isSearching && !currentResults.length && unavailable.length < collections.length && (
            <div className={classes.emptyState}>
              <strong>No results found{unavailable.length ? ' in the available collections' : ''}</strong>
              <p>Try a resource name, exact ID, URI, host or label.</p>
              <Button onClick={() => { setQuery(''); setScope('all'); resetSelection(); }}>Clear search</Button>
            </div>
          )}
          <div id={listId} role="listbox" aria-label={isSearching ? 'Resource results' : 'Quick navigation'}>
            {!isLoading && choices.map((choice, index) => (
              <div key={choice.key}>
                {!isSearching && (index === 0 || QUICK_ACTIONS[index - 1].group !== QUICK_ACTIONS[index].group) && (
                  <div className={classes.groupLabel}>{QUICK_ACTIONS[index].group}</div>
                )}
                <button id={`${listId}-${index}`} type="button" role="option" aria-selected={index === selected} tabIndex={-1}
                  onClick={() => select(choice)} onMouseEnter={() => setSelectedIndex(index)}
                  className={`${classes.result} ${index === selected ? classes.selected : ''}`}>
                  <span className={classes.resultCopy}>
                    <strong className={classes.resultName}>{choice.name}</strong>
                    <span className={classes.resultContext}>{'id' in choice ? `${choice.id}${choice.context ? ` · ${choice.context}` : ''}` : choice.context}</span>
                  </span>
                  {'resourceType' in choice && <Tag className={classes.resourceTag}>{RESOURCE_LABELS[choice.resourceType]}</Tag>}
                  <IconArrowForward className={classes.resultArrow} />
                </button>
              </div>
            ))}
          </div>
          {!isLoading && isSearching && currentResults.length > limit && (
            <Button block className={classes.showMore} onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              Show more ({currentResults.length - limit} remaining)
            </Button>
          )}
        </div>
        <div className={classes.footer}>
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
          <span><kbd>Esc</kbd> Close</span>
          <span className={classes.footerHint}>Opens a page; no changes are applied</span>
        </div>
      </Modal>
    </>
  );
};
