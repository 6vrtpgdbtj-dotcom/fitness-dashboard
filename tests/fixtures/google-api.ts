import nock from "nock";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const googleFixture = {
  spreadsheetId: "e2e-fitness-sheet",
  metadata: {
    spreadsheetId: "e2e-fitness-sheet",
    properties: { title: "QA 운영 시트" },
    sheets: [{ properties: { sheetId: 0, title: "회원" } }],
  },
  values: { range: "회원!A1:D2", majorDimension: "ROWS", values: [["회원명", "회원번호", "상태", "잔여횟수"], ["QA 회원", "QA-001", "활성", "4"]] },
};

/** Test-process boundary only: real Google SDK transport, no production flags. */
export function installGoogleFixture({ failures = 0, waitForRecovery = false } = {}) {
  let remaining = failures;
  const sheets = nock("https://sheets.googleapis.com").persist()
    .get(`/v4/spreadsheets/${googleFixture.spreadsheetId}`).query(true).reply(200, googleFixture.metadata)
    .get(new RegExp(`/v4/spreadsheets/${googleFixture.spreadsheetId}/values/`)).query(true)
    .reply(() => (waitForRecovery ? !existsSync(resolve("output/playwright/google-recovered")) : remaining-- > 0)
      ? [503, { error: { code: 503, message: "Deterministic Google outage", status: "UNAVAILABLE" } }]
      : [200, googleFixture.values]);
  const oauth = nock("https://oauth2.googleapis.com").persist().post("/token")
    .reply(200, { access_token: "fixture-access-not-a-real-token", token_type: "Bearer", expires_in: 3600 });
  const drive = nock("https://www.googleapis.com").persist()
    .post(`/drive/v3/files/${googleFixture.spreadsheetId}/watch`).query(true)
    .reply(200, { resourceId: "fixture-resource", expiration: String(Date.now() + 86_400_000) })
    .post("/drive/v3/channels/stop").reply(204);
  return { recover: () => { remaining = 0; }, dispose: () => { sheets.persist(false); oauth.persist(false); drive.persist(false); nock.cleanAll(); } };
}

// Explicit Node preloader used only when launching an isolated integration server.
if (process.env.E2E_MOCK_GOOGLE === "1") installGoogleFixture({ waitForRecovery: process.env.E2E_GOOGLE_OUTAGE === "1" });
