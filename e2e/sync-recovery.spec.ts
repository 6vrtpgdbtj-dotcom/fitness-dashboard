import { test, expect } from "@playwright/test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

test("partial failure preserves the usable dashboard and offers recovery guidance", async ({ page }) => {
  await page.goto("/demo?state=partial");
  await expect(page.locator(".sync-pulse.has-error").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /신규·재등록 매출의 흐름/ })).toBeVisible();
  await page.screenshot({ path: "output/playwright/sync-partial-failure.png", fullPage: true });
  await page.goto("/demo?state=error");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("원본 시트와 저장된 기록은 유지됩니다.");
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeEnabled();
});

test.describe("live Google failure and Supabase reconciliation", () => {
  test.skip(!process.env.E2E_ADMIN_STATE || !process.env.E2E_BASE_URL || !process.env.E2E_CONNECTION_ID || !process.env.CRON_SECRET, "Requires isolated seeded Supabase, Google fixture preloader and connection ID; see docs/browser-qa.md.");
  test.use({ storageState: process.env.E2E_ADMIN_STATE });
  test("failed Google read is retried by reconciliation without duplicate canonical records", async ({ page }) => {
    test.setTimeout(480_000);
    const recoverySignal = resolve("output/playwright/google-recovered");
    await mkdir(resolve("output/playwright"), { recursive: true });
    await rm(recoverySignal, { force: true });
    const headers = { origin: new URL(process.env.E2E_BASE_URL!).origin };
    const failed = await page.request.post(`/api/sheets/${process.env.E2E_CONNECTION_ID}/sync`, { headers });
    expect(failed.status()).toBe(502);
    await writeFile(recoverySignal, "recover");
    await expect.poll(async () => {
      const response = await page.request.get("/api/cron/reconcile-sheets", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      expect(response.status()).toBe(200);
      await page.goto("/settings/sheets");
      const row = page.locator(".connection-row").filter({ has: page.getByRole("heading", { name: "QA 운영 시트", exact: true }) });
      return row.locator(".eyebrow").innerText();
    }, { timeout: 390_000, intervals: [5000, 30_000] }).toBe("succeeded");
    await page.goto("/members");
    await expect(page.getByRole("rowheader", { name: "QA 회원", exact: true })).toHaveCount(1);
  });
});
