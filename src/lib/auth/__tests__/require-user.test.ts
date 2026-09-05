import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "@/lib/auth/require-user";
import Home from "@/app/page";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn(), select: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from }),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

const approved = { id: "u1", role: "admin", trainer_id: null, organization_id: "o1", is_active: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  mocks.from.mockImplementation((table) => {
    if (table !== "profiles") throw new Error("Unexpected table");
    return { select: mocks.select };
  });
  mocks.select.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockImplementation((column, value) => {
    if (column !== "id" || value !== "u1") throw new Error("Wrong authenticated profile scope");
    return { maybeSingle: mocks.maybeSingle };
  });
  mocks.maybeSingle.mockResolvedValue({ data: approved, error: null });
});

describe("requireUser", () => {
  it("routes the public entry point through the protected dashboard", () => {
    expect(() => Home()).toThrow("redirect:/dashboard");
  });
  it("redirects unauthenticated users to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
  it("does not trust a user returned alongside an auth error", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: new Error("expired") });
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });
  it("returns approved administrator scope", async () => {
    expect(await requireUser()).toEqual({ id: "u1", role: "admin", trainerId: null });
  });
  it("returns the assigned trainer ID", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { ...approved, role: "trainer", trainer_id: "t1" }, error: null });
    expect(await requireUser()).toEqual({ id: "u1", role: "trainer", trainerId: "t1" });
  });
  it.each([
    null,
    { ...approved, is_active: false },
    { ...approved, role: "owner" },
    { ...approved, organization_id: null },
    { ...approved, id: "someone-else" },
    { ...approved, role: "trainer", trainer_id: null },
    { ...approved, role: "trainer", trainer_id: "" },
  ])("rejects missing or invalid approval: %j", async (profile) => {
    mocks.maybeSingle.mockResolvedValue({ data: profile, error: null });
    await expect(requireUser()).rejects.toThrow("redirect:/login?error=not-approved");
  });
  it("fails closed when profile lookup fails", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: approved, error: new Error("database unavailable") });
    await expect(requireUser()).rejects.toThrow("redirect:/login?error=not-approved");
  });
});
