# photo-manager

A local photo/video library manager: indexes a media library (organized as
`photos/YYYY/MM/` and `videos/YYYY/MM/`) into SQLite, imports new media from
a folder or a connected iPhone (via `afcclient`/libimobiledevice), generates
thumbnails, and helps find duplicates and cleanup candidates by day.

## Requirements

- [Bun](https://bun.sh) (latest)
- `exiftool` (`brew install exiftool`) — capture-date/metadata extraction
- `ffmpeg` (`brew install ffmpeg`) — video thumbnails
- `libimobiledevice` (`brew install libimobiledevice`) — iPhone import, via its `afcclient` CLI

## Setup

```sh
bun install
bun run migrate
bun run dev
```

Then open http://localhost:3000

## Configuration

Environment variables (see `src/server/config.ts`):

- `PHOTO_MANAGER_LIBRARY_ROOT` — default `/Volumes/nas`
- `PHOTO_MANAGER_DATA_DIR` — default `./data` (SQLite DB + thumbnail cache + quarantine).
  Move this to local disk if the project directory itself lives on a slow network share.
- `PHOTO_MANAGER_PORT` — default `3000`

## Notes

- `data/` is gitignored — it contains the SQLite index and thumbnail cache, which
  hold real file paths and personal photo metadata. Never remove this from `.gitignore`.
- Deleting from an iPhone during import only ever happens after a file is copied
  **and** verified (byte size + successful indexing) — see `src/server/services/deviceImportJob.ts`.
