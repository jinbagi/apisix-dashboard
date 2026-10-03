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
import { Card, theme } from 'antd';
import { clsx } from 'clsx';
import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { FormTOCCtx } from '@/utils/form-context';
import { revealFormTarget, useRevealFormSection } from '@/utils/formNavigation';
import { useShallowEffect } from '@/utils/hooks';
import IconExpandMore from '~icons/material-symbols/expand-more';

import classes from './style.module.css';

const SectionDepthCtx = createContext<number>(0);

const SectionDepthProvider = SectionDepthCtx.Provider;

const tocSelector = 'form-section';
const tocValue = 'data-label';
const tocDepth = 'data-depth';

type TOCItem = {
  id: string;
  label: string;
  depth: number;
};

function toSectionId(label: string, index: number): string {
  return `form-section-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item'}-${index}`;
}

function isSameTOCItems(a: TOCItem[], b: TOCItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const target = b[index];
      return item.id === target.id && item.label === target.label && item.depth === target.depth;
    })
  );
}

export type FormSectionProps = PropsWithChildren & {
  legend?: ReactNode;
  extra?: ReactNode;
  disabled?: boolean;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
};

const LegendGroup = ({
  legend,
  extra,
  advanced,
  collapsible,
  open,
  onToggle,
}: {
  legend: ReactNode;
  extra?: ReactNode;
  advanced?: boolean;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) => {
  if (!legend && !extra) {
    return null;
  }
  return (
    <div style={{ alignItems: 'center', display: 'flex', gap: 8, width: '100%' }}>
      <div
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? open : undefined}
        onClick={onToggle}
        onKeyDown={
          collapsible
            ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggle?.();
                }
              }
            : undefined
        }
        style={{
          alignItems: 'center',
          cursor: collapsible ? 'pointer' : undefined,
          display: 'flex',
          flex: 1,
          gap: 8,
        }}
      >
        {collapsible && (
          <span className={clsx(classes.chevronIcon, open && classes.chevronIconOpen)}>
            <IconExpandMore />
          </span>
        )}
        {legend}
        {advanced && <span className={classes.advancedBadge}>Advanced</span>}
      </div>
      {extra}
    </div>
  );
};

export const FormSection = (props: FormSectionProps) => {
  const { className, legend, extra, children, disabled, collapsible, defaultOpen, ...restProps } = props;
  const parentDepth = useContext(SectionDepthCtx);
  const { refreshTOC } = useContext(FormTOCCtx);
  const depth = useMemo(() => parentDepth + 1, [parentDepth]);
  const { token } = theme.useToken();
  const dataAttrs = useMemo(
    () => ({
      [tocValue]: typeof legend === 'string' ? legend : undefined,
      [tocDepth]: depth,
    }),
    [legend, depth]
  );
  const [open, setOpen] = useState(defaultOpen ?? true);

  const sectionRef = useRevealFormSection(useCallback(() => setOpen(true), []));

  // refresh TOC when children changes
  useShallowEffect(refreshTOC, [children]);

  useEffect(() => {
    refreshTOC();
  }, [open, refreshTOC]);

  if (depth === 1) {
    return (
      <SectionDepthProvider value={depth}>
        <Card
          ref={sectionRef}
          size="small"
          title={
            <LegendGroup
              legend={legend}
              extra={extra}
              advanced={collapsible && defaultOpen === false}
              collapsible={collapsible}
              open={open}
              onToggle={collapsible ? () => setOpen((value) => !value) : undefined}
            />
          }
          classNames={{
            header: collapsible ? classes.collapsibleCardHeader : undefined,
          }}
          className={clsx(tocSelector, classes.root, classes.premiumCard, className)}
          style={{ marginBottom: 16 }}
          data-section-open={open}
          {...dataAttrs}
          {...(restProps as React.HTMLAttributes<HTMLDivElement>)}
        >
          <div className={clsx(classes.collapsibleContainer, open && classes.collapsibleContainerOpen)}>
            <div className={classes.collapsibleContent} inert={!open} aria-hidden={!open}>
              <fieldset disabled={disabled} style={{ minWidth: 0, border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
                {children}
              </fieldset>
            </div>
          </div>
        </Card>
      </SectionDepthProvider>
    );
  }

  return (
    <SectionDepthProvider value={depth}>
      <div
        className={clsx(tocSelector, classes.root, classes.subSection, className)}
        {...dataAttrs}
        {...(restProps as React.HTMLAttributes<HTMLDivElement>)}
      >
        {(legend || extra) && (
          <div style={{ marginBottom: 8, color: token.colorTextSecondary, fontWeight: 'var(--app-font-weight-label)', fontSize: token.fontSizeSM }}>
            <LegendGroup legend={legend} extra={extra} />
          </div>
        )}
        <fieldset disabled={disabled} style={{ minWidth: 0, border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 0 }}>
          {children}
        </fieldset>
      </div>
    </SectionDepthProvider>
  );
};

export type FormTOCBoxProps = PropsWithChildren;

export const FormTOCBox = (props: FormTOCBoxProps) => {
  const { children } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<TOCItem[]>([]);
  const [activeId, setActiveId] = useState<string>();

  const refreshTOC = useCallback(() => {
    window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;

      const nodes = Array.from(
        container.querySelectorAll<HTMLElement>(`.${tocSelector}[${tocValue}]`)
      ).filter((node) => {
        const collapsedParent = node.parentElement?.closest(
          '[data-section-open="false"]'
        );
        const excludedParent = node.parentElement?.closest(
          '[data-toc-exclude-descendants="true"]'
        );
        return !collapsedParent && !excludedParent && !node.closest('.ant-tabs-tabpane-hidden');
      });
      const nextItems = nodes
        .map((node, index) => {
          const label = node.getAttribute(tocValue);
          if (!label) return null;

          if (!node.id) {
            node.id = toSectionId(label, index);
          }

          return {
            id: node.id,
            label,
            depth: Number(node.getAttribute(tocDepth) ?? 1),
          };
        })
        .filter((item): item is TOCItem => item !== null);

      setItems((prev) => (isSameTOCItems(prev, nextItems) ? prev : nextItems));
      setActiveId((prev) => prev ?? nextItems[0]?.id);
    });
  }, []);

  useEffect(() => {
    refreshTOC();
  }, [refreshTOC, children]);

  useEffect(() => {
    const updateActiveSection = () => {
      const positionedItems = items
        .map((item) => {
          const node = document.getElementById(item.id);
          return node ? { id: item.id, top: node.getBoundingClientRect().top } : null;
        })
        .filter((item): item is { id: string; top: number } => item !== null);

      if (positionedItems.length === 0) return;

      const current =
        [...positionedItems].reverse().find((item) => item.top <= 120) ?? positionedItems[0];
      setActiveId(current.id);
    };

    updateActiveSection();
    window.addEventListener('scroll', updateActiveSection, { passive: true });
    window.addEventListener('resize', updateActiveSection);
    return () => {
      window.removeEventListener('scroll', updateActiveSection);
      window.removeEventListener('resize', updateActiveSection);
    };
  }, [items]);

  const handleTOCClick = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (target) {
      revealFormTarget(target);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setActiveId(id);
  }, []);

  const showTOC = items.length > 1;

  return (
    <FormTOCCtx.Provider value={{ refreshTOC }}>
      <div
        ref={containerRef}
        className={clsx(classes.tocLayout, !showTOC && classes.tocLayoutWithoutNav)}
      >
        <div className={classes.tocContent}>{children}</div>
        {showTOC && (
          <nav className={classes.tocNav} aria-label="Form sections">
            <div className={classes.tocTitle}>Sections</div>
            <div className={classes.tocList}>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={activeId === item.id ? 'location' : undefined}
                  className={clsx(classes.tocItem, activeId === item.id && classes.tocItemActive)}
                  style={{ paddingInlineStart: 10 + Math.max(item.depth - 1, 0) * 12 }}
                  onClick={() => handleTOCClick(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>
    </FormTOCCtx.Provider>
  );
};
