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


export const pageSearchSchema = z
  .object({
    page: z
      .union([z.string(), z.number()])
      .optional()
      .default(1)
      .transform((val) => Number.isInteger(Number(val)) && Number(val) >= 1 ? Number(val) : 1),
    page_size: z
      .union([z.string(), z.number()])
      .optional()
      .transform((val) => {
        if (val === undefined || val === null || val === '') return undefined;
        const n = Number(val);
        if (isNaN(n) || n < 10 || n > 500) return undefined;
        return n;
      }),
    name: z.string().optional(),
    q: z.string().optional(),
    uri: z.string().optional(),
    label: z.string().optional(),
    sort_by: z.string().optional(),
    sort_order: z.enum(['asc', 'desc']).optional(),

  })
  .passthrough();

export type PageSearchType = z.infer<typeof pageSearchSchema>;
