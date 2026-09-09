// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { readAnalyticsRows } from "../repository";

describe("RLS query boundary", () => {
  it("paginates beyond the API row cap and applies the verified trainer to every domain", async () => {
    const requests: URL[] = [];
    const client = createClient("https://example.supabase.co", "test-key", {
      global: {
        fetch: async (request) => {
          const url = new URL(String(request));
          requests.push(url);
          const table = url.pathname.split("/").at(-1);
          const offset = Number(url.searchParams.get("offset") ?? 0);
          if (table === "profiles")
            return new Response(JSON.stringify({ organization_id: "org" }), {
              status: 200,
            });
          if (table === "members")
            return new Response(
              JSON.stringify(
                Array.from({ length: offset ? 1 : 1000 }, (_, index) => ({
                  id: `m${offset + index}`,
                  trainer_id: "t1",
                  record_status: "valid",
                  name: "가상 회원",
                  status: "active",
                  remaining_sessions: 11,
                  expected_end_date: null,
                  latest_registration_date: "2026-09-08",
                  updated_at: "2026-09-08T02:00:00Z",
                })),
              ),
              { status: 200 },
            );
          return new Response("[]", { status: 200 });
        },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await readAnalyticsRows(client, {
      id: "u1",
      role: "trainer",
      trainerId: "t1",
    });
    expect(result.rows.members).toHaveLength(1001);
    expect(result.realtimeTopic).toBe("org:org:trainer:t1");
    const domains = requests.filter((url) =>
      /\/(members|registrations|leads|classes)$/.test(url.pathname),
    );
    expect(
      domains.every(
        (url) =>
          url.searchParams.get("trainer_id") === "eq.t1" &&
          url.searchParams.get("record_status") === "eq.valid",
      ),
    ).toBe(true);
    expect(
      requests.some((url) => url.pathname.endsWith("sheet_connections")),
    ).toBe(false);
    expect(
      requests.every((url) => !url.searchParams.get("select")?.includes("*")),
    ).toBe(true);
    const memberFields = requests
      .find((url) => url.pathname.endsWith("/members"))
      ?.searchParams.get("select")
      ?.split(",");
    expect(memberFields).toEqual(
      expect.arrayContaining(["latest_registration_date", "updated_at"]),
    );
  });
  it("fails explicitly when the database fails instead of substituting sample or zero data", async () => {
    const client = createClient("https://example.supabase.co", "test-key", {
      global: {
        fetch: async () =>
          new Response(JSON.stringify({ message: "private database error" }), {
            status: 403,
          }),
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await expect(
      readAnalyticsRows(client, { id: "a", role: "admin", trainerId: null }),
    ).rejects.toThrow("dashboard_unavailable");
  });
});
