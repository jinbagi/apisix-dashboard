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
import { useEffect, useRef } from 'react';

import { type RawTabRequest, useRawWorkspace } from '@/stores/rawWorkspace';

type RawDrawerProps = RawTabRequest & { open: boolean; onClose: () => void };

/** Existing resource pages hand their open request to the shared RAW workspace. */
export const RawDrawer = ({ open, onClose, api, title, initialData, onSaved }: RawDrawerProps) => {
  const { openTab } = useRawWorkspace();
  const opened = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!open || !api) { opened.current = undefined; return; }
    if (opened.current === api) return;
    opened.current = api;
    openTab({ api, title, initialData, onSaved });
    onClose();
  }, [api, initialData, onClose, onSaved, open, openTab, title]);
  return null;
};
