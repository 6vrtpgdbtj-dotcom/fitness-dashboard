// Run via playwright-cli --session task8 run-code --filename=scripts/qa/admin-workflows.cjs
// against the local fictional preview started with node scripts/qa/admin-preview.mjs.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
async (page) => {
  const errors = [], results = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const view of ["review", "users"]) for (const width of [320,390,1440]) {
    await page.setViewportSize({ width,height:900 });
    await page.goto(`http://127.0.0.1:3018/?view=${view}`);
    await page.getByRole("heading", { name: view === "users" ? "트레이너 초대" : "확인이 필요한 데이터" }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (documentWidth > width) throw new Error(`Overflow ${view} ${width}: ${documentWidth}`);
    await page.screenshot({ path:`output/playwright/task-8-${view}-${width}.png`, fullPage:true });
    results.push({ view,width,documentWidth });
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto("http://127.0.0.1:3018/?view=review");
  await page.getByLabel("데이터 분야").selectOption("registration");
  await page.getByLabel("헤더 행").fill("3");
  if(await page.getByRole("button",{name:"새 매핑 버전 저장"}).count()) throw new Error("Stale mapping remained confirmable");
  await page.getByRole("button",{name:"선택한 행 미리보기"}).click();
  await page.getByLabel("3열 실결제금액 표준 필드").waitFor();
  if(await page.getByLabel("3열 실결제금액 표준 필드").inputValue()!=="paid_amount") throw new Error("Wrong mapping after header selection");
  if(!(await page.getByRole("button",{name:"새 매핑 버전 저장"}).isEnabled())) throw new Error("New valid mapping is not confirmable");
  await page.screenshot({path:"output/playwright/task-8-recomputed-mapping-390.png",fullPage:true});
  await page.goto("http://127.0.0.1:3018/?view=review&missing=1");
  if(await page.getByRole("button",{name:"새 매핑 버전 저장"}).count()) throw new Error("Missing header was confirmable");
  await page.getByLabel("헤더 행").fill("5");
  await page.getByRole("button",{name:"선택한 행 미리보기"}).click();
  await page.getByLabel("1열 회원명 표준 필드").waitFor();
  if(!(await page.getByRole("button",{name:"새 매핑 버전 저장"}).isEnabled())) throw new Error("Missing header recovery failed");
  await page.screenshot({path:"output/playwright/task-8-missing-header-recovered-390.png",fullPage:true});
  await page.goto("http://127.0.0.1:3018/?view=review");
  await page.getByRole("button",{name:"검토",exact:true}).click();
  await page.getByLabel("수정값").fill("12");
  await page.getByRole("button",{name:"수정 저장"}).click();
  await page.getByRole("status").waitFor();
  await page.getByLabel("병합 후 유지할 회원").selectOption("fictional-keep");
  await page.getByRole("button",{name:"회원 병합 검토"}).click();
  await page.getByRole("dialog").waitFor();
  if (!(await page.getByRole("button",{name:"취소",exact:true}).evaluate(el => el === document.activeElement))) throw new Error("Dialog did not focus cancel");
  await page.keyboard.press("Escape");
  if (await page.getByRole("dialog").count()) throw new Error("Escape did not dismiss dialog");
  await page.getByRole("button",{name:"원본 이력 삭제",exact:true}).click();
  if (!(await page.getByRole("button",{name:"영구 삭제",exact:true}).isDisabled())) throw new Error("Unconfirmed delete was enabled");
  await page.getByLabel("확인 문구").fill("DELETE HISTORY");
  await page.getByRole("button",{name:"영구 삭제",exact:true}).focus();
  await page.keyboard.press("Tab");
  const focusInDialog = await page.getByRole("dialog").evaluate(el => el.contains(document.activeElement));
  if (!focusInDialog) throw new Error("Focus escaped dialog");
  await page.screenshot({path:"output/playwright/task-8-delete-confirmation-390.png"});
  if (errors.length) throw new Error(JSON.stringify(errors));
  return { results,focusInDialog,errors };
}
