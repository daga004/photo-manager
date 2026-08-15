/**
 * Native folder picker. A browser's own folder chooser (`<input webkitdirectory>`)
 * deliberately hides the real filesystem path for security — it only exposes file
 * blobs — which is useless here because the importer needs a real absolute path to
 * scan. So the dialog is opened on the *server host* (this machine, where the
 * library and source folders actually live) and we return the chosen POSIX path.
 *
 * The request intentionally blocks until the user picks or cancels — it's a
 * deliberate, user-initiated action, so there's no timeout to fight.
 */

async function runPicker(cmd: string[], stdin?: string): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, {
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (stdin !== undefined && proc.stdin) {
    proc.stdin.write(stdin);
    proc.stdin.end();
  }
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout: stdout.trim() };
}

async function chooseFolder(): Promise<string | null> {
  if (process.platform === "darwin") {
    // `choose folder` throws (non-zero exit) when the user cancels — treated as
    // "no selection" below. `POSIX path of` yields a plain /Volumes/... path.
    const script =
      'POSIX path of (choose folder with prompt "Select a folder to import photos/videos from")';
    const { code, stdout } = await runPicker(["osascript", "-"], script);
    if (code !== 0 || !stdout) return null;
    // osascript returns the path with a trailing slash; keep it tidy.
    return stdout.replace(/\/+$/, "") || "/";
  }

  // Linux: prefer zenity (GNOME), fall back to kdialog (KDE). Both exit non-zero
  // on cancel and print the chosen directory path on stdout.
  const zenity = await runPicker([
    "zenity",
    "--file-selection",
    "--directory",
    "--title=Select a folder to import photos/videos from",
  ]).catch(() => null);
  if (zenity && zenity.code === 0 && zenity.stdout) return zenity.stdout;

  const kdialog = await runPicker(["kdialog", "--getexistingdirectory", "."]).catch(() => null);
  if (kdialog && kdialog.code === 0 && kdialog.stdout) return kdialog.stdout;

  return null;
}

export function makePickFolderHandler() {
  return async (_req: Request): Promise<Response> => {
    try {
      const path = await chooseFolder();
      // path === null means the user cancelled (or no picker is available); the
      // client just leaves the input untouched.
      return Response.json({ path });
    } catch (err) {
      return Response.json(
        {
          error:
            "Could not open a folder picker on the server host. " +
            (process.platform === "darwin"
              ? "Is osascript available?"
              : "Install zenity or kdialog, or type the path manually.") +
            ` (${err instanceof Error ? err.message : String(err)})`,
        },
        { status: 500 },
      );
    }
  };
}
