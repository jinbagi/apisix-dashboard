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
import { clsx } from 'clsx';
import { type PropsWithChildren, useCallback, useState } from 'react';

import { useRevealFormSection } from '@/utils/formNavigation';
import IconExpandLess from '~icons/material-symbols/expand-less';
import IconExpandMore from '~icons/material-symbols/expand-more';

import classes from './ResourceHierarchy.module.css';

type ResourceStage = 'route' | 'service' | 'upstream' | 'nodes';

const stages: Array<{
  key: ResourceStage;
  title: string;
  description: string;
}> = [
  { key: 'route', title: 'Route', description: 'Matches traffic' },
  { key: 'service', title: 'Service', description: 'Shares policy' },
  { key: 'upstream', title: 'Upstream', description: 'Selects backends' },
  { key: 'nodes', title: 'Nodes', description: 'Serve requests' },
];

type ResourceHierarchyProps = {
  current: Exclude<ResourceStage, 'nodes'>;
  resolvedThrough?: 'service' | 'upstream' | 'inline-upstream';
};

export const ResourceHierarchy = ({
  current,
  resolvedThrough,
}: ResourceHierarchyProps) => {
  const resolvedStages = new Set<ResourceStage>();
  if (resolvedThrough === 'service') {
    resolvedStages.add('service');
    resolvedStages.add('upstream');
    resolvedStages.add('nodes');
  }
  if (resolvedThrough === 'upstream' || resolvedThrough === 'inline-upstream') {
    resolvedStages.add('upstream');
    resolvedStages.add('nodes');
  }
  if (current === 'upstream') {
    resolvedStages.add('nodes');
  }

  return (
    <div className={classes.root} aria-label="APISIX traffic resource hierarchy">
      {stages.map((stage, index) => (
        <div
          key={stage.key}
          className={clsx(
            classes.stage,
            stage.key === current && classes.stageCurrent,
            stage.key !== current &&
              resolvedStages.has(stage.key) &&
              classes.stageResolved
          )}
        >
          <span className={classes.eyebrow}>
            {stage.key === current ? 'Editing' : `Step ${index + 1}`}
          </span>
          <span className={classes.title}>{stage.title}</span>
          <span className={classes.description}>{stage.description}</span>
        </div>
      ))}
    </div>
  );
};

type DependencyChoiceProps = PropsWithChildren & {
  step: number;
  title: string;
  description: string;
  selected?: boolean;
  disabled?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
};

export const DependencyChoice = ({
  step,
  title,
  description,
  selected = false,
  disabled = false,
  collapsible = false,
  defaultOpen = true,
  children,
}: DependencyChoiceProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const sectionRef = useRevealFormSection(useCallback(() => setOpen(true), []));

  return (
    <div
      ref={sectionRef}
      className={clsx(
        classes.choice,
        selected && classes.choiceSelected,
        disabled && classes.choiceDisabled
      )}
      data-toc-exclude-descendants={collapsible ? true : undefined}
    >
      <div className={classes.choiceHeader}>
        <span className={classes.choiceNumber}>{step}</span>
        <div className={classes.choiceCopy}>
          <div className={classes.choiceTitle}>{title}</div>
          <div className={classes.choiceDescription}>{description}</div>
        </div>
        {collapsible && (
          <button
            type="button"
            className={classes.choiceToggle}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <IconExpandLess /> : <IconExpandMore />}
            {open ? 'Hide configuration' : 'Configure inline'}
          </button>
        )}
      </div>
      <div
        className={clsx(
          classes.choiceBody,
          (!collapsible || open) && classes.choiceBodyOpen
        )}
      >
        <div className={classes.choiceBodyContent} inert={collapsible && !open} aria-hidden={collapsible && !open}>{children}</div>
      </div>
    </div>
  );
};
