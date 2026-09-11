import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 768, 1024], ["mobile", 390, 844]] as const) {
  for (const role of ["admin", "trainer"] as const) {
    test(`${name} ${role}: readable layout, chart interaction, keyboard focus`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/demo?role=${role}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "PT 팀 매출", exact: true })).toBeInViewport();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("button", { name: "표로 보기" }).click();
      await expect(page.getByRole("table", { name: "기간별 PT 등록 매출" })).toBeVisible();
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

test("reduced motion settles charts and disables skeleton shimmer", async ({ page }) => {
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

test("hotel palette keeps the operational ledger high contrast", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/demo?role=admin");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(244, 239, 230)");
  await expect(page.locator(".desktop-rail")).toHaveCSS("background-color", "rgb(36, 36, 33)");
  await expect(page.locator(".pt-ledger-total strong")).toHaveCSS("color", "rgb(36, 34, 31)");
});

for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 768, 1024], ["mobile", 390, 844]] as const) {
  for (const role of ["admin", "trainer"] as const) {
    test(`${name} ${role}: loading reserves representative panel bounds`, async ({ page }, info) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height });
      await page.goto(`/demo?role=${role}&state=loading`);
      await page.evaluate(() => document.fonts.ready);
      const loading = await Promise.all([".skeleton-metrics", ".skeleton-chart"].map((selector) => page.locator(selector).boundingBox()));
      // Use the actual state control, not fabricated page markup. Toolbar and
      // variable-length work queues change vertical placement, so this contract
      // compares panel footprints (left/right edges and reserved height), not CLS.
      await page.getByRole("link", { name: "정상", exact: true }).click();
      await expect(page.locator(".metrics-strip")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const loaded = await Promise.all([".metrics-strip", ".dashboard-revenue"].map((selector) => page.locator(selector).boundingBox()));
      const boundsPath = `output/playwright/${name}-${role}-loading-bounds.json`;
      await mkdir("output/playwright", { recursive: true });
      await writeFile(boundsPath, JSON.stringify({ loading, loaded }, null, 2));
      await info.attach("loading-to-loaded-bounds", { path: boundsPath, contentType: "application/json" });
      for (let index = 0; index < loading.length; index++) {
        expect(loading[index]).not.toBeNull();
        expect(loaded[index]).not.toBeNull();
        const before = loading[index]!, after = loaded[index]!;
        expect(Math.abs(before.x - after.x), `panel ${index} left edge`).toBeLessThanOrEqual(1);
        expect(Math.abs(before.width - after.width), `panel ${index} width`).toBeLessThanOrEqual(1);
        // Text wrapping/data can grow a panel; reserve at least 85% and no more
        // than 115% of this representative fixture's actual loaded height.
        expect(before.height / after.height, `panel ${index} reserved height`).toBeGreaterThanOrEqual(0.85);
        expect(before.height / after.height, `panel ${index} reserved height`).toBeLessThanOrEqual(1.15);
      }
    });
  }
}
