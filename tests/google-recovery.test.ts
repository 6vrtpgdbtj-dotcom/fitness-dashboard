// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { google } from "googleapis";
import { installGoogleFixture, googleFixture } from "./fixtures/google-api";
import { withRetry } from "../src/features/sync/retry-policy";
import { mapColumns } from "../src/features/mapping/map-columns";
let fixture: ReturnType<typeof installGoogleFixture> | undefined;
afterEach(() => fixture?.dispose());
it("exhausts a Google outage, then reads the same source successfully during a later reconciliation attempt", async () => {
  fixture = installGoogleFixture({ failures: 6 });
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: "fixture-access-not-a-real-token" });
  const api = google.sheets({ version: "v4", auth });
  const read = () => api.spreadsheets.values.get({ spreadsheetId: googleFixture.spreadsheetId, range: "'회원'" }, { retry: false });
  const retry = { sleep: async () => {}, random: () => 0 };
  await expect(withRetry(read, retry)).rejects.toMatchObject({ response: { status: 503 } });
  const result = await withRetry(read, retry);
  expect(result.data.values?.[1]).toEqual(["QA 회원", "QA-001", "활성", "4"]);
  const mapping = mapColumns({ organizationId: "org", sourceConnectionId: "connection", sourceTabId: "tab", tabTitle: "회원", rows: result.data.values!, domain: "member" });
  expect(mapping.fields.some((field) => field.field === "name")).toBe(true);
});
