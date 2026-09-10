"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function useAdminMutation() {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function mutate(url: string, body: object, successMessage = "변경을 저장했습니다.") {
    if (busy) return false;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 409 ? "이미 동기화가 진행 중입니다. 잠시 후 다시 확인해 주세요." : response.status === 401 || response.status === 403 ? "로그인과 관리자 권한을 확인해 주세요." : result?.error ?? "요청을 완료하지 못했습니다. 다시 시도해 주세요.");
      setMessage(successMessage); router.refresh(); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : "연결을 확인하고 다시 시도해 주세요."); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, message, mutate };
}
