#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE="${DATA_AGENT_IMAGE:-ghcr.io/paimoncai/data-agent:latest}"
INSTALL_DIR="${DATA_AGENT_INSTALL_DIR:-/opt/data-agent}"
APP_PORT="${DATA_AGENT_APP_PORT:-3000}"
APP_BIND="${DATA_AGENT_APP_BIND:-}"
APP_ORIGIN="${DATA_AGENT_APP_ORIGIN:-}"
ACCESS_MODE="${DATA_AGENT_ACCESS_MODE:-}"
ADMIN_EMAIL="${DATA_AGENT_ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${DATA_AGENT_ADMIN_PASSWORD:-}"
SESSION_SECRET="${DATA_AGENT_SESSION_SECRET:-}"
SYSTEM_CONFIG_ENCRYPTION_KEY="${DATA_AGENT_SYSTEM_CONFIG_ENCRYPTION_KEY:-}"
LLM_BASE_URL="${DATA_AGENT_LLM_BASE_URL:-}"
LLM_API_KEY="${DATA_AGENT_LLM_API_KEY:-}"
LLM_MODELS="${DATA_AGENT_LLM_MODELS:-}"
DB_MODE="${DATA_AGENT_DB_MODE:-}"
DATABASE_URL="${DATA_AGENT_DATABASE_URL:-}"
DB_CONTAINER="${DATA_AGENT_DB_CONTAINER:-}"
DB_DATABASE="${DATA_AGENT_DB_DATABASE:-data_agent}"
DB_USERNAME="${DATA_AGENT_DB_USERNAME:-data_agent}"
DB_PASSWORD="${DATA_AGENT_DB_PASSWORD:-}"
DB_ADMIN_USER="${DATA_AGENT_DB_ADMIN_USER:-}"
DB_ADMIN_PASSWORD="${DATA_AGENT_DB_ADMIN_PASSWORD:-}"
DB_LINK_NETWORK="${DATA_AGENT_DB_LINK_NETWORK:-data-agent-db-link}"
DB_PROXY_PORT="${DATA_AGENT_DB_PROXY_PORT:-15432}"
DEPLOY_RAW_BASE="${DATA_AGENT_DEPLOY_RAW_BASE:-https://raw.githubusercontent.com/PaiMonCai/data-agent/main}"
ASSUME_YES=0
RENDER_ONLY=0
RESET_LOCAL_DB=0
AUTO_INSTALL_DOCKER="${DATA_AGENT_AUTO_INSTALL_DOCKER:-false}"
GENERATED_ADMIN_PASSWORD=""
COMPOSE_PROJECT_NAME="data-agent"
LOCAL_DB_VOLUME="${COMPOSE_PROJECT_NAME}_postgres-data"

log()  { printf '\033[1;34m[Data Agent]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[Data Agent]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[Data Agent]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[Data Agent]\033[0m %s\n' "$*" >&2; exit 1; }

on_error() {
  local code=$?
  printf '\n' >&2
  warn "installation failed near line ${BASH_LINENO[0]:-?} (exit $code)"
  if [[ -n "${INSTALL_DIR:-}" && -f "$INSTALL_DIR/compose.yaml" ]]; then
    warn "inspect with: cd $INSTALL_DIR && docker compose logs --tail=200 app"
  fi
  exit "$code"
}
trap on_error ERR

usage() {
  cat <<'EOF'
Data Agent one-click interactive installer

Usage:
  install.sh [options]

Options:
  --dir PATH             Installation directory (default: /opt/data-agent)
  --image IMAGE          Data Agent image
  --port PORT            Host application port
  --origin URL           Public origin, e.g. https://data.example.com
  --email EMAIL          Bootstrap administrator email
  --db-mode MODE         local | host | external
  --db-url URL           External PostgreSQL DATABASE_URL
  --db-container NAME    Host PostgreSQL Docker container
  --yes                  Unattended mode
  --reset-local-db       Delete stale managed PostgreSQL volume (DESTRUCTIVE)
  --render-only          Render and validate Compose without starting app
  -h, --help             Show help

Environment:
  DATA_AGENT_IMAGE
  DATA_AGENT_INSTALL_DIR
  DATA_AGENT_APP_PORT
  DATA_AGENT_APP_BIND
  DATA_AGENT_APP_ORIGIN
  DATA_AGENT_ACCESS_MODE
  DATA_AGENT_ADMIN_EMAIL
  DATA_AGENT_ADMIN_PASSWORD
  DATA_AGENT_SESSION_SECRET
  DATA_AGENT_SYSTEM_CONFIG_ENCRYPTION_KEY
  DATA_AGENT_LLM_BASE_URL
  DATA_AGENT_LLM_API_KEY
  DATA_AGENT_LLM_MODELS
  DATA_AGENT_DB_MODE
  DATA_AGENT_DATABASE_URL
  DATA_AGENT_DB_DATABASE
  DATA_AGENT_DB_USERNAME
  DATA_AGENT_DB_PASSWORD
  DATA_AGENT_DB_CONTAINER
  DATA_AGENT_DB_ADMIN_USER
  DATA_AGENT_DB_ADMIN_PASSWORD
  DATA_AGENT_DB_LINK_NETWORK
  DATA_AGENT_DB_PROXY_PORT
  DATA_AGENT_AUTO_INSTALL_DOCKER
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) INSTALL_DIR="${2:?missing value for --dir}"; shift 2 ;;
    --image) IMAGE="${2:?missing value for --image}"; shift 2 ;;
    --port) APP_PORT="${2:?missing value for --port}"; shift 2 ;;
    --origin) APP_ORIGIN="${2:?missing value for --origin}"; shift 2 ;;
    --email) ADMIN_EMAIL="${2:?missing value for --email}"; shift 2 ;;
    --db-mode) DB_MODE="${2:?missing value for --db-mode}"; shift 2 ;;
    --db-url) DATABASE_URL="${2:?missing value for --db-url}"; shift 2 ;;
    --db-container) DB_CONTAINER="${2:?missing value for --db-container}"; shift 2 ;;
    --yes) ASSUME_YES=1; shift ;;
    --reset-local-db) RESET_LOCAL_DB=1; shift ;;
    --render-only) RENDER_ONLY=1; ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

prompt() {
  local label="$1" default="${2-}" value=""
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    printf '%s' "$default"
    return
  fi
  if [[ -n "$default" ]]; then
    printf '%s [%s]: ' "$label" "$default" > /dev/tty
  else
    printf '%s: ' "$label" > /dev/tty
  fi
  IFS= read -r value < /dev/tty || true
  printf '%s' "${value:-$default}"
}

prompt_secret() {
  local label="$1" default="${2-}" value=""
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    printf '%s' "$default"
    return
  fi
  printf '%s: ' "$label" > /dev/tty
  IFS= read -r -s value < /dev/tty || true
  printf '\n' > /dev/tty
  printf '%s' "${value:-$default}"
}

choose() {
  local label="$1" default="$2" max="$3" value
  while true; do
    value="$(prompt "$label" "$default")"
    [[ "$value" =~ ^[0-9]+$ ]] && ((value >= 1 && value <= max)) && {
      printf '%s' "$value"
      return
    }
    warn "choose a number from 1 to $max"
  done
}

confirm() {
  local label="$1" default="${2:-Y}" value=""
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    [[ "$default" =~ ^[Yy]$ ]]
    return
  fi
  value="$(prompt "$label" "$default")"
  [[ "$value" =~ ^[Yy]([Ee][Ss])?$ ]]
}

valid_email() {
  [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

valid_origin() {
  [[ "$1" =~ ^https?://[^[:space:]/]+(:[0-9]+)?$ ]]
}

random_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

detect_host() {
  local host=""
  if command -v ip >/dev/null 2>&1; then
    host="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  fi
  [[ -n "$host" ]] || host="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  printf '%s' "${host:-127.0.0.1}"
}

dotenv_quote() {
  local value="$1"
  [[ "$value" != *"'"* && "$value" != *$'\n'* && "$value" != *$'\r'* ]] ||
    die "configuration values cannot contain single quotes or newlines"
  printf "'%s'" "$value"
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    [[ "$RENDER_ONLY" -eq 1 ]] || docker info >/dev/null 2>&1 || die "Docker daemon is not reachable"
    return
  fi

  local auto="${AUTO_INSTALL_DOCKER,,}"
  if [[ "$ASSUME_YES" -eq 0 ]]; then
    confirm "Docker + Compose v2 not found. Install Docker automatically?" "Y" ||
      die "Docker Engine + Compose v2 are required"
  elif [[ "$auto" != "1" && "$auto" != "true" && "$auto" != "yes" && "$auto" != "y" ]]; then
    die "Docker + Compose v2 are required. Set DATA_AGENT_AUTO_INSTALL_DOCKER=true for unattended automatic installation."
  fi

  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "automatic Docker installation requires root"
  local tmp="/tmp/data-agent-get-docker.sh"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" https://get.docker.com
  else
    die "curl or wget is required to install Docker"
  fi
  sh "$tmp"
  rm -f "$tmp"
  command -v systemctl >/dev/null 2>&1 && systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker installed but Compose v2 is unavailable"
}

load_database_module() {
  local script_dir tmp
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
  if [[ -n "$script_dir" && -f "$script_dir/deploy/install-database.sh" ]]; then
    # shellcheck source=/dev/null
    source "$script_dir/deploy/install-database.sh"
    return
  fi

  tmp="$(mktemp)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$DEPLOY_RAW_BASE/deploy/install-database.sh" -o "$tmp" ||
      { rm -f "$tmp"; die "failed to download database installer module"; }
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$DEPLOY_RAW_BASE/deploy/install-database.sh" ||
      { rm -f "$tmp"; die "failed to download database installer module"; }
  else
    rm -f "$tmp"
    die "curl or wget is required"
  fi
  # shellcheck source=/dev/null
  source "$tmp"
  rm -f "$tmp"
}

configure_access() {
  if [[ -z "$ACCESS_MODE" ]]; then
    if [[ "$ASSUME_YES" -eq 1 ]]; then
      ACCESS_MODE="http"
    else
      cat > /dev/tty <<'EOF'

Access mode:
  1) Domain / HTTPS behind Nginx, 1Panel, Caddy or Cloudflare
  2) Direct HTTP by server IP

EOF
      case "$(choose "Access" "1" "2")" in
        1) ACCESS_MODE="external-https" ;;
        2) ACCESS_MODE="http" ;;
      esac
    fi
  fi

  valid_port "$APP_PORT" || die "invalid application port: $APP_PORT"

  case "$ACCESS_MODE" in
    external-https)
      if [[ -z "$APP_ORIGIN" ]]; then
        local domain
        domain="$(prompt "Public domain or origin" "https://data.example.com")"
        [[ "$domain" != *"example.com"* ]] || die "enter your real domain"
        [[ "$domain" == http://* || "$domain" == https://* ]] || domain="https://$domain"
        APP_ORIGIN="${domain%/}"
      fi
      valid_origin "$APP_ORIGIN" || die "invalid APP_ORIGIN: $APP_ORIGIN"
      APP_BIND="${APP_BIND:-127.0.0.1}"
      COOKIE_SECURE=true
      ;;
    http)
      APP_BIND="${APP_BIND:-0.0.0.0}"
      if [[ -z "$APP_ORIGIN" ]]; then
        local host
        host="$(detect_host)"
        if [[ "$APP_PORT" == "80" ]]; then
          APP_ORIGIN="http://$host"
        else
          APP_ORIGIN="http://$host:$APP_PORT"
        fi
        APP_ORIGIN="$(prompt "APP_ORIGIN (browser address)" "$APP_ORIGIN")"
      fi
      valid_origin "$APP_ORIGIN" || die "invalid APP_ORIGIN: $APP_ORIGIN"
      COOKIE_SECURE=false
      ;;
    *)
      die "invalid access mode: $ACCESS_MODE"
      ;;
  esac
}

configure_admin() {
  if [[ "$ASSUME_YES" -eq 1 && -z "$ADMIN_EMAIL" ]]; then
    die "--yes requires --email or DATA_AGENT_ADMIN_EMAIL"
  fi

  ADMIN_EMAIL="$(prompt "Administrator email" "${ADMIN_EMAIL:-admin@example.com}")"
  valid_email "$ADMIN_EMAIL" && [[ "$ADMIN_EMAIL" != "admin@example.com" ]] ||
    die "enter a valid administrator email"

  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(prompt_secret "Administrator password (blank = auto-generate)" "")"
  fi
  if [[ -z "$ADMIN_PASSWORD" ]]; then
    ADMIN_PASSWORD="$(random_hex 12)"
    GENERATED_ADMIN_PASSWORD="$ADMIN_PASSWORD"
  fi
  (("${#ADMIN_PASSWORD}" >= 8)) || die "administrator password must be at least 8 characters"

  SESSION_SECRET="${SESSION_SECRET:-$(random_hex 32)}"
  if [[ -z "$SYSTEM_CONFIG_ENCRYPTION_KEY" && "$ASSUME_YES" -eq 0 ]]; then
    SYSTEM_CONFIG_ENCRYPTION_KEY="$(prompt_secret "System config encryption key (blank = auto-generate; reuse the old key when reconnecting an existing Data Agent database)" "")"
  fi
  SYSTEM_CONFIG_ENCRYPTION_KEY="${SYSTEM_CONFIG_ENCRYPTION_KEY:-$(random_hex 32)}"
}

configure_llm() {
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    return
  fi
  if confirm "Configure a default OpenAI-compatible LLM now? (can also be done in /admin later)" "N"; then
    LLM_BASE_URL="$(prompt "LLM Base URL" "${LLM_BASE_URL:-https://api.openai.com/v1}")"
    LLM_API_KEY="$(prompt_secret "LLM API Key" "$LLM_API_KEY")"
    LLM_MODELS="$(prompt "Models (comma-separated, optional)" "$LLM_MODELS")"
  fi
}

clear_bootstrap_password() {
  local file="$INSTALL_DIR/.env" tmp
  [[ -f "$file" ]] || return 0
  tmp="$(mktemp)"
  awk '
    /^BOOTSTRAP_ADMIN_PASSWORD=/ { print "BOOTSTRAP_ADMIN_PASSWORD="; next }
    { print }
  ' "$file" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
}

write_deployment() {
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"
  umask 077

  local database_url_env admin_password_env session_secret_env encryption_key_env llm_key_env
  database_url_env="$(dotenv_quote "$DATABASE_URL")"
  admin_password_env="$(dotenv_quote "$ADMIN_PASSWORD")"
  session_secret_env="$(dotenv_quote "$SESSION_SECRET")"
  encryption_key_env="$(dotenv_quote "$SYSTEM_CONFIG_ENCRYPTION_KEY")"
  llm_key_env="$(dotenv_quote "$LLM_API_KEY")"

  cat > .env <<EOF
DATA_AGENT_IMAGE=$IMAGE
DATA_AGENT_ACCESS_MODE=$ACCESS_MODE
APP_BIND=$APP_BIND
APP_PORT=$APP_PORT
APP_ORIGIN=$APP_ORIGIN
COOKIE_SECURE=$COOKIE_SECURE
COOKIE_SAME_SITE=Lax

DATABASE_URL=$database_url_env
DATA_AGENT_DB_MODE=$DB_MODE
DATA_AGENT_DB_HOST_KIND=$DB_HOST_KIND
DATA_AGENT_DB_DATABASE=$DB_DATABASE
DATA_AGENT_DB_USERNAME=$DB_USERNAME
DATA_AGENT_DB_PASSWORD=$DB_PASSWORD
DATA_AGENT_DB_CONTAINER=$DB_CONTAINER
DATA_AGENT_DB_LINK_NETWORK=$DB_LINK_NETWORK
DATA_AGENT_DB_PROXY_REQUIRED=$DB_PROXY_REQUIRED
DATA_AGENT_DB_PROXY_BIND=$DB_PROXY_BIND
DATA_AGENT_DB_PROXY_PORT=$DB_PROXY_PORT
DATA_AGENT_DB_SOURCE_PORT=$DB_SOURCE_PORT

SESSION_SECRET=$session_secret_env
SYSTEM_CONFIG_ENCRYPTION_KEY=$encryption_key_env
SESSION_DAYS=30
BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD=$admin_password_env

LLM_BASE_URL=$LLM_BASE_URL
LLM_API_KEY=$llm_key_env
LLM_MODELS=$LLM_MODELS
LLM_REQUESTS_PER_MINUTE=10
LLM_REQUESTS_PER_DAY=300
LLM_MAX_INPUT_CHARS=200000
LLM_TIMEOUT_MS=180000

MAIL_MODE=console
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM='Data Agent <no-reply@example.com>'
EOF

  chmod 600 .env

  prepare_database_compose_blocks

  cat > compose.yaml <<EOF
name: $COMPOSE_PROJECT_NAME

services:
$DATABASE_SERVICE_BLOCK
$DB_PROXY_SERVICE_BLOCK
  app:
    image: \${DATA_AGENT_IMAGE:-ghcr.io/paimoncai/data-agent:latest}
    pull_policy: always
    restart: unless-stopped
$APP_DB_DEPENDS_BLOCK
$DB_EXTRA_HOSTS_BLOCK
$DB_NETWORKS_BLOCK
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: \${DATABASE_URL:?missing DATABASE_URL}
      SESSION_SECRET: \${SESSION_SECRET:?missing SESSION_SECRET}
      SYSTEM_CONFIG_ENCRYPTION_KEY: \${SYSTEM_CONFIG_ENCRYPTION_KEY:?missing SYSTEM_CONFIG_ENCRYPTION_KEY}
      BOOTSTRAP_ADMIN_EMAIL: \${BOOTSTRAP_ADMIN_EMAIL:-}
      BOOTSTRAP_ADMIN_PASSWORD: \${BOOTSTRAP_ADMIN_PASSWORD:-}
      SESSION_DAYS: \${SESSION_DAYS:-30}
      COOKIE_SECURE: \${COOKIE_SECURE:-false}
      COOKIE_SAME_SITE: \${COOKIE_SAME_SITE:-Lax}
      APP_ORIGIN: \${APP_ORIGIN:-}
      LLM_BASE_URL: \${LLM_BASE_URL:-}
      LLM_API_KEY: \${LLM_API_KEY:-}
      LLM_MODELS: \${LLM_MODELS:-}
      LLM_REQUESTS_PER_MINUTE: \${LLM_REQUESTS_PER_MINUTE:-10}
      LLM_REQUESTS_PER_DAY: \${LLM_REQUESTS_PER_DAY:-300}
      LLM_MAX_INPUT_CHARS: \${LLM_MAX_INPUT_CHARS:-200000}
      LLM_TIMEOUT_MS: \${LLM_TIMEOUT_MS:-180000}
      MAIL_MODE: \${MAIL_MODE:-console}
      SMTP_HOST: \${SMTP_HOST:-}
      SMTP_PORT: \${SMTP_PORT:-587}
      SMTP_SECURE: \${SMTP_SECURE:-false}
      SMTP_USER: \${SMTP_USER:-}
      SMTP_PASS: \${SMTP_PASS:-}
      SMTP_FROM: \${SMTP_FROM:-Data Agent <no-reply@example.com>}
    ports:
      - "\${APP_BIND:-0.0.0.0}:\${APP_PORT:-3000}:3000"
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:3000/api/health').then(async r=>{const j=await r.json();if(!r.ok||j.ok!==true)process.exit(1)}).catch(()=>process.exit(1))"
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 30s

$DATABASE_VOLUME_BLOCK
$DB_NETWORK_DECL_BLOCK
EOF

  chmod 644 compose.yaml
  docker compose config >/dev/null
}

wait_for_health() {
  local url="http://127.0.0.1:$APP_PORT/api/health" i
  log "waiting for application health check..."
  for i in $(seq 1 60); do
    if curl -fsS --max-time 3 "$url" 2>/dev/null | grep -q '"ok":true'; then
      ok "health check passed"
      return 0
    fi
    sleep 2
  done
  warn "health check did not pass"
  docker compose ps >&2 || true
  docker compose logs --tail=120 app >&2 || true
  return 1
}

print_summary() {
  printf '\n'
  printf '\033[1;32m============================================================\033[0m\n'
  printf '\033[1;32m Data Agent installation completed\033[0m\n'
  printf '\033[1;32m============================================================\033[0m\n'
  printf 'Install dir:  %s\n' "$INSTALL_DIR"
  printf 'Public URL:   %s\n' "$APP_ORIGIN"
  printf 'Admin email:  %s\n' "$ADMIN_EMAIL"
  if [[ -n "$GENERATED_ADMIN_PASSWORD" ]]; then
    printf 'Admin password: %s  (shown once; save it now)\n' "$GENERATED_ADMIN_PASSWORD"
  else
    printf 'Admin password: the password you entered\n'
  fi
  printf 'Database:     %s (%s)\n' "$DB_MODE" "$DB_HOST_KIND"
  printf '\nManagement:\n'
  printf '  cd %q\n' "$INSTALL_DIR"
  printf '  docker compose ps\n'
  printf '  docker compose logs -f app\n'
  printf '  docker compose pull && docker compose up -d\n'
  printf '  docker compose restart app\n'
  printf '\n'
  warn "If the selected database already contained an administrator, bootstrap credentials do not reset that existing account."
}

main() {
  [[ -r /dev/tty || "$ASSUME_YES" -eq 1 ]] ||
    die "interactive installation requires a TTY"

  clear 2>/dev/null || true
  cat <<'BANNER'
============================================================
 Data Agent · One-click interactive installer
============================================================
BANNER

  ensure_docker
  load_database_module

  INSTALL_DIR="$(prompt "Installation directory" "$INSTALL_DIR")"
  [[ -n "$INSTALL_DIR" && "$INSTALL_DIR" == /* ]] || die "installation directory must be absolute"

  if [[ -e "$INSTALL_DIR/compose.yaml" || -e "$INSTALL_DIR/.env" ]]; then
    die "an existing Data Agent deployment was found in $INSTALL_DIR; update it with docker compose pull/up instead of reinstalling"
  fi

  IMAGE="$(prompt "Data Agent image" "$IMAGE")"
  APP_PORT="$(prompt "Application port" "$APP_PORT")"

  configure_access
  configure_admin
  configure_llm
  configure_database

  if [[ "$DB_MODE" == "local" && "$RENDER_ONLY" -eq 0 ]] && docker volume inspect "$LOCAL_DB_VOLUME" >/dev/null 2>&1; then
    if [[ "$RESET_LOCAL_DB" -eq 1 ]]; then
      warn "deleting stale managed PostgreSQL volume: $LOCAL_DB_VOLUME"
      docker volume rm "$LOCAL_DB_VOLUME" >/dev/null ||
        die "cannot remove $LOCAL_DB_VOLUME; it may still be attached"
    elif [[ "$ASSUME_YES" -eq 1 ]]; then
      die "existing managed PostgreSQL volume $LOCAL_DB_VOLUME detected. Preserve it with the original credentials or rerun a disposable install with --reset-local-db."
    elif confirm "Existing managed PostgreSQL volume found. Delete it for a completely fresh install? ALL DATABASE DATA WILL BE LOST." "N"; then
      docker volume rm "$LOCAL_DB_VOLUME" >/dev/null ||
        die "cannot remove $LOCAL_DB_VOLUME; it may still be attached"
    else
      die "installation stopped to preserve existing PostgreSQL data"
    fi
  fi

  if [[ "$ASSUME_YES" -eq 0 ]]; then
    cat > /dev/tty <<EOF

------------------------------------------------------------
Data Agent deployment summary

Image:       $IMAGE
Public URL:  $APP_ORIGIN
Bind:        $APP_BIND:$APP_PORT
Admin:       $ADMIN_EMAIL
Install dir: $INSTALL_DIR
Database:    $DB_MODE ($DB_HOST_KIND)
------------------------------------------------------------

EOF
    confirm "Continue installation?" "Y" || { log "cancelled"; exit 0; }
  fi

  write_deployment

  if [[ "$RENDER_ONLY" -eq 1 ]]; then
    log "deployment rendered and validated in $INSTALL_DIR"
    exit 0
  fi

  cd "$INSTALL_DIR"
  log "pulling deployment images..."
  docker compose pull

  verify_database_connectivity

  log "starting Data Agent..."
  docker compose up -d --remove-orphans

  if wait_for_health; then
    clear_bootstrap_password
    log "removing bootstrap administrator password from the running container..."
    docker compose up -d --force-recreate app >/dev/null
    wait_for_health || die "Data Agent failed health validation after removing bootstrap credentials"
  else
    die "Data Agent started but failed health validation"
  fi

  print_summary
}

main "$@"
