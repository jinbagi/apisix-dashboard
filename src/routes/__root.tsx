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
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Outlet,
} from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { useAtomValue } from 'jotai';
import { type ReactNode, useEffect } from 'react';

import { Header } from '@/components/Header';
import { Navbar, SIDEBAR_COLLAPSED_WIDTH } from '@/components/Navbar';
import { AppErrorPage, AppNotFoundPage } from '@/components/page/AppErrorPage';
import { SettingsModal } from '@/components/page/SettingsModal';
import {
  APPSHELL_HEADER_HEIGHT,
  APPSHELL_NAVBAR_WIDTH,
} from '@/config/constant';
import { changeSetAtom } from '@/stores/changeSets';
import { sidebarCollapsedAtom, useThemeMode } from '@/stores/global';

const AppShell = ({ children }: { children: ReactNode }) => {
  const { mode } = useThemeMode();
  const collapsed = useAtomValue(sidebarCollapsedAtom);
  const stagedCount = useAtomValue(changeSetAtom).drafts.length;
  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : APPSHELL_NAVBAR_WIDTH;

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  useEffect(() => {
    if (!stagedCount) return;
    const protectDrafts = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectDrafts);
    return () => window.removeEventListener('beforeunload', protectDrafts);
  }, [stagedCount]);

  return (
    <>
      <Header />
      <Navbar />
      <div
        className="app-shell-content"
        style={{
          marginTop: APPSHELL_HEADER_HEIGHT,
          marginLeft: sidebarWidth,
          transition: 'margin-left 0.2s',
        }}
      >
        {children}
      </div>
      <SettingsModal />
    </>
  );
};

const Root = () => (
  <>
    <HeadContent />
    <AppShell>
      <Outlet />
    </AppShell>
    <TanStackRouterDevtools />
    <ReactQueryDevtools initialIsOpen={false} />
  </>
);

const RootError = (props: ErrorComponentProps) => (
  <>
    <HeadContent />
    <AppShell>
      <AppErrorPage {...props} />
    </AppShell>
  </>
);

export const Route = createRootRoute({
  component: Root,
  errorComponent: RootError,
  notFoundComponent: AppNotFoundPage,
});
