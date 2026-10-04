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
import { Alert, Button, Card, Empty, Table, Tag, Typography } from 'antd';

import classes from './ReverseReferences.module.css';
import { type Reference, useReverseReferences } from './reverseReferencesData';

type ReverseReferencesProps = {
  resourceType: 'upstream' | 'service';
  resourceId: string;
};

export const ReverseReferences = ({ resourceType, resourceId }: ReverseReferencesProps) => {
  const { data, error, isLoading, refetch } = useReverseReferences(resourceType, resourceId);

  return (
    <Card
      className={classes.card}
      title={
        <div className={classes.heading}>
          <span>Referenced by</span>
          <Typography.Text type="secondary" className={classes.summary}>
            Resources that depend on this {resourceType}
          </Typography.Text>
        </div>
      }
      extra={<Tag className={classes.count}>{data?.length ?? 0}</Tag>}
      loading={isLoading}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          title="References could not be verified"
          description="The dependency list is unavailable. Do not assume this resource is unused."
          action={
            <Button type="link" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : !data?.length ? (
        <Empty
          className={classes.empty}
          description="No resources reference this item"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Table<Reference>
          className={classes.table}
          size="small"
          dataSource={data}
          rowKey={(item) => `${item.type}:${item.id}`}
          pagination={false}
          columns={[
            {
              title: 'Resource',
              dataIndex: 'type',
              width: 150,
              render: (type: string) => <Tag className={classes.typeTag}>{type}</Tag>,
            },
            {
              title: 'Name',
              key: 'name',
              render: (_: unknown, item: Reference) => (
                <Link to={item.detailPath}>
                  <Typography.Text strong>{item.name || item.id}</Typography.Text>
                </Link>
              ),
            },
            {
              title: 'ID',
              dataIndex: 'id',
              render: (id: string) => (
                <Typography.Text className={classes.id}>{id}</Typography.Text>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
};
