import { test, expect } from "@playwright/test";

for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 768, 1024], ["mobile", 390, 844]] as const) {
  for (const role of ["admin", "trainer"] as const) {
    test(`${name} ${role}: readable layout, chart interaction, keyboard focus`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/demo?role=${role}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("button", { name: "표로 보기" }).click();
      await expect(page.getByRole("table", { name: "기간별 등록 매출" })).toBeVisible();
      await page.getByRole("button", { name: "표 닫기" }).click();
      const start = page.getByLabel("시작일");
      await start.focus();
      await page.keyboard.press("Shift+Tab");
      const focus = await page.locator(":focus").evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(focus).not.toBe("none");
      if (width === 390) {
        const today = await page.locator(".dashboard-today").boundingBox();
        const renewals = await page.locator(".dashboard-renewals").boundingBox();
        const chart = await page.locator(".dashboard-revenue").boundingBox();
        expect(today!.y).toBeLessThan(renewals!.y);
        expect(renewals!.y).toBeLessThan(chart!.y);
        for (const selector of ["main input", "main select", "main button", "main a", ".mobile-nav a", ".mobile-admin-nav a"]) {
          for (const control of await page.locator(selector).all()) {
            if (!(await control.isVisible())) continue;
            const box = (await control.boundingBox())!;
            expect(box.height, `${selector} touch height`).toBeGreaterThanOrEqual(44);
            expect(box.width, `${selector} touch width`).toBeGreaterThanOrEqual(44);
          }
        }
      }
      await page.screenshot({ path: `output/playwright/${name}-${role}.png`, fullPage: true });
      await info.attach("render", { path: `output/playwright/${name}-${role}.png`, contentType: "image/png" });
    });
  }
}

test("reduced motion settles charts and preserves stable skeleton geometry", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  await expect(page.locator(".revenue-bar").first()).toHaveCSS("transform", "none");
  await expect(page.locator(".funnel-track > span").first()).toHaveCSS("transform", "none");
  await page.goto("/demo?state=loading");
  await expect(page.getByRole("status", { name: "운영 데이터 불러오는 중" })).toHaveAttribute("aria-busy", "true");
  const skeleton = page.locator(".skeleton-chart");
  await expect(skeleton).toHaveCSS("animation-name", "none");
  expect((await skeleton.boundingBox())!.height).toBeGreaterThanOrEqual(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "output/playwright/mobile-loading-reduced-motion.png", fullPage: true });
});
