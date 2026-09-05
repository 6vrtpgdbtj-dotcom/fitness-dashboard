import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSheetConnection } from "@/lib/google/sheets";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  connectionUpsert: vi.fn(),
  connectionUpdate: vi.fn(),
  tabsUpsert: vi.fn(),
  jobUpsert: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "sheet_connections") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
          upsert: mocks.connectionUpsert,
          update: mocks.connectionUpdate,
        };
      }
      if (table === "sheet_tabs") return { upsert: mocks.tabsUpsert };
      if (table === "sync_jobs") return { upsert: mocks.jobUpsert };
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.maybeSingle.mockResolvedValue({ data: { id: "connection-1", status: "succeeded" }, error: null });
  mocks.connectionUpsert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "connection-1" }, error: null }) }) });
  mocks.connectionUpdate.mockReturnValue({ eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: "connection-1" }, error: null }) }) }) }) });
  mocks.tabsUpsert.mockResolvedValue({ error: null });
  mocks.jobUpsert.mockResolvedValue({ error: null });
});

describe("createSheetConnection", () => {
  it("keeps an existing successful connection successful without queueing a duplicate initial sync", async () => {
    await createSheetConnection({
      organizationId: "organization-1",
      connectedBy: "admin-1",
      metadata: { spreadsheetId: "spreadsheet-1", title: "회원 관리", tabs: [{ googleSheetId: 0, title: "회원" }] },
    });

    expect(mocks.connectionUpsert).not.toHaveBeenCalled();
    expect(mocks.jobUpsert).not.toHaveBeenCalled();
  });
});
