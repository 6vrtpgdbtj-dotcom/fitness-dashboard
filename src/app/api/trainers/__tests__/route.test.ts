// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "../route";
const mocks = vi.hoisted(() => ({ role: "admin", rpc: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ id: "admin", role: mocks.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
const post = (body: unknown) => POST(new Request("http://localhost/api/trainers", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { mocks.role = "admin"; mocks.rpc.mockReset().mockResolvedValue({ data: {}, error: null }); });
it("denies trainers access to user management", async () => { mocks.role = "trainer"; expect((await post({ action: "invite", email: "coach@example.com", displayName: "Coach", active: true })).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("normalizes an invitation and uses the authenticated transaction", async () => { expect((await post({ action: "invite", email: "COACH@example.com", displayName: " Coach ", active: true })).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("admin_trainer", { p_command: { action: "invite", email: "coach@example.com", displayName: "Coach", active: true } }); });
it("rejects a direct assignment without a trainer", async () => { expect((await post({ action: "assign", connectionId: "00000000-0000-4000-8000-000000000001", mode: "direct" })).status).toBe(400); });
it("does not accept caller-provided organization or role", async () => { expect((await post({ action: "invite", email: "coach@example.com", displayName: "Coach", active: true, role: "admin" })).status).toBe(400); });
