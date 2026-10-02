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

import { z } from 'zod';

import { APISIXCommon } from './common';

const resourceId = z.union([z.string().min(1).max(64).regex(/^[a-zA-Z0-9-._]+$/), z.number().int().min(1)]);

export const GraphqlCostDecoration = APISIXCommon.Basic.omit({ status: true }).extend({
  id: resourceId.optional(),
  service_id: resourceId.optional(),
  field_path: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/, 'Use a GraphQL type or field path, such as Query.products'),
  add_value: z.number().min(0).optional(),
  add_arguments: z.array(z.string().min(1)).optional(),
  mul_value: z.number().min(0).optional(),
  mul_arguments: z.array(z.string().min(1)).optional(),
  create_time: z.number().optional(),
  update_time: z.number().optional(),
}).strict();

export const GraphqlCostDecorationForm = GraphqlCostDecoration.extend({ id: resourceId.or(z.literal('')).optional() });

export type GraphqlCostDecorationType = z.infer<typeof GraphqlCostDecoration>;
