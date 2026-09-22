#!/usr/bin/env bash

# Data Agent installation-time PostgreSQL orchestration.
# Sourced by install.sh. It uses prompt/log/validation helpers from the parent script.

DB_HOST_KIND="${DB_HOST_KIND:-}"
DB_LINK_NETWORK="${DB_LINK_NETWORK:-${DATA_AGENT_DB_LINK_NETWORK:-data-agent-db-link}}"
DB_PROXY_REQUIRED="${DB_PROXY_REQUIRED:-0}"
DB_PROXY_BIND="${DB_PROXY_BIND:-}"
DB_PROXY_PORT="${DB_PROXY_PORT:-${DATA_AGENT_DB_PROXY_PORT:-15432}}"
DB_SOURCE_PORT="${DB_SOURCE_PORT:-}"
DB_CONTAINER="${DB_CONTAINER:-${DATA_AGENT_DB_CONTAINER:-}}"
DB_ADMIN_USER="${DB_ADMIN_USER:-${DATA_AGENT_DB_ADMIN_USER:-}}"
DB_ADMIN_PASSWORD="${DB_ADMIN_PASSWORD:-${DATA_AGENT_DB_ADMIN_PASSWORD:-}}"
DB_DATABASE="${DB_DATABASE:-${DATA_AGENT_DB_DATABASE:-data_agent}}"
DB_USERNAME="${DB_USERNAME:-${DATA_AGENT_DB_USERNAME:-data_agent}}"
DB_PASSWORD="${DB_PASSWORD:-${DATA_AGENT_DB_PASSWORD:-}}"
DATABASE_URL="${DATABASE_URL:-${DATA_AGENT_DATABASE_URL:-}}"

shell_quote() {
  printf '%q' "$1"
}

validate_db_ident() {
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
    die "database name/user must contain only letters, digits and underscore, and cannot start with a digit: $1"
}

list_postgres_containers() {
  docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}' |
    awk 'BEGIN{IGNORECASE=1} $2 ~ /postgres/ || $3 ~ /postgres/ {print}'
}

install_db_container_env() {
  local container="$1" key="$2"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null |
    sed -n "s/^${key}=//p" | head -n1
}

ensure_db_link_network() {
  docker network inspect "$DB_LINK_NETWORK" >/dev/null 2>&1 ||
    docker network create "$DB_LINK_NETWORK" >/dev/null
}

connect_db_container_network() {
  local container="$1"
  ensure_db_link_network
  if ! docker inspect -f '{{json .NetworkSettings.Networks}}' "$container" | grep -q "\"$DB_LINK_NETWORK\""; then
    docker network connect "$DB_LINK_NETWORK" "$container"
  fi
}

postgres_container_exec() {
  local container="$1" admin_user="$2" admin_db="$3" admin_password="$4"
  shift 4
  docker exec -i \
    -e PGPASSWORD="$admin_password" \
    -e PGADMIN_USER="$admin_user" \
    -e PGADMIN_DB="$admin_db" \
    "$container" sh -lc 'exec psql -X -v ON_ERROR_STOP=1 -U "$PGADMIN_USER" -d "$PGADMIN_DB" "$@"' sh "$@"
}

wait_postgres_container_admin() {
  local container="$1" admin_user="$2" admin_db="$3" admin_password="$4" i
  for i in $(seq 1 30); do
    if postgres_container_exec "$container" "$admin_user" "$admin_db" "$admin_password" -Atqc 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

provision_postgres_runner() {
  local runner="$1" app_user="$2" app_db="$3" app_password="$4"

  eval "$runner" -v ON_ERROR_STOP=1 \
    -v app_user="$app_user" -v app_db="$app_db" -v app_password="$app_password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'app_db', :'app_user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'app_db') \gexec
SELECT format('ALTER DATABASE %I OWNER TO %I', :'app_db', :'app_user') \gexec
SQL
}

repair_postgres_ownership_runner() {
  local runner="$1" app_user="$2"
  eval "$runner" -v ON_ERROR_STOP=1 -v app_user="$app_user" <<'SQL'
SELECT format('ALTER SCHEMA public OWNER TO %I', :'app_user') \gexec
SELECT format('ALTER TABLE %I.%I OWNER TO %I', schemaname, tablename, :'app_user')
FROM pg_tables WHERE schemaname = 'public' \gexec
SELECT format('ALTER SEQUENCE %I.%I OWNER TO %I', sequence_schema, sequence_name, :'app_user')
FROM information_schema.sequences WHERE sequence_schema = 'public' \gexec
SELECT format('ALTER VIEW %I.%I OWNER TO %I', schemaname, viewname, :'app_user')
FROM pg_views WHERE schemaname = 'public' \gexec
SELECT format('GRANT ALL ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user') \gexec
SQL
}

probe_postgres_from_docker() {
  local database_url="$1"
  shift || true
  docker run --rm "$@" -e DATABASE_URL="$database_url" postgres:17-alpine \
    sh -ec 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "SELECT 1" >/dev/null'
}

pick_proxy_port() {
  local port="$DB_PROXY_PORT" i
  valid_port "$port" || port=15432
  if command -v ss >/dev/null 2>&1; then
    for i in $(seq 0 99); do
      if ! ss -ltnH | awk '{print $4}' | grep -Eq "[:.]$((port+i))$"; then
        printf '%s' "$((port+i))"
        return
      fi
    done
    die "cannot find a free Docker-host PostgreSQL proxy port"
  fi
  printf '%s' "$port"
}

setup_host_postgres_container() {
  local -a candidates=()
  local line pick=1 container_id container_name admin_user admin_db admin_password port
  mapfile -t candidates < <(list_postgres_containers)

  if [[ -n "$DB_CONTAINER" ]]; then
    docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || die "PostgreSQL container not found: $DB_CONTAINER"
    container_id="$(docker inspect -f '{{.Id}}' "$DB_CONTAINER")"
    container_name="$(docker inspect -f '{{.Name}}' "$DB_CONTAINER")"
    container_name="${container_name#/}"
  else
    (("${#candidates[@]}" > 0)) || return 1
    if [[ "$ASSUME_YES" -eq 0 ]]; then
      cat > /dev/tty <<'EOF'

Detected PostgreSQL Docker containers:
EOF
      local i=1
      for line in "${candidates[@]}"; do
        printf '  %d) %s\n' "$i" "$line" > /dev/tty
        ((i++))
      done
      if (("${#candidates[@]}" > 1)); then
        pick="$(choose "Database container" "1" "${#candidates[@]}")"
      fi
    elif (("${#candidates[@]}" > 1)); then
      die "multiple PostgreSQL containers detected; set DATA_AGENT_DB_CONTAINER or --db-container"
    fi
    IFS=$'\t' read -r container_id container_name _ <<< "${candidates[$((pick-1))]}"
  fi

  DB_DATABASE="$(prompt "Database name" "${DB_DATABASE:-data_agent}")"
  DB_USERNAME="$(prompt "Database username" "${DB_USERNAME:-data_agent}")"
  validate_db_ident "$DB_DATABASE"
  validate_db_ident "$DB_USERNAME"
  DB_PASSWORD="${DB_PASSWORD:-$(random_hex 24)}"

  admin_user="${DB_ADMIN_USER:-$(install_db_container_env "$container_id" POSTGRES_USER)}"
  admin_db="$(install_db_container_env "$container_id" POSTGRES_DB)"
  admin_user="${admin_user:-postgres}"
  admin_db="${admin_db:-postgres}"
  admin_password="$DB_ADMIN_PASSWORD"
  if [[ -z "$admin_password" ]]; then
    admin_password="$(install_db_container_env "$container_id" POSTGRES_PASSWORD)"
  fi

  if ! wait_postgres_container_admin "$container_id" "$admin_user" "$admin_db" "$admin_password"; then
    if [[ "$ASSUME_YES" -eq 1 ]]; then
      die "cannot administer PostgreSQL container $container_name; set DATA_AGENT_DB_ADMIN_USER / DATA_AGENT_DB_ADMIN_PASSWORD if needed"
    fi
    admin_user="$(prompt "PostgreSQL admin user" "$admin_user")"
    admin_password="$(prompt_secret "PostgreSQL admin password (blank if local trust applies)" "")"
    wait_postgres_container_admin "$container_id" "$admin_user" "$admin_db" "$admin_password" ||
      die "cannot authenticate to PostgreSQL container $container_name"
  fi

  log "creating/updating Data Agent database in host container $container_name..."
  local admin_runner database_runner
  admin_runner="postgres_container_exec $(shell_quote "$container_id") $(shell_quote "$admin_user") $(shell_quote "$admin_db") $(shell_quote "$admin_password") -X"
  database_runner="postgres_container_exec $(shell_quote "$container_id") $(shell_quote "$admin_user") $(shell_quote "$DB_DATABASE") $(shell_quote "$admin_password") -X"

  provision_postgres_runner "$admin_runner" "$DB_USERNAME" "$DB_DATABASE" "$DB_PASSWORD"
  repair_postgres_ownership_runner "$database_runner" "$DB_USERNAME"

  port="$(postgres_container_exec "$container_id" "$admin_user" "$admin_db" "$admin_password" -Atqc 'SHOW port' | tail -n1 | tr -d '[:space:]')"
  valid_port "$port" || port=5432

  ensure_db_link_network
  connect_db_container_network "$container_id"

  DB_HOST_KIND="docker-container"
  DB_CONTAINER="$container_name"
  DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${container_name}:${port}/${DB_DATABASE}"
  log "host PostgreSQL container connected through Docker network $DB_LINK_NETWORK"
}

system_postgres_local_runner() {
  if [[ $(id -un) == "postgres" ]]; then
    psql "$@"
  elif [[ ${EUID:-$(id -u)} -eq 0 ]] && command -v runuser >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
    runuser -u postgres -- psql "$@"
  elif command -v sudo >/dev/null 2>&1 && id postgres >/dev/null 2>&1; then
    sudo -u postgres psql "$@"
  else
    return 127
  fi
}

setup_host_system_postgres() {
  command -v psql >/dev/null 2>&1 || return 1

  local admin_mode="local" admin_user="postgres" admin_password="" source_port database_url gateway probe_name
  if ! system_postgres_local_runner -X -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1; then
    admin_mode="password"
    admin_user="${DB_ADMIN_USER:-postgres}"
    admin_password="$DB_ADMIN_PASSWORD"
    if [[ "$ASSUME_YES" -eq 0 ]]; then
      admin_user="$(prompt "System PostgreSQL admin user" "$admin_user")"
      [[ -n "$admin_password" ]] || admin_password="$(prompt_secret "System PostgreSQL admin password" "")"
    fi
    [[ -n "$admin_password" ]] ||
      die "system PostgreSQL requires admin credentials; set DATA_AGENT_DB_ADMIN_PASSWORD"
    PGPASSWORD="$admin_password" psql -X -h 127.0.0.1 -U "$admin_user" -d postgres -Atqc 'SELECT 1' >/dev/null 2>&1 ||
      return 1
  fi

  DB_DATABASE="$(prompt "Database name" "${DB_DATABASE:-data_agent}")"
  DB_USERNAME="$(prompt "Database username" "${DB_USERNAME:-data_agent}")"
  validate_db_ident "$DB_DATABASE"
  validate_db_ident "$DB_USERNAME"
  DB_PASSWORD="${DB_PASSWORD:-$(random_hex 24)}"

  if [[ "$admin_mode" == "local" ]]; then
    provision_postgres_runner "system_postgres_local_runner -X -d postgres" "$DB_USERNAME" "$DB_DATABASE" "$DB_PASSWORD"
    repair_postgres_ownership_runner "system_postgres_local_runner -X -d '$DB_DATABASE'" "$DB_USERNAME"
    source_port="$(system_postgres_local_runner -X -d postgres -Atqc 'SHOW port' | tail -n1 | tr -d '[:space:]')"
  else
    local admin_runner database_runner
    admin_runner="PGPASSWORD=$(shell_quote "$admin_password") psql -X -h 127.0.0.1 -U $(shell_quote "$admin_user") -d postgres"
    database_runner="PGPASSWORD=$(shell_quote "$admin_password") psql -X -h 127.0.0.1 -U $(shell_quote "$admin_user") -d $(shell_quote "$DB_DATABASE")"
    provision_postgres_runner "$admin_runner" "$DB_USERNAME" "$DB_DATABASE" "$DB_PASSWORD"
    repair_postgres_ownership_runner "$database_runner" "$DB_USERNAME"
    source_port="$(PGPASSWORD="$admin_password" psql -X -h 127.0.0.1 -U "$admin_user" -d postgres -Atqc 'SHOW port' | tail -n1 | tr -d '[:space:]')"
  fi
  valid_port "$source_port" || source_port=5432
  DB_SOURCE_PORT="$source_port"

  database_url="postgresql://${DB_USERNAME}:${DB_PASSWORD}@host.docker.internal:${source_port}/${DB_DATABASE}"
  log "testing Docker -> host PostgreSQL connectivity..."
  if probe_postgres_from_docker "$database_url" --add-host host.docker.internal:host-gateway >/dev/null 2>&1; then
    DB_HOST_KIND="system-direct"
    DB_PROXY_REQUIRED=0
    DATABASE_URL="$database_url"
    log "system PostgreSQL is reachable directly through host.docker.internal"
    return 0
  fi

  gateway="$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}' 2>/dev/null || true)"
  gateway="${gateway:-172.17.0.1}"
  DB_PROXY_BIND="$gateway"
  DB_PROXY_PORT="$(pick_proxy_port)"
  probe_name="data-agent-db-proxy-probe-$$"

  warn "system PostgreSQL is not reachable directly from Docker; enabling a Docker-gateway-only proxy"
  docker run -d --rm --name "$probe_name" --network host alpine/socat:latest \
    "TCP-LISTEN:${DB_PROXY_PORT},bind=${DB_PROXY_BIND},fork,reuseaddr" \
    "TCP:127.0.0.1:${source_port}" >/dev/null
  sleep 1

  database_url="postgresql://${DB_USERNAME}:${DB_PASSWORD}@host.docker.internal:${DB_PROXY_PORT}/${DB_DATABASE}"
  if ! probe_postgres_from_docker "$database_url" --add-host host.docker.internal:host-gateway >/dev/null 2>&1; then
    docker rm -f "$probe_name" >/dev/null 2>&1 || true
    die "system PostgreSQL could not be reached through the safe Docker gateway proxy; check pg_hba.conf for local TCP password access"
  fi
  docker rm -f "$probe_name" >/dev/null 2>&1 || true

  DB_HOST_KIND="system-proxy"
  DB_PROXY_REQUIRED=1
  DATABASE_URL="$database_url"
  log "system PostgreSQL will be exposed only on Docker gateway $DB_PROXY_BIND:$DB_PROXY_PORT"
}

setup_host_database() {
  if setup_host_postgres_container; then return 0; fi
  if setup_host_system_postgres; then return 0; fi
  die "no manageable PostgreSQL found on this server. Use external mode for a remote or separately managed database."
}

configure_database() {
  if [[ -z "$DB_MODE" ]]; then
    if [[ "$ASSUME_YES" -eq 1 ]]; then
      DB_MODE="local"
    else
      cat > /dev/tty <<'EOF'

Database mode:
  1) Managed PostgreSQL 17 container
  2) PostgreSQL on this server (auto-detect system / 1Panel / Docker)
  3) External PostgreSQL

EOF
      local choice
      choice="$(choose "Database" "1" "3")"
      case "$choice" in
        1) DB_MODE="local" ;;
        2) DB_MODE="host" ;;
        3) DB_MODE="external" ;;
      esac
    fi
  fi

  case "$DB_MODE" in
    local)
      validate_db_ident "$DB_DATABASE"
      validate_db_ident "$DB_USERNAME"
      DB_PASSWORD="${DB_PASSWORD:-$(random_hex 24)}"
      DB_HOST_KIND="managed"
      DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@postgres:5432/${DB_DATABASE}"
      ;;
    host)
      setup_host_database
      ;;
    external)
      if [[ -z "$DATABASE_URL" ]]; then
        DATABASE_URL="$(prompt_secret "PostgreSQL DATABASE_URL")"
      fi
      [[ "$DATABASE_URL" == postgres://* || "$DATABASE_URL" == postgresql://* ]] ||
        die "DATABASE_URL must start with postgres:// or postgresql://"
      DB_HOST_KIND="external"
      ;;
    *)
      die "invalid database mode: $DB_MODE (use local, host, or external)"
      ;;
  esac
}

prepare_database_compose_blocks() {
  DATABASE_SERVICE_BLOCK=""
  DB_PROXY_SERVICE_BLOCK=""
  APP_DB_DEPENDS_BLOCK=""
  DB_EXTRA_HOSTS_BLOCK=""
  DB_NETWORKS_BLOCK=""
  DB_NETWORK_DECL_BLOCK=""
  DATABASE_VOLUME_BLOCK=""

  if [[ "$DB_MODE" == "local" ]]; then
    DATABASE_SERVICE_BLOCK="$(cat <<'YAML'
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DATA_AGENT_DB_DATABASE:-data_agent}
      POSTGRES_USER: ${DATA_AGENT_DB_USERNAME:-data_agent}
      POSTGRES_PASSWORD: ${DATA_AGENT_DB_PASSWORD:?missing DATA_AGENT_DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DATA_AGENT_DB_USERNAME:-data_agent} -d ${DATA_AGENT_DB_DATABASE:-data_agent}"]
      interval: 5s
      timeout: 5s
      retries: 20
YAML
)"
    APP_DB_DEPENDS_BLOCK="$(cat <<'YAML'
    depends_on:
      postgres:
        condition: service_healthy
YAML
)"
    DATABASE_VOLUME_BLOCK="$(cat <<'YAML'
volumes:
  postgres-data:
YAML
)"
  elif [[ "$DB_MODE" == "host" && "$DB_HOST_KIND" == "docker-container" ]]; then
    DB_NETWORKS_BLOCK="$(cat <<'YAML'
    networks:
      - default
      - db_link
YAML
)"
    DB_NETWORK_DECL_BLOCK="$(cat <<YAML
networks:
  db_link:
    external: true
    name: $DB_LINK_NETWORK
YAML
)"
  elif [[ "$DB_MODE" == "host" && "$DB_PROXY_REQUIRED" -eq 1 ]]; then
    DB_EXTRA_HOSTS_BLOCK="$(cat <<'YAML'
    extra_hosts:
      - "host.docker.internal:host-gateway"
YAML
)"
    DB_PROXY_SERVICE_BLOCK="$(cat <<'YAML'
  db-proxy:
    image: alpine/socat:latest
    restart: unless-stopped
    network_mode: host
    command:
      - "TCP-LISTEN:${DATA_AGENT_DB_PROXY_PORT:?missing DATA_AGENT_DB_PROXY_PORT},bind=${DATA_AGENT_DB_PROXY_BIND:?missing DATA_AGENT_DB_PROXY_BIND},fork,reuseaddr"
      - "TCP:127.0.0.1:${DATA_AGENT_DB_SOURCE_PORT:?missing DATA_AGENT_DB_SOURCE_PORT}"
YAML
)"
    APP_DB_DEPENDS_BLOCK="$(cat <<'YAML'
    depends_on:
      db-proxy:
        condition: service_started
YAML
)"
  elif [[ "$DB_MODE" != "local" ]]; then
    DB_EXTRA_HOSTS_BLOCK="$(cat <<'YAML'
    extra_hosts:
      - "host.docker.internal:host-gateway"
YAML
)"
  fi
}

verify_database_connectivity() {
  if [[ "$DB_MODE" == "local" ]]; then
    log "starting managed PostgreSQL..."
    docker compose up -d --wait postgres
    return
  fi

  if [[ "$DB_MODE" == "host" && "$DB_PROXY_REQUIRED" -eq 1 ]]; then
    log "starting safe host-PostgreSQL Docker gateway proxy..."
    docker compose up -d db-proxy
  fi

  local -a args=()
  if [[ "$DB_MODE" == "host" && "$DB_HOST_KIND" == "docker-container" ]]; then
    args+=(--network "$DB_LINK_NETWORK")
  else
    args+=(--add-host host.docker.internal:host-gateway)
  fi

  log "checking $DB_MODE PostgreSQL connectivity from Docker..."
  probe_postgres_from_docker "$DATABASE_URL" "${args[@]}" >/dev/null ||
    die "cannot connect to $DB_MODE PostgreSQL from Docker. Check database address, credentials, Docker networking and PostgreSQL access rules."
}
