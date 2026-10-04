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
import { Alert, Button, Space, Typography } from 'antd';
import { useId, useMemo, useState } from 'react';
import type { ZodTypeAny } from 'zod';

import {
  formatJsonSchemaPath,
  getJsonSchemaFeedback,
} from '@/utils/jsonSchemaFeedback';
import type { ConditionalRequirement } from '@/utils/resourceJsonSchema';

import classes from './JsonSchemaGuide.module.css';

export type JsonSchemaGuideProps = {
  schema: ZodTypeAny;
  value: string;
  title?: string;
  compact?: boolean;
  collapsible?: boolean;
  ignoredPaths?: string[];
  identityPaths?: string[];
  identityValues?: Record<string, unknown>;
  conditionalRequirements?: ConditionalRequirement[];
  validAlertType?: 'success' | 'info';
  validMessage?: string | null;
};

export const JsonSchemaGuide = ({
  schema,
  value,
  title = 'APISIX schema guidance',
  compact = false,
  collapsible = false,
  ignoredPaths = [],
  identityPaths = [],
  identityValues = {},
  conditionalRequirements = [],
  validAlertType = 'success',
  validMessage = 'The current JSON satisfies the resource schema.',
}: JsonSchemaGuideProps) => {
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  const feedback = useMemo(() => {
    const result = getJsonSchemaFeedback(schema, value);
    const ignored = new Set(ignoredPaths);
    return {
      ...result,
      requiredPaths: result.requiredPaths.filter((path) => !ignored.has(path)),
      issues: result.issues.filter(
        (issue) => !ignored.has(formatJsonSchemaPath(issue))
      ),
    };
  }, [ignoredPaths, schema, value]);

  const visibleIssues = feedback.issues.slice(0, 8);
  const isValid = !feedback.syntaxError && feedback.issues.length === 0;
  // Invalid payloads always reveal their feedback, even when guidance is folded.
  const showDescription = !collapsible || expanded || !isValid;

  return (
    <div className={compact ? classes.compact : undefined}>
      <Alert
        className={classes.alert}
        type={feedback.syntaxError || feedback.issues.length > 0 ? 'warning' : validAlertType}
        showIcon
        title={<Typography.Text className={classes.guideTitle}>{title}</Typography.Text>}
        action={collapsible && isValid && (
          <Button
            size="small"
            type="text"
            aria-expanded={showDescription}
            aria-controls={showDescription ? descriptionId : undefined}
            onClick={() => setExpanded((current) => !current)}
          >
            {showDescription ? 'Hide guidance' : 'Show guidance'}
          </Button>
        )}
        description={showDescription && (
          <Space id={descriptionId} orientation="vertical" size={compact ? 3 : 6}>
            {identityPaths.length > 0 && (
              <div className={classes.guideSection}>
                <Typography.Text className={classes.sectionLabel} strong>Resource identity: </Typography.Text>
                <Space size={[4, 4]} wrap>
                  {identityPaths.map((path) => (
                    <span key={path}>
                      <Typography.Text code>{path}</Typography.Text>
                      {identityValues[path] !== undefined && (
                        <>
                          <Typography.Text type="secondary"> = </Typography.Text>
                          <Typography.Text code>
                            {String(identityValues[path])}
                          </Typography.Text>
                        </>
                      )}
                      <Typography.Text type="secondary">
                        {' '}(read-only, managed by the API path)
                      </Typography.Text>
                    </span>
                  ))}
                </Space>
              </div>
            )}
            <div className={classes.guideSection}>
              <Typography.Text className={classes.sectionLabel} strong>Always required for editing: </Typography.Text>
              {feedback.requiredPaths.length > 0 ? (
                <Space size={[4, 4]} wrap>
                  {feedback.requiredPaths.map((path) => (
                    <Typography.Text key={path} code>
                      {path}
                    </Typography.Text>
                  ))}
                </Space>
              ) : (
                <Typography.Text type="secondary">
                  No unconditional editable fields.
                </Typography.Text>
              )}
            </div>
            {conditionalRequirements.length > 0 && (
              <div className={classes.guideSection}>
                <Typography.Text className={classes.sectionLabel} strong>Conditional requirements:</Typography.Text>
                <ul
                  className={compact ? classes.compactList : undefined}
                  style={compact ? undefined : { margin: '4px 0 0', paddingLeft: 20 }}
                >
                  {conditionalRequirements.map((requirement) => (
                    <li
                      key={`${requirement.fieldGroups.flat().join(':')}:${requirement.description}`}
                    >
                      {requirement.fieldGroups.map((group, groupIndex) => (
                        <span key={group.join(':')}>
                          {groupIndex > 0 && <Typography.Text> or </Typography.Text>}
                          {group.map((field, fieldIndex) => (
                            <span key={field}>
                              {fieldIndex > 0 && <Typography.Text> + </Typography.Text>}
                              <Typography.Text code>{field}</Typography.Text>
                            </span>
                          ))}
                        </span>
                      ))}
                      {requirement.condition && (
                        <>
                          <Typography.Text> when </Typography.Text>
                          <Typography.Text code>
                            {requirement.condition.field}
                          </Typography.Text>
                          {requirement.condition.value && (
                            <>
                              <Typography.Text> = </Typography.Text>
                              <Typography.Text code>
                                {requirement.condition.value}
                              </Typography.Text>
                            </>
                          )}
                        </>
                      )}
                      <Typography.Text>{`: ${requirement.description}`}</Typography.Text>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {feedback.syntaxError ? (
              <Typography.Text type="danger">
                JSON syntax: {feedback.syntaxError}
              </Typography.Text>
            ) : isValid ? (
              validMessage ? (
                <Typography.Text type="success">
                  {validMessage}
                </Typography.Text>
              ) : null
            ) : (
              <div>
                <Typography.Text strong type="warning">
                  Current payload needs attention:
                </Typography.Text>
                <ul
                  className={compact ? classes.compactList : undefined}
                  style={compact ? undefined : { margin: '4px 0 0', paddingLeft: 20 }}
                >
                  {visibleIssues.map((issue, index) => (
                    <li key={`${formatJsonSchemaPath(issue)}-${issue.code}-${index}`}>
                      <Typography.Text code>
                        {formatJsonSchemaPath(issue)}
                      </Typography.Text>
                      {`: ${issue.message}`}
                    </li>
                  ))}
                  {feedback.issues.length > visibleIssues.length && (
                    <li>{feedback.issues.length - visibleIssues.length} more issue(s)</li>
                  )}
                </ul>
              </div>
            )}
          </Space>
        )}
      />
    </div>
  );
};
