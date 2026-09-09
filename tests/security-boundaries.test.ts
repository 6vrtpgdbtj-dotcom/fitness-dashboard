// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/sheets/route";
const sideEffect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ id: "admin", role: "admin" }) }));
vi.mock("@/lib/google/sheets", () => ({ getOrganizationId: async () => "org", readSpreadsheetMetadata: sideEffect, createSheetConnection: async () => ({ id: "connected" }) }));
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fitness.example"); sideEffect.mockReset().mockResolvedValue({}); });
it.each(["https://evil.example", "null", undefined])("rejects a CSRF attempt from %s before calling Google", async (origin) => {
  const response = await POST(new Request("https://fitness.example/api/sheets", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fixture/edit" }) }));
  expect(response.status).toBe(403);
  expect(sideEffect).not.toHaveBeenCalled();
});
it("allows a same-origin administrator submission", async () => {
  const response = await POST(new Request("https://fitness.example/api/sheets", { method: "POST", headers: { origin: "https://fitness.example", "content-type": "application/json" }, body: JSON.stringify({ spreadsheetUrl: "https://docs.google.com/spreadsheets/d/fixture/edit" }) }));
  expect(response.status).toBe(201);
});
