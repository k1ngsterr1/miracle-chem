#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
env_file=${MIRACLE_ENV_FILE:-${project_root}/.env}
if [[ ! -f ${env_file} || -L ${env_file} ]]; then
  echo "Existing regular .env file is required" >&2
  exit 1
fi

bindings=(ONE_C_SYNC_WORKSPACE_ID ONE_C_SYNC_SOURCE_INSTANCE_ID ONE_C_SYNC_ORGANIZATION_ID)
missing=()
for name in "${bindings[@]}"; do
  approved=${!name:-}
  if [[ ! ${approved} =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; then
    echo "$name must be an approved 1C binding GUID" >&2
    exit 1
  fi
  existing=$(sed -n "s/^${name}=//p" "${env_file}")
  if [[ -z ${existing} ]]; then
    if grep -q "^${name}=" "${env_file}"; then
      echo "$name is present but empty; correct it manually" >&2
      exit 1
    fi
    missing+=("$name")
  else
    existing=${existing#\"}
    existing=${existing%\"}
    if [[ ${existing} != "${approved}" ]]; then
      echo "$name differs from the approved binding; refusing to change it" >&2
      exit 1
    fi
  fi
done

if grep -q '^ONE_C_ARCHIVE_ENCRYPTION_KEY=' "${env_file}"; then
  if grep -q '^ONE_C_ARCHIVE_ENCRYPTION_KEY=$' "${env_file}"; then
    echo "ONE_C_ARCHIVE_ENCRYPTION_KEY is empty; correct it manually" >&2
    exit 1
  fi
else
  missing+=(ONE_C_ARCHIVE_ENCRYPTION_KEY)
fi

if (( ${#missing[@]} == 0 )); then
  echo "1C environment variables are already present; no changes made"
  exit 0
fi

umask 077
temporary=$(mktemp "${env_file}.upgrade.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
cp -- "${env_file}" "${temporary}"
printf '\n' >> "${temporary}"
for name in "${missing[@]}"; do
  if [[ ${name} == ONE_C_ARCHIVE_ENCRYPTION_KEY ]]; then
    printf '%s=%s\n' "$name" "$(openssl rand -base64 32 | tr -d '\n')" >> "${temporary}"
  else
    printf '%s=%s\n' "$name" "${!name}" >> "${temporary}"
  fi
done
chmod 600 "${temporary}"
backup=$(mktemp "${env_file}.before-one-c.XXXXXX")
cp -- "${env_file}" "${backup}"
chmod 600 "${backup}"
mv -- "${temporary}" "${env_file}"
echo "Added missing 1C variables. Previous .env saved at ${backup}"
