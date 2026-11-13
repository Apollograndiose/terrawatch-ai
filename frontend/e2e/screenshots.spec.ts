import { test } from "@playwright/test";

/**
 * Regenerates the README screenshots from the running app (real data, nothing staged).
 *   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
 */
test.skip(process.env.SCREENSHOTS !== "1", "set SCREENSHOTS=1 to regenerate docs/screenshots");
test.setTimeout(180_000);

const out = (n: string) => `../docs/screenshots/${n}.png`;

test("capture screenshots", async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(7000);
  await page.screenshot({ path: out("01-dashboard") });

  await page.getByRole("tab", { name: "Clusters" }).click();
  await page.getByRole("list", { name: "Observation clusters" }).getByRole("button").nth(1).click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: out("02-cluster-explorer") });

  await page.goto("/compare?bbox=136.28555,-20.3277,136.88141,-19.93858&date=2026-11-05&label=Australia%20cluster%20c4d7eb1d7dbce");
  await page.waitForTimeout(12000);
  await page.getByText("Change layer: dNBR").click();
  await page.waitForTimeout(10000);
  await page.screenshot({ path: out("03-imagery-compare-dnbr") });

  await page.goto("/analytics");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out("04-analytics"), fullPage: true });

  await page.goto("/flood");
  await page.waitForTimeout(6000);
  await page.getByLabel("Right overlay").selectOption("errors");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out("05-flood") });

  await page.goto("/model");
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out("06-model-card"), fullPage: true });
});
