import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RealtimeRefresh } from "../realtime-refresh";
const external = vi.hoisted(() => ({
  refresh: vi.fn(),
  remove: vi.fn(),
  onMessage: null as null | ((event: { payload: unknown }) => void),
  topic: "",
  private: false,
}));
vi.mock("next/navigation", () => {
  const router = { refresh: external.refresh };
  return { useRouter: () => router };
});
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: (topic: string, options: { config: { private: boolean } }) => {
      external.topic = topic;
      external.private = options.config.private;
      const channel = {
        on: (
          _type: string,
          _event: unknown,
          callback: typeof external.onMessage,
        ) => {
          external.onMessage = callback;
          return channel;
        },
        subscribe: (callback: (state: string) => void) => {
          callback("SUBSCRIBED");
          return channel;
        },
      };
      return channel;
    },
    removeChannel: external.remove,
  }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("debounces private success invalidations and cancels pending refreshes on unmount", () => {
  vi.useFakeTimers();
  const view = render(<RealtimeRefresh topic="org:one:trainer:a" />);
  expect(external.topic).toBe("org:one:trainer:a");
  expect(external.private).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("실시간 연결됨");
  act(() => {
    external.onMessage?.({ payload: { status: "failed" } });
    vi.advanceTimersByTime(400);
  });
  expect(external.refresh).not.toHaveBeenCalled();
  act(() => {
    external.onMessage?.({ payload: { status: "succeeded" } });
    external.onMessage?.({ payload: { status: "succeeded" } });
    vi.advanceTimersByTime(400);
  });
  expect(external.refresh).toHaveBeenCalledTimes(1);
  act(() => external.onMessage?.({ payload: { status: "succeeded" } }));
  view.unmount();
  act(() => vi.advanceTimersByTime(400));
  expect(external.refresh).toHaveBeenCalledTimes(1);
  expect(external.remove).toHaveBeenCalledTimes(1);
});
