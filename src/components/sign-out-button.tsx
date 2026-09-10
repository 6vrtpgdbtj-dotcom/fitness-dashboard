"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function signOut() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/auth/signout", { method: "POST" });
      if (!response.ok) throw new Error("signout_failed");
      router.replace("/login"); router.refresh();
    } catch {
      setError("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      pending.current = false; setBusy(false);
    }
  }
  return <div className="account-action"><button type="button" className="quiet-button" disabled={busy} onClick={signOut}>{busy ? "로그아웃 중…" : "로그아웃"}</button>{error && <p role="alert">{error}</p>}</div>;
}
