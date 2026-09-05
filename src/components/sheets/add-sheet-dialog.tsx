"use client";

import { FormEvent, useState } from "react";

type Trainer = { id: string; displayName: string };

export function AddSheetDialog({ trainers }: { trainers: Trainer[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/sheets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spreadsheetUrl: form.get("spreadsheetUrl"),
          trainerId: form.get("trainerId") || undefined,
        }),
      });
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch {
      setError("시트를 연결하지 못했습니다. Google 권한과 시트 접근 권한을 확인해 주세요.");
      setSubmitting(false);
    }
  }

  if (!open) return <button className="primary-action" type="button" onClick={() => setOpen(true)}>시트 추가</button>;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="add-sheet-title">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">READ-ONLY SOURCE</p>
            <h2 id="add-sheet-title">Google 시트 추가</h2>
          </div>
          <button className="quiet-button" type="button" onClick={() => setOpen(false)}>닫기</button>
        </div>
        <form onSubmit={submit} className="sheet-form">
          <label>
            Google Sheets URL
            <input name="spreadsheetUrl" type="url" required placeholder="https://docs.google.com/spreadsheets/d/..." />
          </label>
          <label>
            담당 트레이너 <span>(선택)</span>
            <select name="trainerId" defaultValue="">
              <option value="">공용 운영 시트</option>
              {trainers.map((trainer) => <option key={trainer.id} value={trainer.id}>{trainer.displayName}</option>)}
            </select>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="form-hint">시트 원본은 읽기 전용으로만 연결됩니다.</p>
          <div className="dialog-actions">
            <button className="quiet-button" type="button" onClick={() => setOpen(false)}>취소</button>
            <button className="primary-action" type="submit" disabled={submitting}>{submitting ? "연결 중…" : "연결하고 동기화"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
