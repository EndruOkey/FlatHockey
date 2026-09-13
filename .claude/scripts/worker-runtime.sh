#!/usr/bin/env bash
set -euo pipefail

: "${FH_WORKER_WSL_DISTRO:=Ubuntu}"
: "${FH_WORKER_FORCE_WSL:=0}"

run_wsl_exe() {
  if ! command -v wsl.exe >/dev/null 2>&1; then
    return 127
  fi

  MSYS2_ARG_CONV_EXCL='*' wsl.exe -d "$FH_WORKER_WSL_DISTRO" -- "$@"
}

run_wsl_bash() {
  local script="${1:?script required}"
  run_wsl_exe bash -lc "$script"
}

trim_cr() {
  tr -d '\r'
}

shell_quote() {
  printf '%q' "$1"
}

is_windows_path() {
  [[ "$1" =~ ^[A-Za-z]:[\\/].* ]]
}

is_msys_path() {
  [[ "$1" =~ ^/[A-Za-z]/.* ]]
}

to_windows_path() {
  local path="${1:?path required}"

  if is_windows_path "$path"; then
    printf '%s\n' "$path"
    return 0
  fi

  if is_msys_path "$path"; then
    if command -v cygpath >/dev/null 2>&1; then
      cygpath -w "$path"
      return 0
    fi

    local drive rest
    drive="$(printf '%s' "${path:1:1}" | tr '[:lower:]' '[:upper:]')"
    rest="${path:3}"
    rest="${rest//\//\\}"
    printf '%s:\\%s\n' "$drive" "$rest"
    return 0
  fi

  if command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$path"
    return 0
  fi

  run_wsl_exe wslpath -w "$path" | trim_cr
}

to_wsl_path() {
  local path="${1:?path required}"

  if is_msys_path "$path"; then
    path="$(to_windows_path "$path")"
  fi

  if is_windows_path "$path"; then
    if command -v wslpath >/dev/null 2>&1; then
      wslpath -a "$path"
      return 0
    fi

    run_wsl_exe wslpath -a "$path" | trim_cr
    return 0
  fi

  printf '%s\n' "$path"
}

native_has() {
  command -v "$1" >/dev/null 2>&1
}

wsl_has() {
  local binary="${1:?binary required}"
  run_wsl_bash "command -v ${binary} >/dev/null 2>&1"
}

select_worker_runtime() {
  if [[ "${FH_WORKER_FORCE_WSL}" != "1" ]] && native_has tmux && native_has claude; then
    printf 'native\n'
    return 0
  fi

  if wsl_has tmux && wsl_has claude; then
    printf 'wsl-bridge\n'
    return 0
  fi

  return 1
}

select_tmux_runtime() {
  if [[ "${FH_WORKER_FORCE_WSL}" != "1" ]] && native_has tmux; then
    printf 'native\n'
    return 0
  fi

  if wsl_has tmux; then
    printf 'wsl-bridge\n'
    return 0
  fi

  return 1
}

run_in_runtime() {
  local script="${1:?script required}"
  local runtime="${2:?runtime required}"

  case "$runtime" in
    native)
      bash -lc "$script"
      ;;
    wsl-bridge)
      run_wsl_bash "$script"
      ;;
    *)
      echo "Unsupported worker runtime: $runtime" >&2
      return 1
      ;;
  esac
}
