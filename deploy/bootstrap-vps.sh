#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root on the VPS" >&2
  exit 1
fi

for name in MIRACLE_CRM_DOMAIN MIRACLE_API_DOMAIN; do
  value=${!name:-}
  if [[ ! ${value} =~ ^[A-Za-z0-9.-]+$ ]]; then
    echo "$name must be a DNS hostname" >&2
    exit 1
  fi
done

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
env_file=${project_root}/.env
admin_password_file=${project_root}/.admin-initial-password
if [[ -e ${env_file} || -e ${admin_password_file} ]]; then
  echo "Production secrets already exist; refusing to replace them" >&2
  exit 1
fi

umask 077
postgres_password=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)
one_c_sync_key=$(openssl rand -hex 32)
admin_password=$(openssl rand -hex 20)

printf 'POSTGRES_USER=miraclecrm\nPOSTGRES_DB=miraclechem\nPOSTGRES_PASSWORD=%s\nAUTH_SESSION_SECRET=%s\nONE_C_SYNC_API_KEY=%s\nCRM_DOMAIN=%s\nAPI_DOMAIN=%s\nWEB_ORIGIN=https://%s\nWEB_PORT=8080\nRATE_LIMIT_MAX=600\n' \
  "$postgres_password" "$session_secret" "$one_c_sync_key" \
  "$MIRACLE_CRM_DOMAIN" "$MIRACLE_API_DOMAIN" "$MIRACLE_CRM_DOMAIN" > "$env_file"
printf '%s\n' "$admin_password" > "$admin_password_file"
chmod 600 "$env_file" "$admin_password_file"
echo "Private production configuration created at $env_file"
