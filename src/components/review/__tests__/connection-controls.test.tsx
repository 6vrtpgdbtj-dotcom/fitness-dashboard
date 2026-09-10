import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectionControls } from "../connection-controls";
const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const connection = { id: "connection-id", display_name: "운영 시트", is_active: true };

it("requests manual sync once while pending and refreshes after success", async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn((url, options) => {
    expect(url).toBe("/api/sheets/connection-id/sync");
    expect(options.method).toBe("POST");
    return new Promise<Response>(resolve => { complete = resolve; });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ConnectionControls connection={connection} />);
  fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));
  expect(screen.getByRole("button", { name: "동기화 중…" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "동기화 중…" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  complete(Response.json({ member: { inserted: 1 } }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("동기화를 완료했습니다"));
  expect(nav.refresh).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 409, 502])("shows recoverable manual sync failure for HTTP %i", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  render(<ConnectionControls connection={connection} />);
  fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));
  expect(await screen.findByRole("alert")).not.toBeEmptyDOMElement();
  expect(screen.getByRole("button", { name: "지금 동기화" })).toBeEnabled();
  expect(nav.refresh).not.toHaveBeenCalled();
});

it("does not offer sync for a disconnected source", () => {
  render(<ConnectionControls connection={{ ...connection, is_active: false }} />);
  expect(screen.queryByRole("button", { name: "지금 동기화" })).not.toBeInTheDocument();
});
