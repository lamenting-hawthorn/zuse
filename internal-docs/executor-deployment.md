# Shared Executor deployment

Zuse's Plugins settings connect to Executor's API and MCP endpoint. Local and cloud runtimes can connect to the same reachable instance using personal API keys belonging to the same Executor user. Service integrations, account connections, and policies live in Executor, not in each agent's native configuration. Each runtime must be connected explicitly; Zuse does not copy a desktop credential to cloud machines automatically.

## Start a personal or team instance

`docker compose -f infra/executor/compose.yaml up -d --build` builds upstream commit `a6a7bf2090ce103e37e38858f91fdd6fbce4afb0`. The compose file binds localhost for setup. Open `http://localhost:4788`, create the initial owner, and use invitations for other users. Create a **personal** API key, not a platform/admin credential. Add integrations and account connections in Executor's console. Zuse deliberately uses Executor's own authentication and connection UI rather than implementing every provider's OAuth flow again.

For access from cloud workspaces, put an HTTPS reverse proxy in front of port 4788, set `EXECUTOR_WEB_BASE_URL` to the public HTTPS origin, and recreate the container. A cloud runtime cannot use the desktop's localhost address. Configure Plugins in each intended Zuse environment using this same origin and the user's own API key. Do not put credentials in a URL, source checkout, or Compose file. Complete the initial owner setup before making the service publicly reachable.

The default selfhost application has one organization. For unrelated customer tenants, deploy isolated instances or implement a reviewed tenant/auth mapping. Do not put all customers behind a shared privileged API key. Provider-specific OAuth applications must be provisioned when the upstream service cannot dynamically register them.

## Persistence and upgrades

The `executor-data` volume holds SQLite and encryption keys. Back up the entire volume with the service stopped or a documented consistent SQLite backup; retain keys along with the database. Never use `docker compose down -v` for an upgrade. Keep the old source revision and data backup for rollback. This is a separate data store; it does not replace or migrate Zuse's conversation database.

Review an upstream update, change the pinned source revision, build and test it against a restored backup, then upgrade. The public Docker docs and source README have used different image namespaces, so this setup builds a pinned source commit instead of assuming an image tag exists.

## Supported runtime paths

Claude Code, Codex, Cursor, Gemini, Grok, Kiro, OpenCode CLI, and supervised ACP adapters receive the shared MCP endpoint. ACP agents without HTTP support use Zuse's stdio-to-HTTP bridge. An agent still needs functional MCP support; bundled non-MCP runtimes do not gain that capability merely by connecting Executor. Native Codex plugin installation/marketplace RPCs and UI have been removed; native user-owned CLI configuration is left intact.

The runtime-local proxy uses a random capability token and injects the Executor key host-side. Requests check the saved connection on every call: disabling or disconnecting prevents further upstream requests even from existing chats. Already dispatched actions may finish. Changing a toolkit or reconnecting requires a new chat to reset the upstream MCP session. Executor enforces account/toolkit policies; the Zuse catalog shows the account's available integrations, not a claim that every listed integration is permitted by a selected toolkit.

## Acceptance gates

Verify both a local and a real cloud runtime against the deployed HTTPS instance, using two independent Executor users. Check catalog isolation, two accounts for one service, allowed reads, approval/denial for writes, toolkit restrictions, disconnect during a session, expired keys, offline behavior, and persistence after restart. Confirm real Claude Code and Codex tool calls and ACP stdio fallback. The source change is not proof that a public service or OAuth apps have been deployed.
