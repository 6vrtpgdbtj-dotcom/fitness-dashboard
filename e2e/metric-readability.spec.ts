import { expect, test } from "@playwright/test";

test("narrow dashboard keeps KPI labels horizontal and values inside two-column cards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo?role=admin");
  await page.evaluate(() => document.fonts.ready);

  const strip = page.locator(".metrics-strip");
  await expect(strip).toBeVisible();
  expect(await strip.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);

  for (const card of await page.locator(".metric-cell").all()) {
    const cardBox = (await card.boundingBox())!;
    const label = card.locator(".metric-label");
    const value = card.locator(".metric-value");
    const labelBox = (await label.boundingBox())!;
    const valueBox = (await value.boundingBox())!;
    const lineHeight = Number.parseFloat(await label.evaluate((element) => getComputedStyle(element).lineHeight));
    expect(labelBox.height).toBeLessThanOrEqual(lineHeight + 1);
    expect(valueBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
  }

  await expect(page.locator(".metric-label").first()).toHaveCSS("color", "rgb(63, 59, 53)");
  await expect(page.locator(".metric-detail").first()).toHaveCSS("color", "rgb(79, 73, 66)");
});
