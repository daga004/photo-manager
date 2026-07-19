import type { DeviceInfo } from "../../shared/types.ts";
import { classifyExtension, shouldSkipFile } from "../../shared/extensions.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Normalizes afcclient's interactive prompt (which can appear glued to the
 * start of output, not just on its own line) into a line boundary, so naive
 * line-based parsing downstream can't silently swallow the first result. */
function splitAfcOutput(raw: string): string[] {
  return stripAnsi(raw)
    .replace(/afc:\/\s*>\s*/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function runAfcScript(udid: string, commands: string[]): Promise<string> {
  const proc = Bun.spawn(["afcclient", "-u", udid], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(commands.join("\n") + "\nquit\n");
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

async function runSimple(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

export async function listConnectedDeviceUdids(): Promise<string[]> {
  const stdout = await runSimple(["idevice_id", "-l"]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export async function getDeviceInfo(udid: string): Promise<Omit<DeviceInfo, "connectionType">> {
  const [name, iosVersion] = await Promise.all([
    runSimple(["ideviceinfo", "-u", udid, "-k", "DeviceName"]),
    runSimple(["ideviceinfo", "-u", udid, "-k", "ProductVersion"]),
  ]);
  return { udid, name: name.trim(), iosVersion: iosVersion.trim() };
}

export interface DevicePhotoEntry {
  devicePath: string; // e.g. DCIM/101APPLE/IMG_0855.JPG
  filename: string;
  sizeBytes: number;
}

/**
 * Lists every photo/video currently in the device's DCIM folder. Deliberately
 * excludes .AAE edit-metadata sidecars (and anything else not classified as
 * photo/video) — they're small, non-essential, and tracking them through the
 * device-import phase machine would need a schema change for modest value.
 * Folder-based import (Mac folder / DSLR card) still handles them fully.
 */
export async function listDevicePhotos(udid: string): Promise<DevicePhotoEntry[]> {
  const rootOutput = await runAfcScript(udid, ["ls DCIM"]);
  const folders = splitAfcOutput(rootOutput);

  const entries: DevicePhotoEntry[] = [];
  for (const folder of folders) {
    const raw = await runAfcScript(udid, [`ls -l DCIM/${folder}`]);
    for (const line of splitAfcOutput(raw)) {
      if (!line.startsWith("-rw")) continue;
      const parts = line.split(/\s+/);
      const sizeBytes = Number(parts[4]);
      const filename = parts[parts.length - 1];
      if (!filename || Number.isNaN(sizeBytes) || shouldSkipFile(filename)) continue;
      const classification = classifyExtension(filename);
      if (classification !== "photo" && classification !== "video") continue;
      entries.push({ devicePath: `DCIM/${folder}/${filename}`, filename, sizeBytes });
    }
  }
  return entries;
}

/**
 * Runs `get` commands for exactly the given files in one afcclient session.
 * Does NOT verify success per file (afcclient's text progress output isn't
 * reliably parseable per-command) — the caller (deviceImportJob.ts) is the
 * source of truth: it checks each local file's actual size against the
 * expected size from listDevicePhotos() and only then marks it copied.
 *
 * Callers own batch sizing (how many files per call) — that's what
 * determines the checkpoint granularity if the process is interrupted
 * mid-job, so this function deliberately does not chunk internally.
 */
export async function copyFilesFromDevice(
  udid: string,
  files: Array<{ devicePath: string; localDestPath: string }>,
): Promise<void> {
  if (files.length === 0) return;
  const commands = files.map((f) => `get "${f.devicePath}" "${f.localDestPath}"`);
  await runAfcScript(udid, commands);
}

/**
 * Runs `rm` commands for exactly the given device paths in one afcclient
 * session. Re-deleting an already-deleted path is expected to be harmless
 * (afcclient reports "no such file" but the session continues) — callers
 * should treat that as success, not an error, since the goal state (file
 * gone) is already achieved. See copyFilesFromDevice's note on batch sizing.
 */
export async function deleteFilesFromDevice(udid: string, devicePaths: string[]): Promise<void> {
  if (devicePaths.length === 0) return;
  const commands = devicePaths.map((p) => `rm "${p}"`);
  await runAfcScript(udid, commands);
}
