// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sheets/route";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getOrganizationId: vi.fn(),
  createConnection: vi.fn(),
  readSpreadsheetMetadata: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/google/sheets", () => ({
  getOrganizationId: mocks.getOrganizationId,
  createSheetConnection: mocks.createConnection,
  readSpreadsheetMetadata: mocks.readSpreadsheetMetadata,
}));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://fitness.example");
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "admin-1", role: "admin", trainerId: null });
  mocks.getOrganizationId.mockResolvedValue("organization-1");
  mocks.readSpreadsheetMetadata.mockResolvedValue({
    spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
    title: "회원 관리",
    tabs: [{ googleSheetId: 0, title: "회원" }],
  });
  mocks.createConnection.mockResolvedValue({ id: "connection-1" });
});

function request(body: unknown) {
  return new NextRequest("https://fitness.example/api/sheets", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://fitness.example" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sheets", () => {
  it("rejects a trainer before accepting a spreadsheet URL", async () => {
    mocks.requireUser.mockResolvedValue({ id: "trainer-1", role: "trainer", trainerId: "trainer-record-1" });

    const response = await POST(request({ spreadsheetUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit" }));

    expect(response.status).toBe(403);
    expect(mocks.readSpreadsheetMetadata).not.toHaveBeenCalled();
  });

  it("registers a valid Google Sheet URL in the authenticated administrator organization", async () => {
    const response = await POST(request({
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890/edit#gid=0",
      trainerId: "11111111-1111-4111-8111-111111111111",
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ id: "connection-1" });
    expect(mocks.readSpreadsheetMetadata).toHaveBeenCalledWith("1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890");
    expect(mocks.createConnection).toHaveBeenCalledWith({
      organizationId: "organization-1",
      connectedBy: "admin-1",
      trainerId: "11111111-1111-4111-8111-111111111111",
      metadata: {
        spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
        title: "회원 관리",
        tabs: [{ googleSheetId: 0, title: "회원" }],
      },
    });
  });
});
