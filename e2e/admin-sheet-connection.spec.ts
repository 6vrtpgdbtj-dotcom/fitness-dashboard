import { test, expect } from "@playwright/test";

test("login errors remain readable and do not expose provider details", async ({ page }) => {
  await page.goto("/login?error=oauth");
  await expect(page.getByRole("button", { name: "Google 계정으로 로그인" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Google 로그인을 완료하지 못했습니다. 다시 시도해 주세요.");
  await page.goto("/auth/callback?error=access_denied&next=https://evil.example");
  await expect(page).toHaveURL(/\/login\?error=oauth$/);
});

test("app responses prevent framing and MIME sniffing", async ({ page }) => {
  const response = (await page.goto("/login"))!;
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test.describe("live Supabase administrator session", () => {
  test.skip(!process.env.E2E_ADMIN_STATE || !process.env.E2E_BASE_URL, "Requires an isolated migrated Supabase and an approved administrator OAuth storage state; see docs/browser-qa.md.");
  test.use({ storageState: process.env.E2E_ADMIN_STATE });
  test("approved login reaches settings and connects the deterministic Google sheet", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto("/settings/sheets");
    await page.getByRole("button", { name: "시트 추가", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Google 시트 추가" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Google Sheets URL").fill("https://docs.google.com/spreadsheets/d/e2e-fitness-sheet/edit");
    await dialog.getByRole("button", { name: "연결하고 동기화" }).click();
    await expect(page.getByRole("heading", { name: "QA 운영 시트", exact: true })).toBeVisible();
  });
});
