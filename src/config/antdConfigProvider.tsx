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
import { ConfigProvider, Empty, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import { type PropsWithChildren, useEffect } from 'react';

import { useThemeMode } from '@/stores/global';

import {
  APP_FONT_SIZE_BASE,
  APP_FONT_SIZE_LG,
  APP_FONT_SIZE_SM,
  APP_FONT_SIZE_XL,
  APP_FONT_WEIGHT_STRONG,
} from './typography';

export const AntdConfigProvider = (props: PropsWithChildren) => {
  const { children } = props;
  const { mode } = useThemeMode();

  const isDark = mode === 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  return (
    <ConfigProvider
      virtual
      locale={enUS}
      renderEmpty={() => (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No items yet. Use the Add button above to create one."
        />
      )}
      theme={{
        algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        cssVar: {},
        token: {
          colorPrimary: isDark ? '#60a5fa' : '#2563eb',
          colorInfo: isDark ? '#60a5fa' : '#2563eb',
          colorBgLayout: isDark ? '#0f1115' : '#f4f6f8',
          colorBorder: isDark ? '#343a46' : '#d9dee7',
          colorBorderSecondary: isDark ? '#292f39' : '#e8ebf0',
          controlHeight: 38,
          fontFamily: 'var(--app-font-family)',
          fontFamilyCode: 'var(--app-font-monospace)',
          fontSize: APP_FONT_SIZE_BASE,
          fontSizeSM: APP_FONT_SIZE_SM,
          fontSizeLG: APP_FONT_SIZE_LG,
          fontSizeXL: APP_FONT_SIZE_XL,
          fontWeightStrong: APP_FONT_WEIGHT_STRONG,
          lineHeight: 1.45,
          lineHeightSM: 1.4,
          lineHeightLG: 1.5,
          borderRadiusSM: 6,
          borderRadius: 8,
          borderRadiusLG: 12,
        },
        components: {
          Typography: {
            colorTextDescription: 'var(--ant-color-text-secondary)',
          },
          Button: {
            fontWeight: APP_FONT_WEIGHT_STRONG,
            primaryShadow: 'none',
          },
          Card: {
            headerHeight: 52,
            bodyPadding: 24,
          },
          Input: {
            activeShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)',
          },
          Menu: {
            itemBorderRadius: 8,
            itemHeight: 40,
            itemMarginInline: 10,
            itemPaddingInline: 12,
          },
          Select: {
            activeOutlineColor: 'rgba(37, 99, 235, 0.12)',
          },
          Table: {
            cellPaddingBlock: 10,
            cellPaddingInline: 12,
            cellPaddingBlockMD: 9,
            cellPaddingInlineMD: 11,
            cellPaddingBlockSM: 8,
            cellPaddingInlineSM: 10,
            headerBg: isDark ? '#20242c' : '#f7f8fa',
            headerColor: isDark ? '#c9ced8' : '#4b5563',
            borderColor: isDark ? '#303641' : '#e7eaf0',
            rowHoverBg: isDark ? '#202936' : '#f6f9ff',
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
};
