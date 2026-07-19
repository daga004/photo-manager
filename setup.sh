#!/usr/bin/env bash
# Bootstrap + launch photo-manager on macOS or Linux.
# Safe to re-run: every step checks for an existing install before acting.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OS="$(uname -s)"
log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1" >&2; }

have() { command -v "$1" >/dev/null 2>&1; }

# --- package manager detection (Linux only; macOS always uses Homebrew) ----
LINUX_PKG_INSTALL=""
if [ "$OS" = "Linux" ]; then
  if have apt-get; then LINUX_PKG_INSTALL="sudo apt-get update -qq && sudo apt-get install -y"
  elif have dnf; then LINUX_PKG_INSTALL="sudo dnf install -y"
  elif have pacman; then LINUX_PKG_INSTALL="sudo pacman -S --noconfirm"
  else
    warn "No known package manager found (apt-get/dnf/pacman). You'll need to install ffmpeg and exiftool manually."
  fi
fi

install_pkg() {
  # $1 = macOS brew formula name, $2 = Linux apt/dnf/pacman package name
  local brew_name="$1" linux_name="$2"
  if [ "$OS" = "Darwin" ]; then
    have brew || { warn "Homebrew not found — install it from https://brew.sh first."; return 1; }
    brew install "$brew_name"
  elif [ -n "$LINUX_PKG_INSTALL" ]; then
    eval "$LINUX_PKG_INSTALL $linux_name"
  else
    warn "Please install '$brew_name' manually for your distro."
    return 1
  fi
}

# --- bun --------------------------------------------------------------------
log "Checking for bun"
if have bun; then
  echo "bun already installed: $(bun --version)"
else
  echo "Installing bun (official install script, works on macOS + Linux)…"
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

# --- ffmpeg (video thumbnails) ----------------------------------------------
log "Checking for ffmpeg"
if have ffmpeg; then
  echo "ffmpeg already installed"
else
  install_pkg ffmpeg ffmpeg
fi

# --- exiftool (capture-date/metadata extraction) ----------------------------
log "Checking for exiftool"
if have exiftool; then
  echo "exiftool already installed"
else
  install_pkg exiftool libimage-exiftool-perl
fi

# --- libimobiledevice (optional: iPhone import via afcclient) --------------
log "Checking for afcclient (iPhone import — optional)"
if have afcclient; then
  echo "afcclient already installed"
else
  if [ "$OS" = "Darwin" ]; then
    install_pkg libimobiledevice libimobiledevice || true
  elif [ "$OS" = "Linux" ] && [ -n "$LINUX_PKG_INSTALL" ]; then
    eval "$LINUX_PKG_INSTALL libimobiledevice-utils" || \
      warn "Could not install libimobiledevice-utils automatically — iPhone import will be unavailable until you install it. Folder import (Mac folder / DSLR card) still works fine without it."
  else
    warn "Skipping afcclient — iPhone import will be unavailable. Folder import (Mac folder / DSLR card) still works fine without it."
  fi
fi

# --- project deps + DB migration --------------------------------------------
log "Installing project dependencies"
bun install

log "Running database migrations"
bun run migrate

# --- launch -------------------------------------------------------------
log "Setup complete. Starting the dev server…"
echo "Open http://localhost:3000 once it's up. Press Ctrl+C to stop."
echo ""
exec bun run dev
