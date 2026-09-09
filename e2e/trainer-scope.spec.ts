import { test, expect } from "@playwright/test";

test("anonymous visitors cannot enter any dashboard or administrator page", async ({ page }) => {
  for (const route of ["/dashboard", "/members", "/registrations", "/leads", "/classes", "/settings/sheets", "/settings/users", "/settings/data-review"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login(?:\?|$)/);
  }
});

test("trainer sample uses the scoped dashboard and omits administrator controls", async ({ page }) => {
  await page.goto("/demo?role=trainer");
  await expect(page.getByRole("heading", { name: "나의 운영 현황" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "담당 트레이너" })).toHaveCount(0);
  await expect(page.locator('a[href="/settings/sheets"]')).toHaveCount(0);
  await expect(page.locator(".trainer-comparison")).toHaveCount(0);
});

test.describe("live Supabase trainer session", () => {
  test.skip(!process.env.E2E_TRAINER_STATE || !process.env.E2E_BASE_URL, "Requires a seeded trainer and real OAuth storage state; sample UI is not an RLS test.");
  test.use({ storageState: process.env.E2E_TRAINER_STATE });
  test("approved trainer is redirected from settings and denied administrator APIs", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
    for (const route of ["/settings/sheets", "/settings/users", "/settings/data-review"]) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/dashboard$/);
    }
    const response = await page.request.post("/api/trainers", { headers: { origin: new URL(process.env.E2E_BASE_URL!).origin }, data: { action: "invite", displayName: "Blocked", email: "blocked@example.invalid", active: true } });
    expect(response.status()).toBe(403);
  });
});
