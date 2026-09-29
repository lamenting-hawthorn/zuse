export const WORKSPACE_RUNTIME_UPDATE_SCRIPT = `# Account snapshots can outlive a wire-protocol rollout. First launches check local
# metadata without a network fetch; explicit restarts also apply runtime fixes.
ensure_workspace_runtime() {
  [[ -n "\${ZUSE_RUNTIME_MANIFEST_URL:-}" ]] || return 0
  local status_dir=/var/lib/zuse/workspace
  local metadata="\${ZUSE_CURRENT_LINK:-/opt/zuse/current}/runtime-metadata.json"
  mkdir -p "$status_dir"
  runtime_is_compatible() {
    node -e '
      try {
        const metadata = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
        const expected = Number(process.env.ZUSE_RUNTIME_WIRE_PROTOCOL);
        process.exit(Number.isInteger(expected) && expected > 0 &&
          metadata.schemaVersion === 1 && metadata.wireProtocolVersion === expected ? 0 : 1);
      } catch { process.exit(1); }
    ' "$metadata"
  }
  if [[ "\${1:-0}" != 1 ]] && runtime_is_compatible; then return 0; fi
  if [[ -f "\${ZUSE_RUNTIME_PUBLIC_KEY_FILE:-}" ]] &&
    ZUSE_RUNTIME_INSTALL_ONLY=1 ZUSE_RUNTIME_SKIP_TOOLCHAIN=1 \\
      node /usr/local/lib/zuse/runtime-updater.mjs >>"$status_dir/runtime.log" 2>&1 &&
    runtime_is_compatible; then
    return 0
  fi
  printf 'updating-runtime\\n' >"$status_dir/failure-phase"
  touch "$status_dir/failed"
  return 1
}
`;
