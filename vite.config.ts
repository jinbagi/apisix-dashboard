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
import { fileURLToPath } from 'url';

import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import observerPlugin from 'mobx-react-observer/vite-plugin';
import UnpluginIcons from 'unplugin-icons/vite';
import UnpluginInfo from 'unplugin-info/vite';
import { defineConfig, loadEnv } from 'vite';

import { API_PREFIX, BASE_PATH } from './src/config/constant';

const inDevContainer = process.env.REMOTE_CONTAINERS === 'true';

if (inDevContainer) {
  // eslint-disable-next-line no-console
  console.info('Running in dev container');
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_APISIX_API_TARGET || 'http://localhost:9180';

  const proxyConfig: Record<string, any> = {
    [API_PREFIX]: {
      target: apiTarget,
      changeOrigin: true,
    },
  };

  if (inDevContainer) {
    proxyConfig[API_PREFIX] = {
      target: 'http://apisix:9180',
      changeOrigin: true,
    };
  }

  return {
    base: BASE_PATH,
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // Generated report HTML must not trigger full reloads during UI checks.
      watch: { ignored: ['**/playwright-report/**'] },
      // as an example, if you want to use the e2e server as the api server,
      proxy: proxyConfig,
      ...(inDevContainer && {
        host: '0.0.0.0',
        port: 5173,
        strictPort: true,
        hmr: {
          protocol: 'ws',
          host: '127.0.0.1',
          port: 5174,
        },
      }),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react/') || id.includes('react-dom/')) {
                return 'react-vendor';
              }
              if (id.includes('monaco-editor') || id.includes('@monaco-editor/react')) {
                return 'monaco-editor-vendor';
              }
              if (id.includes('antd') || id.includes('@ant-design/pro-components')) {
                return 'antd-vendor';
              }
              if (id.includes('@xyflow/react') || id.includes('dagre')) {
                return 'topology-vendor';
              }
              if (id.includes('@tanstack/react-query') || id.includes('@tanstack/react-router')) {
                return 'tanstack-vendor';
              }
            }
          },
        },
      },
    },
    plugins: [
      observerPlugin({
        exclude: [
          '**/src/routes/**',
          '**/routeTree.gen.ts',
          '**/src/components/Btn.tsx',
          '**/src/components/form/InputWrapper.tsx',
        ],
      }),
      UnpluginIcons({
        autoInstall: true,
        compiler: 'jsx',
        jsx: 'react',
      }),
      UnpluginInfo(),
      TanStackRouterVite({
        target: 'react',
        autoCodeSplitting: true,
        semicolons: false,
      }),
      react(),
    ],
  };
});
