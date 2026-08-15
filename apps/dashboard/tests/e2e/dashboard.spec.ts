import { expect, test, type Page } from "@playwright/test";

const desktop = { width: 1440, height: 900 };
const mobile = { width: 375, height: 812 };

async function openDashboard(page: Page, viewport = desktop) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await expect(page.locator(".docketApp")).toBeVisible();
  await page.waitForFunction(() => {
    const control = document.querySelector(".viewModeButton");
    return (
      control !== null &&
      Object.keys(control).some((key) => key.startsWith("__reactProps$"))
    );
  });
}

async function selectMission(page: Page, id: string) {
  await page
    .locator(".missionCard")
    .filter({ hasText: id })
    .click();
  await expect(page.locator(".missionCard").filter({ hasText: id })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));

  expect(widths.document, "document should not exceed the viewport width").toBeLessThanOrEqual(
    widths.viewport,
  );
  expect(widths.body, "body should not exceed the viewport width").toBeLessThanOrEqual(
    widths.viewport,
  );
}

test("mobile shell preserves demo disclosure and exposes theme and route controls", async ({
  page,
}) => {
  await openDashboard(page, mobile);
  await expectNoHorizontalOverflow(page);

  const demoBadge = page.locator(".demoBadge");
  await expect(demoBadge).toBeVisible();
  await expect(demoBadge).toHaveAttribute(
    "title",
    "All runs, costs, and receipts shown are example data",
  );
  expect(
    await demoBadge.evaluate((element) => getComputedStyle(element, "::after").content),
  ).toBe('"Demo"');

  await page.getByRole("button", { name: "Open missions" }).click();
  const drawer = page.getByRole("dialog", { name: "Missions" });
  await expect(drawer).toBeVisible();

  const mobileControls = drawer.getByRole("region", { name: "Mobile workspace controls" });
  await mobileControls.getByRole("button", { name: "Use Mineral Blue atmosphere" }).click();
  await expect(page.locator(".docketApp")).toHaveAttribute("data-theme", "mineral");
  await expect(
    mobileControls.getByRole("button", { name: "Use Mineral Blue atmosphere" }),
  ).toHaveAttribute("aria-pressed", "true");

  const mobileRoutePolicy = mobileControls.getByRole("group", {
    name: "Routing policy for new work",
  });
  await mobileRoutePolicy.getByRole("button", { name: "Economy", exact: true }).click();
  await expect(
    mobileRoutePolicy.getByRole("button", { name: "Economy", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoHorizontalOverflow(page);
});

test("Ledger and Workshop keep mission selection synchronized", async ({ page }) => {
  await openDashboard(page);

  await page.getByRole("button", { name: "Operational workshop" }).click();
  await expect(
    page.getByRole("heading", { name: "See work move, not agents perform" }),
  ).toBeVisible();

  const workshopFloor = page.locator(".workshopFloor");
  await workshopFloor.getByRole("button", { name: /^DOC-191:/ }).click();
  await expect(
    page.locator(".workshopInspector").getByText("Write the v2 migration guide", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Evidence ledger" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Write the v2 migration guide" }),
  ).toBeVisible();
  await expect(
    page.locator(".missionsPane").getByRole("button", { name: /^DOC-191:/ }),
  ).toHaveAttribute("aria-pressed", "true");

  await selectMission(page, "DOC-176");
  await page.getByRole("button", { name: "Operational workshop" }).click();
  await expect(workshopFloor.getByRole("button", { name: /^DOC-176:/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("changing the global route mode does not rewrite the DOC-191 receipt snapshot", async ({
  page,
}) => {
  await openDashboard(page);
  await selectMission(page, "DOC-191");

  await page.getByRole("button", { name: "Use Quality routing for new work" }).click();
  await expect(
    page.getByRole("button", { name: "Use Quality routing for new work" }),
  ).toHaveAttribute("aria-pressed", "true");

  const trustDock = page.locator("#trust-dock");
  const snapshot = trustDock.locator(".receiptDetails dl > div").filter({
    hasText: "Policy snapshot",
  });
  await expect(snapshot.locator("dd")).toHaveText("docket-prod-7 · economy");
});

test("stopping one attempt keeps its mission recoverable", async ({ page }) => {
  await openDashboard(page);
  await selectMission(page, "DOC-191");

  const runHeader = page.locator(".runHeader");
  await runHeader.getByRole("button", { name: /^Stop/ }).click();
  await page.getByRole("menuitem", { name: /^Stop this attempt/ }).click();

  await expect(runHeader.getByText("Ready to reroute", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "The current worker attempt was stopped. The mission remains recoverable.",
  );
  await expect(page.getByText("The worker attempt was stopped.", { exact: true })).toBeVisible();
  await expect(page.getByText("This demo run is stopped.", { exact: true })).toHaveCount(0);
});

test("approval keeps integration pending and moves the DOC-184 pod to Ship", async ({ page }) => {
  await openDashboard(page);

  const trustDock = page.locator("#trust-dock");
  await trustDock.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    trustDock.getByRole("heading", { name: "Approval recorded · integration pending" }),
  ).toBeVisible();
  await expect(
    page.locator('.stageStepper li[aria-label="Integrate: pending integration"]'),
  ).toBeVisible();

  await page.getByRole("button", { name: "Operational workshop" }).click();
  const shipRoom = page.locator('.workshopRoom[data-workshop-stage="ship"]');
  const approvedPod = shipRoom.getByRole("button", { name: /^DOC-184:/ });
  await expect(approvedPod).toBeVisible();
  await expect(approvedPod).toHaveAttribute("aria-pressed", "true");
  await expect(approvedPod).toHaveAccessibleName(/Approved/);
});

test("mobile missions drawer traps keyboard focus and returns it to its trigger", async ({
  page,
}) => {
  await openDashboard(page, mobile);

  const trigger = page.getByRole("button", { name: "Open missions" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const drawer = page.getByRole("dialog", { name: "Missions" });
  await expect(drawer).toBeVisible();
  const close = drawer.getByRole("button", { name: "Close missions" });
  await expect(close).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Create mission" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});
