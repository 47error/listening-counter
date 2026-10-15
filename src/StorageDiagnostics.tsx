import { useEffect, useState } from "react";
import type { StorageFailure } from "./storage-errors";
// Explicit allowlist: never include song data, account names, keys, client IDs or raw errors.
export async function safeStorageDiagnostics(error?: StorageFailure) {
  const result = {
    code: error?.code || "READY",
    phase: error?.phase || "read",
    nativeName: error?.nativeName,
    origin: location.origin,
    database: "listening-counter",
    expectedDatabaseVersion: 1,
    snapshotVersion: 2,
    secureContext: isSecureContext,
    indexedDB: typeof indexedDB !== "undefined",
    webLocks: !!navigator.locks,
    android: /Android/.test(navigator.userAgent),
    chromeMajor: /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent)?.[1],
    writerHeld: null as number | null,
    writerPending: null as number | null,
  };
  if (navigator.locks?.query) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const info = await Promise.race([
        navigator.locks.query(),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 1000);
        }),
      ]);
      if (!info) return result;
      result.writerHeld = (info.held || []).filter(
        (l) => l.name === "listening-counter-writer",
      ).length;
      result.writerPending = (info.pending || []).filter(
        (l) => l.name === "listening-counter-writer",
      ).length;
    } catch {
      /* A failed diagnostic never blocks data access. */
    } finally {
      clearTimeout(timer);
    }
  }
  return result;
}
export function StorageDiagnostics({ error }: { error?: StorageFailure }) {
  const [info, setInfo] = useState<Awaited<
    ReturnType<typeof safeStorageDiagnostics>
  > | null>(null);
  async function refresh() {
    setInfo(await safeStorageDiagnostics(error));
  }
  useEffect(() => {
    void refresh();
  }, [error]);
  return (
    <details className="safe-diagnostics" open={!!error}>
      <summary>安全錯誤診斷{error ? `：${error.code}` : ""}</summary>
      <p className="hint">
        僅顯示儲存能力、錯誤分類及寫入鎖數量，不包含歌曲、帳號、金鑰或私人紀錄。診斷不修改資料。
      </p>
      <pre>{info ? JSON.stringify(info, null, 2) : "讀取診斷中…"}</pre>
      <button className="secondary" onClick={() => void refresh()}>
        更新診斷
      </button>
    </details>
  );
}
