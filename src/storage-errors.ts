export type StoragePhase = "open" | "read" | "write" | "lock";
export class StorageFailure extends Error {
  constructor(
    public code: string,
    public phase: StoragePhase,
    message: string,
    public nativeName?: string,
  ) {
    super(message);
    this.name = "StorageFailure";
  }
}
export function storageFailure(
  error: unknown,
  phase: StoragePhase,
): StorageFailure {
  if (error instanceof StorageFailure) return error;
  const name = error instanceof Error ? error.name : "";
  const known: Record<string, [string, string]> = {
    VersionError: [
      "DB_VERSION",
      "此網址的資料庫版本高於程式支援版本，已停止操作，未降版或重建。",
    ],
    SecurityError: [
      "DB_PERMISSION",
      "瀏覽器拒絕存取本機儲存空間。請檢查此網站的儲存權限，不需要清除資料。",
    ],
    QuotaExceededError: [
      "DB_QUOTA",
      "本機儲存空間不足，寫入未完成；請先下載備份。",
    ],
    UnknownError: [
      "DB_INTERNAL",
      "瀏覽器回報本機資料庫內部錯誤，未清除或重建資料。請保留診斷代碼後重試。",
    ],
    TransactionInactiveError: [
      "DB_TRANSACTION",
      "本機資料交易已失效，本次操作未完成，請重新讀取後重試。",
    ],
    AbortError: ["DB_ABORT", "本機資料交易已中止，請重新讀取資料後再試。"],
    InvalidStateError: [
      "DB_CONNECTION",
      "本機資料庫連線已關閉或暫時不可用，請重新讀取。",
    ],
    NotFoundError: [
      "DB_SCHEMA",
      "資料庫缺少預期的 state 儲存區，已停止操作，不會重建或清空。",
    ],
  };
  const match = Object.hasOwn(known, name) ? known[name] : undefined;
  return new StorageFailure(
    match?.[0] || `DB_${phase.toUpperCase()}`,
    phase,
    match?.[1] ||
      "本機資料操作失敗，未自動清除或重建資料。請查看安全錯誤診斷。",
    match ? name : undefined,
  );
}
export function snapshotFailure() {
  return new StorageFailure(
    "SNAPSHOT_INVALID",
    "read",
    "本機資料格式無法驗證，原始資料未變更，已停止寫入。",
  );
}
