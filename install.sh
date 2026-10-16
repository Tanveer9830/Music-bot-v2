#!/usr/bin/env bash
# =============================================================================
#   TANVEER MUSIC BOT V3 — One-command Ubuntu / Debian VPS installer
#   Made by Tanveer  -  Discord: tanveer5637
# =============================================================================
#
#   USAGE (from inside the cloned project directory)
#
#       chmod +x install.sh && ./install.sh
#
#   Options
#       -y, --yes              non-interactive; take answers from flags/env
#           --no-service       do not offer to install the systemd service
#           --service          install the systemd service without asking
#           --service-user U   run the service as user U (default: smart pick)
#           --skip-deps        do not run npm install (dependencies already ok)
#           --no-tests         skip the test suite
#           --no-start         never start the bot at the end
#           --dry-run          print what would happen, change nothing
#       -h, --help             show help
#
#   Non-interactive example (CI / automation):
#
#       DISCORD_TOKEN=... DISCORD_CLIENT_ID=... \
#       LAVALINK_HOST=... LAVALINK_PASSWORD=... \
#       ./install.sh --yes --service
#
#   DESIGN RULES (do not regress these)
#     * Never overwrite an existing .env.
#     * Never delete user data, databases, node_modules or configuration.
#     * Never print a secret value.
#     * Safe to run repeatedly (idempotent) — upgrades just work.
#     * No curl|bash. The only downloaded payload is the official Node.js
#       tarball from nodejs.org, and it is verified against SHASUMS256.txt.
#
# =============================================================================

set -Eeuo pipefail

# -----------------------------------------------------------------------------
#  Constants
# -----------------------------------------------------------------------------
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly APP_DIR
readonly SERVICE_NAME="tanveer-music-bot"
readonly SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
readonly NODE_MAJOR_REQUIRED=18
readonly NODE_MAJOR_PREFERRED=22
readonly NODE_TARBALL_BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR_PREFERRED}.x"
readonly LOG_FILE="${APP_DIR}/install.log"

# -----------------------------------------------------------------------------
#  Options
# -----------------------------------------------------------------------------
ASSUME_YES=0
WANT_SERVICE=""          # "" = ask, "yes" = install, "no" = skip
SERVICE_USER_ARG=""
SKIP_DEPS=0
SKIP_TESTS=0
NO_START=0
DRY_RUN=0
DOCTOR_FAILED=0

# -----------------------------------------------------------------------------
#  Colour + logging
# -----------------------------------------------------------------------------
setup_colours() {
    if [ -n "${FORCE_COLOR:-}" ] && [ "${FORCE_COLOR}" != "0" ]; then
        USE_COLOR=1
    elif [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
        USE_COLOR=1
    else
        USE_COLOR=0
    fi

    if [ "$USE_COLOR" -eq 1 ]; then
        C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
        C_PURPLE=$'\033[38;5;135m'; C_VIOLET=$'\033[38;5;99m'
        C_CYAN=$'\033[38;5;51m'; C_WHITE=$'\033[97m'
        C_GREEN=$'\033[38;5;41m'; C_YELLOW=$'\033[38;5;220m'
        C_RED=$'\033[38;5;203m'; C_GREY=$'\033[38;5;245m'
    else
        C_RESET=""; C_BOLD=""; C_DIM=""; C_PURPLE=""; C_VIOLET=""
        C_CYAN=""; C_WHITE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_GREY=""
    fi
}

log_line() { # log_line <plain-file-line> <coloured-line>
    printf '%s\n' "$1" >>"$LOG_FILE" 2>/dev/null || true
    printf '%s\n' "$2"
}

info() { log_line "INFO  $*" "  ${C_CYAN}i${C_RESET}  $*"; }
ok()   { log_line "OK    $*" "  ${C_GREEN}+${C_RESET}  $*"; }
warn() { log_line "WARN  $*" "  ${C_YELLOW}!${C_RESET}  $*"; }
err()  { printf 'ERROR %s\n' "$*" >>"$LOG_FILE" 2>/dev/null || true; printf '  %sx%s  %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
step() { printf '\n%s%s> %s%s\n' "$C_PURPLE" "$C_BOLD" "$*" "$C_RESET"; }
plain(){ printf '%s\n' "$*"; }

die() {
    printf '\n%s%s  x INSTALLATION FAILED%s\n\n' "$C_RED" "$C_BOLD" "$C_RESET" >&2
    printf '  %s\n\n' "$*" >&2
    text="$(cat "${APP_DIR}/branding/troubleshooting.txt" 2>/dev/null || true)"
    if [ -n "$text" ]; then printf '%s\n' "$text" >&2; else
        printf '  Troubleshooting\n' >&2
        printf '  -------------------------------------------------------------\n' >&2
        printf '  • Re-run the installer — it is safe to run again.\n' >&2
        printf '  • Full log:  %s\n' "$LOG_FILE" >&2
        printf '  • Validate configuration without starting the bot:\n' >&2
        printf '      npm run doctor\n' >&2
        printf '  • See the Troubleshooting section of README.md.\n' >&2
    fi
    exit 1
}

# -----------------------------------------------------------------------------
#  Banner — read from branding/banner.txt so there is ONE source of truth
# -----------------------------------------------------------------------------
print_banner() {
    local subtitle="${1:-}"
    local banner_file="${APP_DIR}/branding/banner.txt"
    printf '\n'
    if [ -r "$banner_file" ]; then
        while IFS= read -r line; do
            case "$line" in
                +==*|+--*) printf '%s%s%s%s\n' "$C_PURPLE" "$C_BOLD" "$line" "$C_RESET" ;;
                \|*MUSIC\ BOT\ V3*|*EEEEE*) printf '%s%s%s%s\n' "$C_CYAN" "$C_BOLD" "$line" "$C_RESET" ;;
                *MADE\ BY\ TANVEER*|*tanveer5637*|*Premium\ Music*)
                    printf '%s%s%s%s\n' "$C_WHITE" "$C_BOLD" "$line" "$C_RESET" ;;
                \|*\ \ \ \ \ \ *\|) printf '%s%s%s%s\n' "$C_VIOLET" "$line" "$C_RESET" ;;
                *) printf '%s%s%s\n' "$C_GREY" "$line" "$C_RESET" ;;
            esac
        done <"$banner_file"
    else
        # Readable fallback if the asset is missing — never fail on decoration.
        printf '%s%s\n' "$C_PURPLE" "+======================================================================+"
        printf '%s%s\n' "$C_CYAN"   "|  TANVEER MUSIC BOT V3                                                |"
        printf '%s%s\n' "$C_WHITE"  "|  MADE BY TANVEER                                                     |"
        printf '%s%s\n' "$C_WHITE"  "|  Discord: tanveer5637                                                |"
        printf '%s%s\n' "$C_PURPLE" "+======================================================================+$C_RESET"
    fi
    # Signature block — guarantees the three permanent strings appear verbatim
    # in every installer run, in the same order the branding module uses.
    printf '   %s%sTANVEER MUSIC BOT V3%s%s | %s%sMADE BY TANVEER%s%s | %sDiscord: tanveer5637%s\n' \
        "$C_PURPLE" "$C_BOLD" "$C_RESET" "$C_GREY" \
        "$C_WHITE" "$C_BOLD" "$C_RESET" "$C_GREY" \
        "$C_CYAN" "$C_RESET"
    printf '   %sPremium Music Experience%s\n' "$C_GREY" "$C_RESET"
    if [ -n "$subtitle" ]; then
        printf '   %s%s%s\n' "$C_DIM" "$subtitle" "$C_RESET"
    fi
    printf '\n'
    return 0
}

# -----------------------------------------------------------------------------
#  ARGUMENT PARSING
# -----------------------------------------------------------------------------
usage() {
    sed -n '3,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    print_banner
}

while [ $# -gt 0 ]; do
    case "$1" in
        -y|--yes)        ASSUME_YES=1 ;;
        --no-service)    WANT_SERVICE="no" ;;
        --service)       WANT_SERVICE="yes" ;;
        --service-user)  SERVICE_USER_ARG="${2:-}"; shift ;;
        --skip-deps)     SKIP_DEPS=1 ;;
        --no-tests)      SKIP_TESTS=1 ;;
        --no-start)      NO_START=1 ;;
        --dry-run)       DRY_RUN=1 ;;
        -h|--help)       usage; exit 0 ;;
        *) printf 'Unknown option: %s\nRun ./install.sh --help\n' "$1" >&2; exit 2 ;;
    esac
    shift
done

setup_colours

# All npm/node commands assume the project root, no matter where the script
# was invoked from.
cd "$APP_DIR" || die "Could not enter the project directory: ${APP_DIR}"

: >"$LOG_FILE" 2>/dev/null || true
log_line "=== TANVEER MUSIC BOT V3 installer — $(date -u '+%Y-%m-%dT%H:%M:%SZ') ===" \
         "=== TANVEER MUSIC BOT V3 installer — $(date -u '+%Y-%m-%dT%H:%M:%SZ') ==="

# -----------------------------------------------------------------------------
#  Helpers
# -----------------------------------------------------------------------------
is_root() { [ "$(id -u)" -eq 0 ]; }
have_cmd() { command -v "$1" >/dev/null 2>&1; }

# Run a command as root: no sudo when already root, sudo when available.
run_root() {
    if [ "$DRY_RUN" -eq 1 ]; then
        info "[dry-run] would run as root: $*"
        return 0
    fi
    if is_root; then "$@"; elif have_cmd sudo; then sudo "$@"; else
        die "This step needs root privileges but sudo is not available.
  Either re-run as root (sudo ./install.sh) or install the missing package manually.
  Failing command: $*"
    fi
}

can_become_root() {
    is_root && return 0
    have_cmd sudo || return 1
    sudo -n true 2>/dev/null
}

# Ask a yes/no question. Returns 0 for yes.
confirm() {
    local prompt="$1" default="${2:-n}" answer=""
    if [ "$ASSUME_YES" -eq 1 ]; then
        [ "$default" = "y" ] && return 0 || return 1
    fi
    if [ ! -t 0 ]; then
        [ "$default" = "y" ] && return 0 || return 1
    fi
    local hint="[y/N]"; [ "$default" = "y" ] && hint="[Y/n]"
    read -r -p "$(printf '  %s%s%s %s ' "$C_WHITE" "$prompt" "$C_RESET" "$hint")" answer || answer=""
    answer="${answer,,}"
    [ -z "$answer" ] && answer="$default"
    [[ "$answer" == y* ]]
}

# Prompt for a visible, non-secret value.
prompt_value() {
    local label="$1" current="${2:-}" answer=""
    if [ ! -t 0 ]; then printf '%s' "$current"; return 0; fi
    local shown="$current"; [ -z "$shown" ] && shown="(blank)"
    read -r -p "$(printf '  %s%s%s %s[%s]%s: ' "$C_WHITE" "$label" "$C_RESET" "$C_GREY" "$shown" "$C_RESET")" answer || answer=""
    [ -z "$answer" ] && answer="$current"
    printf '%s' "$answer"
}

# Prompt for a SECRET without echoing it to the terminal or to any log.
prompt_secret() {
    local label="$1" answer=""
    if [ ! -t 0 ]; then
        die "Cannot prompt for \"$label\" because this shell is not interactive.
  Re-run in a terminal, or supply the value ahead of time — for example:
      DISCORD_TOKEN='...' ./install.sh --yes"
    fi
    printf '  %s%s%s %s(input hidden)%s: ' "$C_WHITE" "$label" "$C_RESET" "$C_GREY" "$C_RESET" >&2
    read -r -s answer || answer=""
    printf '\n' >&2
    printf '%s' "$answer"
}

# Escape a value for safe insertion into a .env line.
env_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# Read a key from an existing .env. Returns an empty string when absent.
# Works on busybox/GNU userlands alike (no GNU-only sed extensions).
env_get() {
    local key="$1" file="${2:-${APP_DIR}/.env}" line=""
    [ -r "$file" ] || return 0
    line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null | tail -n 1)" || return 0
    [ -n "$line" ] || return 0
    line="${line#*=}"
    line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    line="${line%\"}"; line="${line#\"}"
    line="${line%\'}"; line="${line#\'}"
    printf '%s' "$line"
}

# Atomically append or replace a key in .env (upsert). Never prints the value.
env_set() {
    local key="$1" value="$2" file="${APP_DIR}/.env" tmp
    tmp="$(mktemp)"
    if [ -f "$file" ]; then
        # Replace the key in place. Duplicate keys are collapsed to a single
        # line so the file can never drift or hold a stale value.
        awk -v k="$key" -v v="$value" '
            {
                probe = $0
                sub(/^[[:space:]]*(export[[:space:]]+)?/, "", probe)
                if (index(probe, k "=") == 1) {
                    if (!done) { print k "=\"" v "\""; done = 1 }
                    next
                }
                print
            }
        ' "$file" >"$tmp"
        if ! grep -qE "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null; then
            printf '%s="%s"\n' "$key" "$value" >>"$tmp"
        fi
    else
        printf '%s="%s"\n' "$key" "$value" >>"$tmp"
    fi
    cat "$tmp" >"$file"
    rm -f "$tmp"
}

# -----------------------------------------------------------------------------
#  STEP 0 — preflight banner
# -----------------------------------------------------------------------------
print_banner "Ubuntu / Debian VPS installer — $(date -u '+%Y-%m-%d %H:%M UTC')"
info "Project directory: ${C_BOLD}${APP_DIR}${C_RESET}"
info "Install log:       ${LOG_FILE}"
if [ "$DRY_RUN" -eq 1 ]; then
    warn "DRY RUN — nothing will actually be changed."
fi

# -----------------------------------------------------------------------------
#  STEP 1 — verify this really is the bot project
# -----------------------------------------------------------------------------
step "1/9  Verifying the project"

[ -f "${APP_DIR}/package.json" ] || die "package.json not found in ${APP_DIR}.
  You are probably not inside the cloned project directory.
  Correct procedure:
      git clone https://github.com/Tanveer9830/Music-bot-v2.git
      cd Music-bot-v2"

# The bot's entry point and scripts are DISCOVERED, never assumed.
ENTRY_POINT="$(node -e 'const p=require("./package.json"); process.stdout.write(p.main||"index.js")' 2>/dev/null || echo "index.js")"
START_SCRIPT="$(node -e 'const s=require("./package.json").scripts||{}; process.stdout.write(s.start||"")' 2>/dev/null || echo "")"
BOT_VERSION="$(node -e 'process.stdout.write(require("./package.json").version||"0.0.0")' 2>/dev/null || echo "0.0.0")"
readonly ENTRY_POINT START_SCRIPT BOT_VERSION

[ -f "${APP_DIR}/${ENTRY_POINT}" ] || die "Entry point \"${ENTRY_POINT}\" (from package.json \"main\") does not exist."
ok "package.json found — ${C_BOLD}TANVEER MUSIC BOT V3${C_RESET} v${BOT_VERSION}"
ok "Entry point: ${ENTRY_POINT}   (npm start → ${START_SCRIPT:-node ${ENTRY_POINT}})"

if [ -f "${APP_DIR}/.git/HEAD" ]; then
    COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "unknown")"
    ok "Git commit: ${COMMIT}"
fi

# Branding integrity — the permanent identity must always be present.
if [ -f "${APP_DIR}/utils/branding.js" ]; then
    if BRAND_OUT="$(node -e 'const b=require("./utils/branding.js");const v=b.verifyBranding();if(!v.ok){console.error("MISSING: "+v.missing.join(", "));process.exit(1)}' 2>&1)"; then
        ok "Branding verified: TANVEER MUSIC BOT V3 - MADE BY TANVEER - Discord: tanveer5637"
    else
        warn "Branding strings incomplete (${BRAND_OUT}). Continuing — this does not affect playback."
    fi
fi

# -----------------------------------------------------------------------------
#  STEP 2 — operating system support
# -----------------------------------------------------------------------------
step "2/9  Checking the operating system"

OS_ID=""; OS_LIKE=""; OS_PRETTY=""
if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-}"; OS_LIKE="${ID_LIKE:-}"; OS_PRETTY="${PRETTY_NAME:-$ID}"
fi

case " ${OS_ID} ${OS_LIKE} " in
    *" ubuntu "*|*" debian "*)
        ok "Supported OS detected: ${OS_PRETTY:-$OS_ID}"
        ;;
    *)
        die "Unsupported operating system: ${OS_PRETTY:-unknown} (ID='${OS_ID:-?}').
  This installer targets ${C_BOLD}Ubuntu 20.04/22.04/24.04${C_RESET} and ${C_BOLD}Debian 11/12${C_RESET}.
  Manual installation on another distribution:
      1. Install Node.js ${NODE_MAJOR_PREFERRED} LTS
      2. cp .env.example .env && chmod 600 .env   (fill in your credentials)
      3. npm ci --omit=dev
      4. npm run doctor
      5. npm start"
        ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
    x86_64|amd64|aarch64|arm64) ok "Architecture: ${ARCH}" ;;
    *) warn "Untested architecture \"${ARCH}\" — the install will continue but binaries may be unavailable." ;;
esac

# -----------------------------------------------------------------------------
#  STEP 3 — Node.js + npm
# -----------------------------------------------------------------------------
step "3/9  Checking Node.js and npm"

node_major() {
    have_cmd node || { echo 0; return; }
    node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1
}

CURRENT_MAJOR="$(node_major)"
NODE_OK=0
if [ "${CURRENT_MAJOR:-0}" -ge "$NODE_MAJOR_REQUIRED" ] 2>/dev/null; then
    ok "Node.js $(node -v) satisfies >= v${NODE_MAJOR_REQUIRED}"
    NODE_OK=1
else
    if have_cmd node; then
        warn "Node.js $(node -v) is too old (v${NODE_MAJOR_REQUIRED}+ required)."
    else
        warn "Node.js is not installed."
    fi
fi

install_node_from_apt() {
    # Ubuntu 24.04 / Debian 12 ship Node 18+, which is enough.
    local candidate
    candidate="$(apt-cache policy nodejs 2>/dev/null | sed -n 's/.*Candidate: *\([0-9]*\).*/\1/p' | head -n1)"
    if [ -n "$candidate" ] && [ "$candidate" -ge "$NODE_MAJOR_REQUIRED" ] 2>/dev/null; then
        info "APT offers Node.js v${candidate} — installing from the distribution repository."
        run_root apt-get update -qq
        run_root apt-get install -y nodejs npm
        return 0
    fi
    return 1
}

install_node_from_tarball() {
    # Official prebuilt binary, checksum-verified. Nothing is piped to a shell.
    info "Downloading the official Node.js ${NODE_MAJOR_PREFERRED} LTS binary from nodejs.org..."
    local tmp tarball shasums dirsum want got
    tmp="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" RETURN

    if ! curl -fsSL --retry 3 -o "${tmp}/shasums" "${NODE_TARBALL_BASE}/SHASUMS256.txt"; then
        rm -rf "$tmp"; return 1
    fi

    case "$ARCH" in
        x86_64|amd64)   dirsum="node-v${NODE_MAJOR_PREFERRED}.*-linux-x64.tar.xz" ;;
        aarch64|arm64)  dirsum="node-v${NODE_MAJOR_PREFERRED}.*-linux-arm64.tar.xz" ;;
        *) rm -rf "$tmp"; return 1 ;;
    esac

    tarball="$(awk -v pat="$dirsum" '$2 ~ pat {print $2}' "${tmp}/shasums" | head -n1)"
    want="$(awk -v pat="$dirsum" '$2 ~ pat {print $1}' "${tmp}/shasums" | head -n1)"
    [ -n "$tarball" ] || { rm -rf "$tmp"; return 1; }

    info "Verifying SHA-256 checksum before installing..."
    if ! curl -fsSL --retry 3 -o "${tmp}/${tarball}" "${NODE_TARBALL_BASE}/${tarball}"; then
        rm -rf "$tmp"; return 1
    fi
    got="$(sha256sum "${tmp}/${tarball}" | awk '{print $1}')"
    if [ "$got" != "$want" ]; then
        rm -rf "$tmp"
        die "Checksum mismatch for ${tarball}.
  Expected: ${want}
  Got:      ${got}
  The download was corrupted or tampered with. Nothing was installed."
    fi
    ok "Checksum verified for ${tarball}"

    info "Extracting to /usr/local (this is the only system-level change Node needs)..."
    run_root tar -xJf "${tmp}/${tarball}" -C /usr/local --strip-components=1 \
        --exclude='CHANGELOG.md' --exclude='LICENSE' --exclude='README.md'
    rm -rf "$tmp"
    hash -r 2>/dev/null || true
    return 0
}

if [ "$NODE_OK" -eq 0 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
        info "[dry-run] would install Node.js ${NODE_MAJOR_PREFERRED} LTS"
    elif ! can_become_root; then
        die "Node.js v${NODE_MAJOR_REQUIRED}+ is required but is not installed, and this script
  cannot obtain root privileges to install it.

  Options
    1. Re-run the installer with sudo:      sudo ./install.sh
    2. Install Node.js yourself (v${NODE_MAJOR_REQUIRED}+), then re-run this script.
       Official downloads:  https://nodejs.org/en/download
       Review anything you install as root — this installer never pipes a
       downloaded script into a shell."
    else
        info "Root privileges are available — installing Node.js."
        if ! install_node_from_apt; then
            install_node_from_tarball || die "Could not install Node.js automatically.
  If you are behind a restrictive network, install Node.js v${NODE_MAJOR_REQUIRED}+
  manually from https://nodejs.org/en/download and re-run this script."
        fi
        hash -r 2>/dev/null || true
        CURRENT_MAJOR="$(node_major)"
        [ "${CURRENT_MAJOR:-0}" -ge "$NODE_MAJOR_REQUIRED" ] 2>/dev/null \
            || die "Node.js installation did not produce a usable v${NODE_MAJOR_REQUIRED}+ binary."
        ok "Node.js $(node -v) installed"
    fi
fi

if have_cmd npm; then
    ok "npm $(npm -v)"
else
    if [ "$DRY_RUN" -eq 1 ]; then
        info "[dry-run] would install npm"
    else
        warn "npm is missing — attempting to install it via APT."
        run_root apt-get update -qq || true
        run_root apt-get install -y npm || die "Could not install npm. Install it manually and re-run."
        ok "npm $(npm -v)"
    fi
fi

# curl is needed for downloads; offer to install it only if missing.
if ! have_cmd curl; then
    warn "curl is not installed."
    if can_become_root && [ "$DRY_RUN" -eq 0 ]; then
        run_root apt-get install -y curl || warn "Could not install curl — continuing."
    fi
fi

NODE_BIN="$(command -v node || echo /usr/bin/node)"
readonly NODE_BIN

# -----------------------------------------------------------------------------
#  STEP 4 — environment file (never overwrite)
# -----------------------------------------------------------------------------
step "4/9  Configuring .env"

ENV_FILE="${APP_DIR}/.env"
ENV_EXISTED=0
if [ "$DRY_RUN" -eq 1 ]; then
    # A dry run must be strictly read-only: no writes, no chmod, no prompts.
    if [ -f "$ENV_FILE" ]; then
        info "[dry-run] existing .env found — it would be read, hardened to 600, and never overwritten"
    else
        info "[dry-run] no .env yet — one would be created from .env.example (mode 600)"
    fi
elif [ -f "$ENV_FILE" ]; then
    ENV_EXISTED=1
    ok "Existing .env preserved — it will NOT be overwritten."
    chmod 600 "$ENV_FILE" 2>/dev/null || true
    cp -a "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)" 2>/dev/null \
        && info "Safety copy written next to it before any change."
else
    if [ -f "${APP_DIR}/.env.example" ]; then
        cp "${APP_DIR}/.env.example" "$ENV_FILE" || die "Could not create .env from .env.example."
        ok "Created .env from .env.example"
    else
        : >"$ENV_FILE"
        warn ".env.example was missing — created an empty .env"
    fi
    chmod 600 "$ENV_FILE"
    chown "$(id -u):$(id -g)" "$ENV_FILE" 2>/dev/null || true
    ok ".env permissions set to 600 (owner read/write only)"
fi

# -- Discord credentials ------------------------------------------------------
step "4a/9  Discord credentials"

CUR_TOKEN="$(env_get DISCORD_TOKEN || true)"
CUR_CLIENT_ID="$(env_get DISCORD_CLIENT_ID || true)"
CUR_GUILD_ID="$(env_get DISCORD_GUILD_ID || true)"

TOKEN="${DISCORD_TOKEN:-$CUR_TOKEN}"
CLIENT_ID="${DISCORD_CLIENT_ID:-$CUR_CLIENT_ID}"
GUILD_ID="${DISCORD_GUILD_ID:-$CUR_GUILD_ID}"

if [ -n "$TOKEN" ]; then
    ok "Discord bot token present (value hidden)."
elif [ "$DRY_RUN" -eq 1 ]; then
    warn "[dry-run] no token found in the environment or .env — a real run would prompt for it."
else
    printf '\n'
    plain "  ${C_WHITE}${C_BOLD}How to get your bot token${C_RESET}"
    plain "    1. Open ${C_CYAN}https://discord.com/developers/applications${C_RESET}"
    plain "    2. Select your application (or click New Application)"
    plain "    3. Left sidebar → ${C_BOLD}Bot${C_RESET} → ${C_BOLD}Reset Token${C_RESET} → Copy"
    plain "    4. Never share it. If it leaks, reset it immediately."
    printf '\n'
    TOKEN="$(prompt_secret "Discord bot token")"
fi

# Validate the token shape WITHOUT printing it.
validate_token() {
    local t="$1"
    [ -n "$t" ] || return 1
    [ "${#t}" -ge 50 ] || return 1
    [ "$(printf '%s' "$t" | awk -F. '{print NF}')" -eq 3 ] || return 1
    return 0
}

if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] token validation skipped"
    if [ -z "$CLIENT_ID" ]; then
        CLIENT_ID="<derived from token at real run>"
    fi
elif ! validate_token "$TOKEN"; then
    die "The Discord bot token looks invalid (a real bot token has three dot-separated parts
  and is at least 50 characters long).

  Copy it again from: Discord Developer Portal → your application → Bot → Reset Token.
  Then re-run ./install.sh — your existing .env is preserved."
else
    ok "Bot token format validated (value never printed)."
fi

# The application ID can be recovered from the token, so this is optional.
if [ -z "$CLIENT_ID" ] && [ -n "$TOKEN" ]; then
    CLIENT_ID="$(TOKEN="$TOKEN" node -e 'const s=process.env.TOKEN.split(".")[0];try{const d=Buffer.from(s,"base64").toString("utf8").trim();process.stdout.write(/^\d{17,20}$/.test(d)?d:"")}catch(e){}' 2>/dev/null || true)"
    if [ -n "$CLIENT_ID" ]; then
        ok "Application ID derived from the token: ${CLIENT_ID}"
    fi
fi

if [ -z "$CLIENT_ID" ]; then
    CLIENT_ID="$(prompt_value "Discord application (client) ID" "")"
fi

[ -n "$GUILD_ID" ] || GUILD_ID="$(prompt_value "Optional development guild ID (Enter to skip)" "")"

# -- Lavalink -----------------------------------------------------------------
step "4b/9  Lavalink configuration"

LAV_HOST_CUR="$(env_get LAVALINK_HOST || true)"; LAV_HOST_CUR="${LAV_HOST_CUR:-127.0.0.1}"
LAV_PORT_CUR="$(env_get LAVALINK_PORT || true)"; LAV_PORT_CUR="${LAV_PORT_CUR:-2333}"
LAV_PASS_CUR="$(env_get LAVALINK_PASSWORD || true)"; LAV_PASS_CUR="${LAV_PASS_CUR:-youshallnotpass}"
LAV_NAME_CUR="$(env_get LAVALINK_NAME || true)"; LAV_NAME_CUR="${LAV_NAME_CUR:-Main Node}"
LAV_SECURE_CUR="$(env_get LAVALINK_SECURE || true)"; LAV_SECURE_CUR="${LAV_SECURE_CUR:-false}"

LAV_HOST="${LAVALINK_HOST:-$LAV_HOST_CUR}"
LAV_PORT="${LAVALINK_PORT:-$LAV_PORT_CUR}"
LAV_PASS="${LAVALINK_PASSWORD:-$LAV_PASS_CUR}"
LAV_NAME="${LAVALINK_NAME:-$LAV_NAME_CUR}"
LAV_SECURE="${LAVALINK_SECURE:-$LAV_SECURE_CUR}"
LAV_SKIP=0

printf '\n'
plain "  ${C_WHITE}${C_BOLD}About Lavalink${C_RESET}"
plain "    Every Discord music bot needs a Lavalink server to actually stream audio."
plain "    • Already have one?  Enter its host, port and password below."
plain "    • Same VPS as this bot?  Use host ${C_BOLD}127.0.0.1${C_RESET}."
plain "    • Not ready yet?  ${C_BOLD}Choose 'skip'${C_RESET} — the bot still starts and you can"
plain "      finish this later by editing ${C_BOLD}.env${C_RESET} and re-running the installer."
printf '\n'

if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    info "Non-interactive mode — using the Lavalink values already present."
elif confirm "Configure Lavalink now?" "y"; then
    LAV_HOST="$(prompt_value "Lavalink host" "$LAV_HOST")"
    LAV_PORT="$(prompt_value "Lavalink port" "$LAV_PORT")"
    LAV_NAME="$(prompt_value "Node name (label only)" "$LAV_NAME")"
    if confirm "Do you have a Lavalink password to set?" "y"; then
        LAV_PASS="$(prompt_secret "Lavalink password")"
    fi
    if confirm "Is this Lavalink behind TLS (https / wss)?" "n"; then
        LAV_SECURE="true"; else LAV_SECURE="false"; fi
else
    LAV_SKIP=1
    warn "Lavalink configuration skipped — playback will not work until you set it."
    info "Edit ${ENV_FILE} later, then run: npm run doctor -- --live"
fi

# Port sanity — never blocks the install.
if ! printf '%s' "$LAV_PORT" | grep -Eq '^[0-9]+$' || [ "$LAV_PORT" -lt 1 ] || [ "$LAV_PORT" -gt 65535 ]; then
    warn "LAVALINK_PORT \"${LAV_PORT}\" is not a valid TCP port — falling back to 2333."
    LAV_PORT=2333
fi

# -- Spotify (optional) -------------------------------------------------------
SPO_ID="${SPOTIFY_CLIENT_ID:-$(env_get SPOTIFY_CLIENT_ID || true)}"
SPO_SECRET="${SPOTIFY_CLIENT_SECRET:-$(env_get SPOTIFY_CLIENT_SECRET || true)}"
if [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ] && [ -z "$SPO_ID" ]; then
    if confirm "Enable Spotify link support? (needs a free Spotify developer app)" "n"; then
        SPO_ID="$(prompt_value "Spotify client ID" "")"
        SPO_SECRET="$(prompt_secret "Spotify client secret")"
    fi
fi

# -- Persist to .env ----------------------------------------------------------
if [ "$DRY_RUN" -eq 0 ]; then
    info "Writing configuration to .env (secrets stay on this server)..."
    if [ -n "$TOKEN" ]; then
        env_set DISCORD_TOKEN "$(env_escape "$TOKEN")"
    fi
    if [ -n "$CLIENT_ID" ]; then
        env_set DISCORD_CLIENT_ID "$(env_escape "$CLIENT_ID")"
    fi
    env_set DISCORD_GUILD_ID "$(env_escape "$GUILD_ID")"
    env_set LAVALINK_HOST "$(env_escape "$LAV_HOST")"
    env_set LAVALINK_PORT "$(env_escape "$LAV_PORT")"
    env_set LAVALINK_PASSWORD "$(env_escape "$LAV_PASS")"
    env_set LAVALINK_SECURE "$(env_escape "$LAV_SECURE")"
    env_set LAVALINK_NAME "$(env_escape "$LAV_NAME")"
    if [ -n "$SPO_ID" ]; then
        env_set SPOTIFY_CLIENT_ID "$(env_escape "$SPO_ID")"
        env_set SPOTIFY_CLIENT_SECRET "$(env_escape "$SPO_SECRET")"
    fi
    chmod 600 "$ENV_FILE"
    ok ".env written with mode 600 (only this user can read it)"
fi

# -----------------------------------------------------------------------------
#  STEP 5 — dependencies
# -----------------------------------------------------------------------------
step "5/9  Installing dependencies"

if [ "$SKIP_DEPS" -eq 1 ]; then
    info "Skipped (--skip-deps)."
elif [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] would install npm dependencies."
else
    export npm_config_audit=false npm_config_fund=false
    if [ -f "${APP_DIR}/package-lock.json" ]; then
        ok "package-lock.json found — using reproducible install (npm ci)."
        if ! npm ci --omit=dev --no-audit --no-fund; then
            warn "npm ci failed. The lockfile may be out of date with package.json."
            info "Retrying with npm install (this may update the lockfile)..."
            npm install --omit=dev --no-audit --no-fund \
                || die "Dependency installation failed.

  Common causes
    • No internet access from this server.
    • A corporate proxy — try: npm config set proxy http://your-proxy:port
    • Not enough disk space — check with: df -h
    • Corrupted cache — try: npm cache clean --force && npm ci --omit=dev"
        fi
    else
        warn "No package-lock.json — using npm install (dependency versions may drift)."
        npm install --omit=dev --no-audit --no-fund \
            || die "Dependency installation failed. See the troubleshooting section in README.md."
    fi
    ok "Dependencies installed."
fi

# -----------------------------------------------------------------------------
#  STEP 6 — validate configuration (static)
# -----------------------------------------------------------------------------
step "6/9  Validating configuration"

if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] would run: npm run doctor"
elif [ -f "${APP_DIR}/scripts/doctor.js" ]; then
    if node "${APP_DIR}/scripts/doctor.js"; then
        ok "Static configuration check passed."
    else
        warn "The configuration doctor reported problems (see above)."
        if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
            # Unattended mode: never hang or abort silently — report and go on,
            # because the user asked for a non-interactive install.
            warn "Continuing because --yes was given. Fix the problems above before starting."
            DOCTOR_FAILED=1
        elif ! confirm "Continue anyway?" "n"; then
            die "Installation stopped at your request. Nothing was deleted.
  Fix the reported problems, then re-run ./install.sh — your .env is preserved."
        fi
    fi
else
    warn "scripts/doctor.js not found — skipping the static check."
fi

info "Note: this only proves the settings are well-formed."
info "It does NOT prove Lavalink is reachable. Verify a live node with:"
plain "        npm run doctor -- --live"

# -----------------------------------------------------------------------------
#  STEP 7 — tests
# -----------------------------------------------------------------------------
step "7/9  Running tests"

if [ "$SKIP_TESTS" -eq 1 ]; then
    info "Skipped (--no-tests)."
elif [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] would run the test suite."
else
    HAS_TEST_SCRIPT="$(node -e 'const s=require("./package.json").scripts||{};process.stdout.write(s.test?"yes":"no")' 2>/dev/null || echo no)"
    if [ -f "${APP_DIR}/tests/run-tests.js" ]; then
        if node "${APP_DIR}/tests/run-tests.js"; then
            ok "Test suite passed."
        else
            warn "Some tests FAILED (details above)."
        fi
    elif [ "$HAS_TEST_SCRIPT" = "yes" ]; then
        if npm test; then ok "npm test passed."; else warn "npm test reported failures."; fi
    else
        info "No test suite is defined in this project — nothing to run."
    fi
fi

# -----------------------------------------------------------------------------
#  STEP 8 — optional systemd service
# -----------------------------------------------------------------------------
step "8/9  Automatic startup (optional systemd service)"

SERVICE_INSTALLED=0

systemd_available() { have_cmd systemctl && [ -d /run/systemd/system ]; }

# Pick a sensible account for the service to run as.
pick_run_user() {
    if [ -n "$SERVICE_USER_ARG" ]; then printf '%s' "$SERVICE_USER_ARG"; return; fi
    if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && id "$SUDO_USER" >/dev/null 2>&1; then
        printf '%s' "$SUDO_USER"; return
    fi
    if is_root; then printf 'tanveermusicbot'; return; fi
    id -un
}

install_service() {
    local run_user run_group
    run_user="$(pick_run_user)"

    if [ "$run_user" = "tanveermusicbot" ] && ! id "$run_user" >/dev/null 2>&1; then
        info "Creating a dedicated system account \"${run_user}\" (no login shell, no sudo)."
        run_root useradd --system --create-home --shell /usr/sbin/nologin "$run_user" \
            || warn "Could not create the account — falling back to root."
        id "$run_user" >/dev/null 2>&1 || run_user="root"
    fi
    run_group="$(id -gn "$run_user" 2>/dev/null || echo "$run_user")"

    info "Service will run as: ${run_user}:${run_group}"

    # The service must be able to read the project and the .env file.
    if [ "$run_user" != "$(id -un)" ]; then
        run_root chown -R "${run_user}:${run_group}" "$APP_DIR" 2>/dev/null \
            || warn "Could not change project ownership — the service may not start."
    fi
    run_root chmod 600 "$ENV_FILE" 2>/dev/null || true

    local unit_src="${APP_DIR}/deploy/${SERVICE_NAME}.service.in"
    [ -f "$unit_src" ] || die "Service template missing: ${unit_src}"

    info "Writing ${SERVICE_FILE} ..."
    local rendered
    rendered="$(sed \
        -e "s|@@APP_DIR@@|${APP_DIR}|g" \
        -e "s|@@RUN_USER@@|${run_user}|g" \
        -e "s|@@RUN_GROUP@@|${run_group}|g" \
        -e "s|@@NODE_BIN@@|${NODE_BIN}|g" \
        -e "s|@@ENTRY_POINT@@|${ENTRY_POINT}|g" \
        "$unit_src")"

    printf '%s\n' "$rendered" | run_root tee "$SERVICE_FILE" >/dev/null \
        || die "Could not write ${SERVICE_FILE}."

    # Refuse to publish a unit with an unsubstituted placeholder.
    if run_root grep -q '@@' "$SERVICE_FILE" 2>/dev/null; then
        warn "The generated unit still contains placeholders — please review ${SERVICE_FILE}."
    fi

    run_root systemctl daemon-reload || die "systemctl daemon-reload failed."
    run_root systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 \
        || warn "Could not enable the service (it would not start after a reboot)."

    ok "systemd service installed and enabled."
    plain "        sudo systemctl start   ${SERVICE_NAME}"
    plain "        sudo systemctl status  ${SERVICE_NAME}"
    plain "        sudo systemctl restart ${SERVICE_NAME}"
    plain "        sudo journalctl -u ${SERVICE_NAME} -f"
}

if ! systemd_available; then
    if [ "$WANT_SERVICE" = "yes" ]; then
        warn "systemd is not available on this system — skipping the service."
    else
        info "systemd not detected — skipping the service (use a process manager or screen/tmux)."
    fi
elif [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] would offer to install ${SERVICE_FILE}"
else
    DO_SERVICE=0
    case "$WANT_SERVICE" in
        yes) DO_SERVICE=1 ;;
        no)  DO_SERVICE=0 ;;
        *)
            if ! can_become_root && [ ! -f "$SERVICE_FILE" ]; then
                warn "Root privileges are unavailable — cannot install a system service."
                info "Re-run with: sudo ./install.sh --service"
            elif confirm "Install a systemd service so the bot auto-starts on boot and restarts after a crash?" "y"; then
                DO_SERVICE=1
            fi
            ;;
    esac

    if [ "$DO_SERVICE" -eq 1 ]; then
        if [ -f "$SERVICE_FILE" ]; then
            info "An existing unit was found — it will be replaced (configuration is untouched)."
        fi
        install_service
        SERVICE_INSTALLED=1
    else
        info "No systemd service installed."
        info "Run the bot in the foreground with: npm start"
    fi
fi

# -----------------------------------------------------------------------------
#  STEP 9 — start and report
# -----------------------------------------------------------------------------
step "9/9  Finishing up"

if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] would finish here. No changes were made."
    printf '\n'; print_banner "Dry run complete — nothing was modified"; exit 0
fi

if [ "$SERVICE_INSTALLED" -eq 1 ]; then
    if [ "$NO_START" -eq 0 ] && ( [ "$ASSUME_YES" -eq 1 ] || confirm "Start the bot now?" "y" ); then
        if run_root systemctl restart "$SERVICE_NAME"; then
            sleep 3
            if run_root systemctl is-active --quiet "$SERVICE_NAME"; then
                ok "Service is RUNNING."
                printf '\n  %sRecent log output:%s\n' "$C_WHITE" "$C_RESET"
                run_root journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null | sed 's/^/    /' || true
            else
                warn "The service is not active. Check the log:"
                plain "        sudo journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
                plain "        npm run doctor"
            fi
        else
            warn "Could not start the service. Inspect: sudo journalctl -u ${SERVICE_NAME} -n 50"
        fi
    fi
elif [ "$NO_START" -eq 0 ] && [ -t 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
    if confirm "Start the bot in the foreground now? (Ctrl+C stops it)" "n"; then
        printf '\n'; print_banner "Starting TANVEER MUSIC BOT V3 — press Ctrl+C to stop"
        exec npm start
    fi
fi

# -----------------------------------------------------------------------------
#  SUCCESS REPORT
# -----------------------------------------------------------------------------
printf '\n'
print_banner "Installation completed successfully"

printf '  %s%sSUMMARY%s\n' "$C_WHITE" "$C_BOLD" "$C_RESET"
printf '  %s\n' "----------------------------------------------------------------------"
printf '  %-22s %s\n' "Project"      "${APP_DIR}"
printf '  %-22s %s\n' "Bot"          "TANVEER MUSIC BOT V3 v${BOT_VERSION}"
printf '  %-22s %s\n' "Creator"      "Tanveer  -  Discord: tanveer5637"
printf '  %-22s %s\n' "Node.js"      "$(node -v)"
printf '  %-22s %s\n' "Entry point"  "${ENTRY_POINT}"
printf '  %-22s %s\n' "Config"       ".env (mode 600, secrets hidden)"
printf '  %-22s %s\n' "Lavalink"     "$([ "$LAV_SKIP" -eq 1 ] && echo "NOT CONFIGURED — playback disabled" || echo "${LAV_HOST}:${LAV_PORT} (not live-tested)")"
printf '  %-22s %s\n' "Tests"        "$([ "$SKIP_TESTS" -eq 1 ] && echo "skipped" || echo "see step 7 above")"
printf '  %-22s %s\n' "Config check" "$([ "$DOCTOR_FAILED" -eq 1 ] && echo "PROBLEMS FOUND - see step 6 above" || echo "passed (static only)")"
printf '  %-22s %s\n' "Service"      "$([ "$SERVICE_INSTALLED" -eq 1 ] && echo "$SERVICE_NAME (enabled)" || echo "not installed")"
printf '  %-22s %s\n' "Install log"  "${LOG_FILE}"
printf '  %s\n' "----------------------------------------------------------------------"

printf '\n  %s%sNEXT STEPS%s\n' "$C_WHITE" "$C_BOLD" "$C_RESET"
printf '  %s\n' "----------------------------------------------------------------------"
if [ "$SERVICE_INSTALLED" -eq 1 ]; then
    plain "   Start / stop / restart"
    plain "     sudo systemctl start   ${SERVICE_NAME}"
    plain "     sudo systemctl stop    ${SERVICE_NAME}"
    plain "     sudo systemctl restart ${SERVICE_NAME}"
    plain "     sudo systemctl status  ${SERVICE_NAME}"
    plain ""
    plain "   Live logs        sudo journalctl -u ${SERVICE_NAME} -f"
    plain "   Last 100 lines   sudo journalctl -u ${SERVICE_NAME} -n 100 --no-pager"
else
    plain "   Start the bot    npm start"
    plain "   Keep it running  use systemd (sudo ./install.sh --service), screen, or tmux"
fi
plain ""
plain "   Verify config    npm run doctor"
plain "   Verify Lavalink  npm run doctor -- --live     <- proves a REAL connection"
plain "   Update later     git pull && ./install.sh      <- .env and data are preserved"
plain ""

if [ "$LAV_SKIP" -eq 1 ]; then
    printf '  %s%s!  LAVALINK IS NOT CONFIGURED%s\n' "$C_YELLOW" "$C_BOLD" "$C_RESET"
    plain "     The bot will start and respond to /ping and /help, but /play will not work"
    plain "     until you set LAVALINK_HOST / LAVALINK_PORT / LAVALINK_PASSWORD in .env."
    plain ""
fi

printf '  %s%si  HONEST STATUS%s\n' "$C_CYAN" "$C_BOLD" "$C_RESET"
plain "     • Configuration was validated statically — no secret was printed."
plain "     • A live Discord login and live audio playback are NOT proven by this installer."
plain "     • Prove them with:  npm run doctor -- --live   then   npm start"
plain ""
plain "  Need help? See the Troubleshooting section of README.md."
printf '\n'
