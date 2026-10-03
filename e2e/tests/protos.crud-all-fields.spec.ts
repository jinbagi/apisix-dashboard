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

import { protosPom } from '@e2e/pom/protos';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

import { API_PROTOS } from '@/config/constant';
import type { APISIXType } from '@/types/schema/apisix';

const protoContent = `syntax = "proto3";
package test;

message TestMessage {
  string name = 1;
  int32 age = 2;
  string email = 3;
}`;

let createdProtoId: string;
const customProtoId = randomId('custom-proto-with-a-long-id');

test.describe('CRUD proto with all fields', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1280, height: 900 } });

  test.afterAll(async () => {
    // cleanup: delete the proto
    if (createdProtoId) {
      await e2eReq.delete(`${API_PROTOS}/${createdProtoId}`).catch(() => {
        // ignore error if proto doesn't exist
      });
    }
  });

  test('should create a proto with all fields', async ({ page }) => {
    await test.step('navigate to add proto page', async () => {
      await protosPom.toAdd(page);
      await protosPom.isAddPage(page);
    });

    await test.step('fill in all fields', async () => {
      await page.getByLabel('ID', { exact: true }).fill(customProtoId);
      await page.getByLabel('Name', { exact: true }).fill('Custom ID proto');
      await page.getByLabel('Content').fill(protoContent);
    });

    await test.step('submit the form', async () => {
      await page.getByRole('button', { name: 'Add', exact: true }).click();

      await protosPom.isDetailPage(page);
      createdProtoId = new URL(page.url()).pathname.split('/').pop() ?? '';
      expect(createdProtoId).toBe(customProtoId);
      await expect(page.getByLabel('ID', { exact: true })).toBeDisabled();
    });

    await test.step('verify proto was created via API', async () => {
      const proto = await e2eReq
        .get<unknown, APISIXType['RespProtoDetail']>(
          `${API_PROTOS}/${createdProtoId}`
        )
        .then((v) => v.data);

      expect(proto.value?.id).toBe(createdProtoId);
      expect(proto.value?.content).toBe(protoContent);
    });
  });

  test('should read/view the proto details', async ({ page }) => {
    await test.step('verify proto can be retrieved via API', async () => {
      const proto = await e2eReq
        .get<unknown, APISIXType['RespProtoDetail']>(
          `${API_PROTOS}/${createdProtoId}`
        )
        .then((v) => v.data);

      expect(proto.value?.id).toBe(createdProtoId);
      expect(proto.value?.content).toBe(protoContent);
      expect(proto.value?.create_time).toBeDefined();
      expect(proto.value?.update_time).toBeDefined();
    });

    await test.step('navigate to proto details page and verify UI', async () => {
      // Navigate to protos list page first
      await protosPom.toIndex(page);
      await protosPom.isIndexPage(page);

      // Find and click the View button for the created proto
      const row = protosPom.getProtoRow(page, createdProtoId);
      await row.getByRole('link', { name: 'Custom ID proto', exact: true }).click();
      
      // Verify we're on the detail page
      await protosPom.isDetailPage(page);

      // Verify the content is displayed correctly on the details page
      const pageContent = await page.textContent('body');
      expect(pageContent).toContain('package test;');
      expect(pageContent).toContain('TestMessage');
    });
  });

  test('should update the proto with new values', async ({ page }) => {
    const updatedContent = `syntax = "proto3";
package test_updated;

message UpdatedTestMessage {
  string updated_name = 1;
  int32 updated_age = 2;
  string email = 3;
  bool is_active = 4;
}`;

    await test.step('navigate to proto detail page', async () => {
      // Should already be on detail page from previous test, but navigate to be safe
      await protosPom.toIndex(page);
      await protosPom.isIndexPage(page);

      const row = protosPom.getProtoRow(page, createdProtoId);
      await row.getByRole('link', { name: 'Custom ID proto', exact: true }).click();
      await protosPom.isDetailPage(page);
    });

    await test.step('enter edit mode and update content', async () => {
      const contentField = page.getByLabel('Content');
      await contentField.clear();
      await contentField.fill(updatedContent);
    });

    await test.step('save the changes', async () => {
      const saveResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          response.url().includes(`${API_PROTOS}/${createdProtoId}`)
      );
      await page.getByRole('button', { name: 'Save' }).click();
      await page
        .getByRole('dialog', { name: 'Review changes before saving' })
        .getByRole('button', { name: 'Confirm & Save' })
        .click();

      const response = await saveResponse;
      const requestPayload = response.request().postDataJSON() as Record<
        string,
        unknown
      >;
      expect(requestPayload).toMatchObject({
        content: updatedContent,
      });
      expect(requestPayload).not.toHaveProperty('id');
      expect(requestPayload).not.toHaveProperty('create_time');
      expect(requestPayload).not.toHaveProperty('update_time');
      await protosPom.isDetailPage(page);
    });

    await test.step('verify proto was updated', async () => {
      // Verify the updated content is displayed
      const pageContent = await page.textContent('body');
      expect(pageContent).toContain('package test_updated');
      expect(pageContent).toContain('UpdatedTestMessage');

      // Also verify via API
      const proto = await e2eReq
        .get<unknown, APISIXType['RespProtoDetail']>(
          `${API_PROTOS}/${createdProtoId}`
        )
        .then((v) => v.data);

      expect(proto.value?.id).toBe(createdProtoId);
      expect(proto.value?.content).toBe(updatedContent);
    });
  });

  test('should delete the proto', async ({ page }) => {
    await test.step('navigate to detail page and delete', async () => {
      // Navigate to protos list page first
      await protosPom.toIndex(page);
      await protosPom.isIndexPage(page);

      // Find and click the View button
      const row = protosPom.getProtoRow(page, createdProtoId);
      await row.getByRole('link', { name: 'Custom ID proto', exact: true }).click();
      await protosPom.isDetailPage(page);

      // Click Delete button
      await page.getByRole('button', { name: 'Delete' }).click();

      // Confirm deletion in the dialog
      const deleteDialog = page.getByRole('dialog', { name: 'Delete Proto' });
      await expect(deleteDialog).toBeVisible();
      await deleteDialog.getByRole('button', { name: 'Delete' }).click();
    });

    await test.step('verify deletion and redirect', async () => {
      // Should redirect to list page after deletion
      await protosPom.isIndexPage(page);

      // Verify proto is not in the list (check in table cells specifically)
      await expect(page.getByRole('cell', { name: createdProtoId })).toBeHidden();
    });

    await test.step('verify proto was deleted via API', async () => {
      await expect(async () => {
        await e2eReq.get(`${API_PROTOS}/${createdProtoId}`);
      }).rejects.toThrow();
    });
  });
});
