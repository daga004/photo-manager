import type {
  DayAggregate,
  DayItem,
  DeviceInfo,
  DuplicateGroup,
  ImportJobEventRecord,
  ImportJobRecord,
  MediaRecord,
} from "../shared/types.ts";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function getDays(sortBy: "count" | "size", order: "asc" | "desc", type: "photo" | "video" | "all"): Promise<DayAggregate[]> {
  return jsonFetch(`/api/days?sortBy=${sortBy}&order=${order}&type=${type}`);
}

export function getDayItems(date: string): Promise<{ date: string; items: DayItem[] }> {
  return jsonFetch(`/api/days/${encodeURIComponent(date)}`);
}

export function getUndated(): Promise<{ count: number; items: DayItem[] }> {
  return jsonFetch("/api/undated");
}

export function getNonCamera(): Promise<{ count: number; items: DayItem[] }> {
  return jsonFetch("/api/non-camera");
}

export function getMedia(id: number): Promise<MediaRecord> {
  return jsonFetch(`/api/media/${id}`);
}

export function restoreMedia(id: number): Promise<{ restored: true }> {
  return jsonFetch(`/api/media/${id}/restore`, { method: "POST" });
}

export function listDevices(): Promise<DeviceInfo[]> {
  return jsonFetch("/api/devices");
}

export function startImport(sourcePath: string): Promise<{ jobId: number }> {
  return jsonFetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePath }),
  });
}

export function startDeviceImport(udid: string, deleteAfterVerify: boolean): Promise<{ jobId: number }> {
  return jsonFetch("/api/import/device", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ udid, deleteAfterVerify }),
  });
}

export function startReindex(): Promise<{ jobId: number }> {
  return jsonFetch("/api/reindex", { method: "POST" });
}

export function getJob(jobId: number): Promise<ImportJobRecord> {
  return jsonFetch(`/api/jobs/${jobId}`);
}

export function getJobEvents(jobId: number, since: number, limit = 200): Promise<ImportJobEventRecord[]> {
  return jsonFetch(`/api/jobs/${jobId}/events?since=${since}&limit=${limit}`);
}

export function listJobs(limit = 50): Promise<ImportJobRecord[]> {
  return jsonFetch(`/api/jobs?limit=${limit}`);
}

export function resumeJob(jobId: number): Promise<{ resumed: true }> {
  return jsonFetch(`/api/jobs/${jobId}/resume`, { method: "POST" });
}

export function pauseJob(jobId: number): Promise<{ pausing: true }> {
  return jsonFetch(`/api/jobs/${jobId}/pause`, { method: "POST" });
}

export interface SettingsInfo {
  libraryRoot: string;
  isDefault: boolean;
  defaultLibraryRoot: string;
  dataDir: string;
  photosDir: string;
  videosDir: string;
}

export function getSettings(): Promise<SettingsInfo> {
  return jsonFetch("/api/settings");
}

export function updateLibraryRoot(libraryRoot: string): Promise<{ libraryRoot: string }> {
  return jsonFetch("/api/settings/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ libraryRoot }),
  });
}

export function getDuplicates(includeResolved = false): Promise<DuplicateGroup[]> {
  return jsonFetch(`/api/duplicates?includeResolved=${includeResolved}`);
}

export function resolveDuplicate(
  contentHash: string,
  keepMediaId: number,
  action: "delete_extras" | "ignore",
): Promise<{ quarantinedCount: number; keptMediaId: number; skippedNotIdentical?: number[] }> {
  return jsonFetch("/api/duplicates/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentHash, keepMediaId, action }),
  });
}
