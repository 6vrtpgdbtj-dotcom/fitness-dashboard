// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "../[id]/route";
const mocks = vi.hoisted(() => ({ role: "admin", rpc: vi.fn() }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ id: "admin", role: mocks.role }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
const id = "00000000-0000-4000-8000-000000000010";
const post = (body: unknown) => POST(new Request("http://localhost/api/review/" + id, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
beforeEach(() => { mocks.role = "admin"; mocks.rpc.mockReset().mockResolvedValue({ data: { id }, error: null }); });
it("denies trainers before a review mutation", async () => { mocks.role = "trainer"; expect((await post({ action: "reject", domain: "member" })).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); });
it("passes only validated target and fields to the scoped transaction", async () => {
  expect((await post({ action: "correct", domain: "member", fields: { phone_last4: "1234" } })).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("admin_review", { p_id: id, p_command: { action: "correct", domain: "member", fields: { phone_last4: "1234" } } });
});
it("rejects arbitrary identity and organization edits", async () => { expect((await post({ action: "correct", domain: "member", fields: { organization_id: id } })).status).toBe(400); });
it("requires an explicit history confirmation", async () => { expect((await post({ action: "delete_history" })).status).toBe(400); });
it("does not reveal database errors for unowned targets", async () => { mocks.rpc.mockResolvedValue({ error: { message: "target_not_found private detail" } }); const response = await post({ action: "reject", domain: "member" }); expect(response.status).toBe(409); expect(await response.text()).not.toContain("private detail"); });
