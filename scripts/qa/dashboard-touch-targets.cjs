// Run with playwright-cli run-code --filename=scripts/qa/dashboard-touch-targets.cjs
// Navigate the browser to this app's /demo route first. Uses only fictional data.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- The CLI evaluates this function expression with its live page.
async (page) => {
  const origin = page.url().split("/").slice(0, 3).join("/");
  const evidence = [];
  const failures = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const settled = async () => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.querySelectorAll(".dashboard-flow > section, .metric-value")].every((node) => getComputedStyle(node).opacity === "1"));
  };
  for (const role of ["admin", "trainer"]) {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto(`${origin}/demo?role=${role}`);
    await settled();
    await page.screenshot({ path: `output/playwright/task-7-review-${role}-${width}.png`, caret: "initial" });
    await page.screenshot({ path: `output/playwright/task-7-review-${role}-${width}-full.png`, fullPage: true, caret: "initial" });
    await page.getByLabel("시작일").fill("2025-09-30");
    await page.getByLabel("종료일").fill("2026-09-30");
    await page.getByRole("button", { name: "기간 적용" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".bar-group").length === 13);
    const months = await page.locator(".bar-group").evaluateAll((nodes) => nodes.map((node) => {
      const { width, height } = node.getBoundingClientRect();
      return { label: node.getAttribute("aria-label"), width, height };
    }));
    for (const month of months) {
      if (month.width < 44 || month.height < 44) failures.push({ viewport: width, ...month });
    }
    const actions = [];
    for (const [role, name] of [["link", "수업 전체 보기"], ["link", "회원 보기"], ["button", "표로 보기"]]) {
      const target = page.getByRole(role, { name });
      if (await target.isVisible()) {
        const box = await target.boundingBox();
        actions.push({ name, width: box.width, height: box.height });
        if (box.height < 44 || box.width < 44) failures.push({ viewport: width, name, ...box });
      } else if (width < 768) failures.push({ viewport: width, name, missing: true });
    }
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (pageWidth > width) failures.push({ viewport: width, pageWidth });
    await page.locator(".bar-group").last().focus();
    await page.locator(".bar-group").first().focus();
    await page.getByRole("status").filter({ hasText: "2025.09" }).waitFor();
    await page.locator(".revenue-story").screenshot({ path: `output/playwright/task-7-review-${role}-chart-${width}-first.png`, caret: "initial" });
    await page.locator(".bar-group").last().focus();
    await page.getByRole("status").filter({ hasText: "2026.09" }).waitFor();
    const scroll = await page.locator(".revenue-chart-scroll").evaluate((node) => {
      const target = node.querySelector('[aria-pressed="true"]');
      const viewport = node.getBoundingClientRect();
      const active = target.getBoundingClientRect();
      return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, selectedVisible: active.left >= viewport.left && active.right <= viewport.right };
    });
    if (!scroll.selectedVisible) failures.push({ role, viewport: width, scroll });
    await page.locator(".revenue-story").screenshot({ path: `output/playwright/task-7-review-${role}-chart-${width}.png`, caret: "initial" });
    await page.getByRole("button", { name: "표로 보기" }).click();
    const exactTable = page.getByRole("table", { name: "기간별 등록 매출" });
    if (await exactTable.getByRole("row").count() !== 14) failures.push({ role, viewport: width, missingMonths: true });
    await page.locator(".revenue-story").screenshot({ path: `output/playwright/task-7-review-${role}-chart-${width}-table.png`, caret: "initial" });
    evidence.push({ role, viewport: width, pageWidth, months, actions, scroll });
  }
  }
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    for (const state of ["empty", "partial", "loading", "error"]) {
      await page.goto(`${origin}/demo?state=${state}`);
      await settled();
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (pageWidth > width) failures.push({ state, viewport: width, pageWidth });
      await page.screenshot({ path: `output/playwright/task-7-review-state-${state}-${width}.png`, fullPage: true, caret: "initial" });
    }
    for (const balance of ["unknown", "partial", "renewed"]) {
      await page.goto(`${origin}/demo?role=trainer&balance=${balance}`);
      await settled();
      const memberMetric = await page.getByRole("group", { name: "담당 회원" }).innerText();
      const expected = balance === "unknown" ? "잔여 세션 미확인 · 3명 기록 필요" : balance === "partial" ? "확인된 잔여 11회 · 2명 미확인" : "잔여 세션 합계 50회";
      if (!memberMetric.includes(expected)) failures.push({ balance, viewport: width, memberMetric });
      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (pageWidth > width) failures.push({ balance, viewport: width, pageWidth });
      if (balance === "renewed" && await page.locator(".renewal-panel").getByText("샘플 회원 01").count()) failures.push({ staleRenewal: true });
      await page.screenshot({ path: `output/playwright/task-7-review-balance-${balance}-${width}.png`, fullPage: true, caret: "initial" });
    }
    await page.goto(`${origin}/demo?role=trainer&balance=renewed&view=members`);
    if (await page.getByLabel("시작일").count()) failures.push({ inertMembersDateFilter: true });
    const row = page.getByRole("row", { name: /샘플 회원 01/ });
    if (!(await row.innerText()).includes("11회")) failures.push({ staleInventoryBalance: true });
    await page.screenshot({ path: `output/playwright/task-7-review-members-${width}.png`, fullPage: true, caret: "initial" });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`${origin}/demo?role=trainer`);
  await settled();
  const reduced = await page.locator(".revenue-bar").evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).transform === "none"));
  if (!reduced) failures.push({ reducedMotion: false });
  await page.screenshot({ path: "output/playwright/task-7-review-reduced-motion-320.png", fullPage: true, caret: "initial" });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (errors.length) failures.push({ errors });
  if (failures.length) throw new Error(JSON.stringify({ failures, evidence }));
  return { evidence, states: ["empty", "partial", "loading", "error"], balances: ["unknown", "partial", "renewed"], reduced, errors, failures };
}
