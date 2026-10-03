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
import { routesPom } from '@e2e/pom/routes';
import { servicesPom } from '@e2e/pom/services';
import { randomId } from '@e2e/utils/common';
import { e2eReq } from '@e2e/utils/req';
import { test } from '@e2e/utils/test';
import { expect } from '@playwright/test';

import { deleteAllRoutes, postRouteReq } from '@/apis/routes';
import { deleteAllServices, postServiceReq } from '@/apis/services';
import type { RoutePostType } from '@/components/form-slice/FormPartRoute/schema';

test.describe.configure({ mode: 'serial' });

const serviceName = randomId('test-service');
const anotherServiceName = randomId('another-service');
const routes: RoutePostType[] = [
  {
    name: randomId('route1'),
    uri: '/api/v1/test1',
    methods: ['GET'],
  },
  {
    name: randomId('route2'),
    uri: '/api/v1/test2',
    methods: ['POST'],
  },
  {
    name: randomId('route3'),
    uri: '/api/v1/test3',
    methods: ['PUT'],
  },
];

// Route that uses upstream directly instead of service_id
const upstreamRoute: RoutePostType = {
  name: randomId('upstream-route'),
  uri: '/api/v1/upstream-test',
  methods: ['GET'],
  upstream: {
    nodes: [{ host: 'example.com', port: 80, weight: 100 }],
  },
};

// Route that belongs to another service
const anotherServiceRoute: RoutePostType = {
  name: randomId('another-service-route'),
  uri: '/api/v1/another-test',
  methods: ['GET'],
};

let testServiceId: string;
let anotherServiceId: string;
const createdRoutes: string[] = [];

test.beforeAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);

  // Create a test service for testing service routes
  const serviceResponse = await postServiceReq(e2eReq, {
    name: serviceName,
    desc: 'Test service for route listing',
  });

  testServiceId = serviceResponse.data.value.id;

  // Create another service
  const anotherServiceResponse = await postServiceReq(e2eReq, {
    name: anotherServiceName,
    desc: 'Another test service for route isolation testing',
  });

  anotherServiceId = anotherServiceResponse.data.value.id;

  // Create test routes under the service
  for (const route of routes) {
    const routeResponse = await postRouteReq(e2eReq, {
      ...route,
      service_id: testServiceId,
    });
    createdRoutes.push(routeResponse.data.value.id);
  }

  // Create a route that uses upstream directly instead of service_id
  await postRouteReq(e2eReq, upstreamRoute);

  // Create a route under another service
  await postRouteReq(e2eReq, {
    ...anotherServiceRoute,
    service_id: anotherServiceId,
  });
});

test.afterAll(async () => {
  await deleteAllRoutes(e2eReq);
  await deleteAllServices(e2eReq);
});

test('should only show routes with current service_id', async ({ page }) => {
  await test.step('should only show routes with current service_id', async () => {
    await servicesPom.toIndex(page);
    await servicesPom.isIndexPage(page);

    await page
      .getByRole('row', { name: serviceName })
      .getByRole('link', { name: serviceName, exact: true })
      .click();
    await servicesPom.isDetailPage(page);

    await servicesPom.getServiceRoutesTab(page).click();
    await servicesPom.isServiceRoutesPage(page);

    // Routes from another service should not be visible
    await expect(
      page.getByRole('cell', { name: anotherServiceRoute.name })
    ).toBeHidden();
    // Upstream route (without service_id) should not be visible
    await expect(
      page.getByRole('cell', { name: upstreamRoute.name })
    ).toBeHidden();
    // Only routes belonging to current service should be visible
    for (const route of routes) {
      await expect(page.getByRole('cell', { name: route.name })).toBeVisible();
    }
  });

  await test.step('without service_id routes should still exist in the routes list', async () => {
    await routesPom.toIndex(page);
    await routesPom.isIndexPage(page);

    // All routes should be visible in the global routes list
    await expect(
      page.getByRole('cell', { name: upstreamRoute.name })
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: anotherServiceRoute.name })
    ).toBeVisible();
    for (const route of routes) {
      await expect(page.getByRole('cell', { name: route.name })).toBeVisible();
    }
  });
});

test('should display routes list under service', async ({ page }) => {
  // Navigate to service detail page
  await servicesPom.toIndex(page);
  await servicesPom.isIndexPage(page);

  // Click on the service to go to detail page
  await page
    .getByRole('row', { name: serviceName })
    .getByRole('link', { name: serviceName, exact: true })
    .click();
  await servicesPom.isDetailPage(page);

  // Navigate to Routes tab
  await servicesPom.getServiceRoutesTab(page).click();
  await servicesPom.isServiceRoutesPage(page);

  await test.step('should display all routes under service', async () => {
    // Verify all created routes are displayed
    for (const route of routes) {
      await expect(page.getByRole('cell', { name: route.name })).toBeVisible();
      await expect(page.getByRole('cell', { name: route.uri })).toBeVisible();
    }
  });

  await test.step('should have correct table headers', async () => {
    await expect(page.getByRole('columnheader', { name: 'ID', exact: true })).toBeHidden();
    await expect(
      page.getByRole('columnheader', { name: 'Name' })
    ).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'URI' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'RAW' })).toBeVisible();
  });

  await test.step('should be able to navigate to route detail', async () => {
    // Click on the first route's View button
    await page
      .getByRole('row', { name: routes[0].name })
      .getByRole('link', { name: routes[0].name, exact: true })
      .click();

    await servicesPom.isServiceRouteDetailPage(page);

    // Verify we're on the correct route detail page
    const nameField = page.getByLabel('Name', { exact: true }).first();
    await expect(nameField).toHaveValue(routes[0].name);

    // Verify service_id is correct
    await nameField.fill(`${routes[0].name}-service-scope`);
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().includes(`/apisix/admin/routes/${createdRoutes[0]}`)
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
    expect(requestPayload.service_id).toBe(testServiceId);
    expect(requestPayload).not.toHaveProperty('upstream');
    expect(requestPayload).not.toHaveProperty('upstream_id');
  });

  await test.step('should have Add Route button', async () => {
    // Navigate back to service routes list
    await servicesPom.toServiceRoutes(page, testServiceId);
    await servicesPom.isServiceRoutesPage(page);

    // Verify Add Route button exists and is clickable
    const addRouteBtn = servicesPom.getAddRouteBtn(page);
    await expect(addRouteBtn).toBeVisible();

    await addRouteBtn.click();
    await servicesPom.isServiceRouteAddPage(page);

    // Verify service_id is pre-filled
    const serviceIdField = page.locator('[data-form-field="service_id"]');
    await expect(serviceIdField).toContainText(testServiceId);
    await expect(page.getByLabel('Service ID', { exact: true })).toBeDisabled();
  });

  await test.step('should show correct route count', async () => {
    // Navigate back to service routes list
    await servicesPom.toServiceRoutes(page, testServiceId);
    await servicesPom.isServiceRoutesPage(page);

    await expect(
      page.getByRole('cell', { name: `${routes[0].name}-service-scope` })
    ).toBeVisible();
    for (const route of routes.slice(1)) {
      await expect(page.getByRole('cell', { name: route.name })).toBeVisible();
    }
    await expect(
      page.getByRole('cell', { name: anotherServiceRoute.name })
    ).toBeHidden();
    await expect(
      page.getByRole('cell', { name: upstreamRoute.name })
    ).toBeHidden();
  });
});

