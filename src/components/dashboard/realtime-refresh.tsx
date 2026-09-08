"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function RealtimeRefresh({ topic }: { topic: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("실시간 연결 중");
  useEffect(() => {
    const client = createClient();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const channel = client
      .channel(topic, { config: { private: true } })
      .on(
        "broadcast",
        { event: "sync:succeeded" },
        ({ payload }: { payload: unknown }) => {
          if (
            !payload ||
            typeof payload !== "object" ||
            !("status" in payload) ||
            payload.status !== "succeeded"
          )
            return;
          clearTimeout(timeout);
          timeout = setTimeout(() => {
            router.refresh();
          }, 350);
        },
      )
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setStatus("실시간 연결됨");
        if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state))
          setStatus("실시간 연결 대기 · 새로고침으로 갱신");
      });
    return () => {
      clearTimeout(timeout);
      void client.removeChannel(channel);
    };
  }, [topic, router]);
  return (
    <span className="realtime-status" role="status">
      {status}
    </span>
  );
}
