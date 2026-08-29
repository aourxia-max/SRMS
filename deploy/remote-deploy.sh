#!/usr/bin/env bash
set -euo pipefail

backup_database() {
  local deploy_dir="$1"
  local expected_sha="$2"
  local backup_dir="$deploy_dir/deploy/manual-backups"
  local backup_stamp
  local backup_file
  local backup_sha

  backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="$backup_dir/pre-deploy-${backup_stamp}-${expected_sha:0:12}.sql"
  mkdir -p "$backup_dir"
  "${compose[@]}" exec -T mysql sh -lc \
    'exec mysqldump --single-transaction --quick --routines --triggers --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
    < /dev/null > "$backup_file"
  test -s "$backup_file"
  grep -q '^-- MySQL dump' "$backup_file"
  grep -q '^-- Dump completed on' "$backup_file"
  backup_sha="$(sha256sum "$backup_file" | awk '{print $1}')"
  printf '生产数据库备份完成：%s\n' "$(basename "$backup_file")" >&2
  printf '生产数据库备份 SHA-256：%s\n' "$backup_sha" >&2
}

main() {
  local deploy_dir="$1"
  local expected_sha="$2"
  local remote_bundle="$3"
  local unsafe_changes
  local fetched_sha
  local mysql_id
  local api_id
  local web_id
  local caddy_id
  local mysql_health
  local api_health
  local web_status
  local caddy_status
  local container_index
  local public_index

  cd "$deploy_dir"
  unsafe_changes="$(git status --porcelain --untracked-files=all | grep -v '^?? deploy/manual-backups/' || true)"
  if [ -n "$unsafe_changes" ]; then
    echo '服务器工作区存在未提交修改，停止自动部署以保护现有内容。' >&2
    printf '%s\n' "$unsafe_changes" >&2
    exit 1
  fi

  test -s "$remote_bundle"
  git bundle verify "$remote_bundle" >&2
  git fetch "$remote_bundle" refs/heads/deploy-bundle >&2
  fetched_sha="$(git rev-parse FETCH_HEAD)"
  if [ "$fetched_sha" != "$expected_sha" ]; then
    echo '部署包版本与本次已验证版本不一致，停止部署。' >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor HEAD "$fetched_sha"; then
    echo '服务器版本无法安全快进到本次部署版本，停止部署。' >&2
    exit 1
  fi

  compose=(docker compose -p srms_prod --env-file deploy/.env \
    -f deploy/docker-compose.yml \
    -f deploy/docker-compose.production.yml)
  backup_database "$deploy_dir" "$expected_sha"

  git merge --ff-only "$fetched_sha" >&2
  if [ "$(git rev-parse HEAD)" != "$expected_sha" ]; then
    echo '服务器代码版本校验失败，停止部署。' >&2
    exit 1
  fi
  printf '服务器代码版本：%s\n' "$expected_sha" >&2

  "${compose[@]}" up -d --build --force-recreate api web caddy >&2
  for attempt in $(seq 1 30); do
    mysql_id="$("${compose[@]}" ps -q mysql)"
    api_id="$("${compose[@]}" ps -q api)"
    web_id="$("${compose[@]}" ps -q web)"
    caddy_id="$("${compose[@]}" ps -q caddy)"
    mysql_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$mysql_id" 2>/dev/null || true)"
    api_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$api_id" 2>/dev/null || true)"
    web_status="$(docker inspect -f '{{.State.Status}}' "$web_id" 2>/dev/null || true)"
    caddy_status="$(docker inspect -f '{{.State.Status}}' "$caddy_id" 2>/dev/null || true)"
    if [ "$mysql_health" = 'healthy' ] && [ "$api_health" = 'healthy' ] \
      && [ "$web_status" = 'running' ] && [ "$caddy_status" = 'running' ]; then
      break
    fi
    if [ "$attempt" -eq 30 ]; then
      echo '容器未在规定时间内全部进入可用状态。' >&2
      "${compose[@]}" ps >&2
      exit 1
    fi
    sleep 5
  done

  container_index="$(docker exec "$web_id" cat /usr/share/nginx/html/index.html)"
  public_index="$(curl -ksS --retry 12 --retry-delay 2 --retry-all-errors \
    --resolve www.hetfw.cn:443:127.0.0.1 https://www.hetfw.cn/)"
  if [ "$container_index" != "$public_index" ]; then
    echo 'Caddy 对外提供的页面与新 Web 容器不一致，停止部署验证。' >&2
    exit 1
  fi
  printf '正式 Web 静态资源：%s\n' "$(printf '%s' "$container_index" | sed -n 's/.*src="\([^"]*\.js\)".*/\1/p')" >&2
  "${compose[@]}" ps >&2
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
