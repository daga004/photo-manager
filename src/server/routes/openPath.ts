import { config } from "../config.ts";

/**
 * Opens a folder in the host's native file manager (Finder on macOS, the default
 * file manager on Linux) so the user can browse/preview quarantined files with
 * the OS's own tools — e.g. Quick Look on macOS. The dialog/window opens on the
 * SERVER host (this machine), which is correct: that's where the library and its
 * quarantine live.
 *
 * Only a fixed ALLOW-LIST of targets is accepted (never an arbitrary path from
 * the client), so this can't be turned into a "open any path on the machine"
 * primitive even though it's localhost-only.
 */
const TARGETS: Record<string, string> = {
  quarantine: config.quarantineDir,
  "quarantine-duplicates": config.quarantineDuplicatesDir,
  "quarantine-import-duplicates": config.quarantineImportDuplicatesDir,
};

/**
 * Opens a path with the host OS's default handler: a FOLDER opens in the file
 * manager, a FILE opens in its default app (Preview/QuickTime/etc.). Used for
 * both "open quarantine folder" and the viewer's "open original" — the file is
 * already local, so this never downloads/streams it, it just hands the path to
 * the OS. Both `open`/`xdg-open` return immediately after handing off.
 */
export async function nativeOpen(path: string): Promise<void> {
  const cmd = process.platform === "darwin" ? ["open", path] : ["xdg-open", path];
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(stderr.trim() || `${cmd[0]} exited with code ${code}`);
  }
}

export function makeOpenPathHandler() {
  return async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    const target = (body as { target?: unknown }).target;
    if (typeof target !== "string" || !(target in TARGETS)) {
      return Response.json(
        { error: `target must be one of: ${Object.keys(TARGETS).join(", ")}` },
        { status: 400 },
      );
    }
    try {
      await nativeOpen(TARGETS[target] as string);
      return Response.json({ opened: true });
    } catch (err) {
      return Response.json(
        {
          error:
            "Could not open the folder on the server host. " +
            (process.platform === "darwin" ? "Is `open` available?" : "Install xdg-open (xdg-utils).") +
            ` (${err instanceof Error ? err.message : String(err)})`,
        },
        { status: 500 },
      );
    }
  };
}
