import { expect, test } from "@playwright/test";

test.describe("wildfire dashboard", () => {
  test("loads real FIRMS data, map and status", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Demo snapshot", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Latest observation/)).toContainText("UTC");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    const tab = page.getByRole("tabpanel");
    await expect(tab.getByText("Observed satellite data")).toBeVisible();
    await expect(tab.getByText("Detections", { exact: true })).toBeVisible();
    // Map shows an aggregate or points summary sourced from the API.
    await expect(page.getByText(/aggregated to .* cells|of [\d,]+ detections/).first()).toBeVisible();
  });

  test("confidence filter changes the summary", async ({ page }) => {
    await page.goto("/");
    const stat = page.getByRole("tabpanel").locator(".mono").first();
    await expect(stat).not.toHaveText("—");
    const before = await stat.textContent();
    await page.getByRole("complementary", { name: "Filters" }).getByRole("button", { name: "Nominal" }).click();
    await expect(stat).not.toHaveText(before ?? "", { timeout: 20_000 });
  });

  test("select a cluster and open the explorer", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Clusters" }).click();
    const first = page.getByRole("list", { name: "Observation clusters" }).getByRole("button").first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByText("Observation cluster", { exact: true })).toBeVisible();
    await expect(page.getByText("not a fire perimeter", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Compare Sentinel-2 imagery/ })).toHaveAttribute("href", /\/compare\?bbox=/);
  });

  test("shows an error state when the API fails", async ({ page }) => {
    await page.route("**/api/analytics/summary**", (r) => r.fulfill({ status: 503, body: JSON.stringify({ detail: "Upstream unavailable" }), contentType: "application/json" }));
    await page.goto("/");
    await expect(page.getByRole("alert").filter({ hasText: "Upstream unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
  });
});

test("analytics shows historical baseline", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: /Spatial and temporal distribution/ })).toBeVisible();
  await expect(page.getByText(/Annual detections 2012/)).toBeVisible();
  await page.getByLabel("Historical baseline country").selectOption("Brazil");
  await expect(page.getByRole("img", { name: /Annual MODIS detections for Brazil/ })).toBeVisible();
});

test("flood module runs the model on a held-out chip", async ({ page }) => {
  await page.goto("/flood");
  await expect(page.getByText("Held-out test chip")).toBeVisible();
  await expect(page.getByText("Model (HGB)")).toBeVisible();
  await expect(page.getByText("Experimental AI prediction").first()).toBeVisible();
  await page.getByRole("button", { name: /Cambodia/ }).click();
  await expect(page.getByText("Cross-validation chip")).toBeVisible();
  await expect(page.getByText("Never trained on")).toBeVisible();
  await expect(page.getByText(/Mekong/).first()).toBeVisible();
});

test("model card renders evaluation from metrics.json", async ({ page }) => {
  await page.goto("/model");
  await expect(page.getByText("Leave-one-event-out F1 (10 events)")).toBeVisible();
  await expect(page.getByText(/Bolivia hold-out F1/)).toBeVisible();
  await expect(page.getByText("Published Otsu masks (scene-level)").first()).toBeVisible();
  await expect(page.getByText("Known failure modes (from the evaluation)")).toBeVisible();
});

test("methods page lists data sources", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("link", { name: /FIRMS active fire/ })).toBeVisible();
  await expect(page.getByText(/Contains modified Copernicus Sentinel data/)).toBeVisible();
});

test("compare page validates its parameters", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("alert")).toContainText("Missing or invalid bbox/date");
});

test("imagery comparison renders real Sentinel-2 scenes", async ({ page }) => {
  test.skip(process.env.E2E_NETWORK !== "1", "requires internet access to Earth Search / AWS (set E2E_NETWORK=1)");
  test.setTimeout(120_000);
  await page.goto("/compare?bbox=136.28555,-20.3277,136.88141,-19.93858&date=2026-11-05&label=e2e");
  await expect(page.getByLabel("Before (pre-detection)")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/sentinel-2[abc]/).first()).toBeVisible({ timeout: 90_000 });
});
