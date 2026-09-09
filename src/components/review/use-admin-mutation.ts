"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function useAdminMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function mutate(url: string, body: object) {
    if (busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
      setMessage("변경을 저장했습니다."); router.refresh(); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "연결을 확인하고 다시 시도해 주세요."); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, message, mutate };
}
