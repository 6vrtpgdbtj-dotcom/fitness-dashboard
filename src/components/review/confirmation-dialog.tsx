"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
export function ConfirmationDialog({ title, children, confirmLabel, phrase, busy, onCancel, onConfirm }: { title: string; children: ReactNode; confirmLabel: string; phrase?: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const id = useId(), dialog = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  return <div className="dialog-backdrop"><div className="sheet-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={dialog} onKeyDown={event => {
    if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); }
    if (event.key === "Tab") {
      const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]') ?? [])];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><h2 id={id}>{title}</h2>{children}{phrase && <label className="admin-field">확인 문구<input value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} autoComplete="off" placeholder={phrase} /></label>}
    <div className="dialog-actions"><button ref={cancel} className="quiet-button" disabled={busy} onClick={onCancel}>취소</button><button className="danger-button" disabled={busy || (!!phrase && confirmation !== phrase)} onClick={onConfirm}>{busy ? "처리 중…" : confirmLabel}</button></div>
  </div></div>;
}
