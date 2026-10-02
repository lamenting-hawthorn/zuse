import type {
	ModelConnectionStatus,
	ModelSignInEvent,
} from "@zuse/contracts";
import { Effect, Stream } from "effect";

export interface ModelConnectionsClient {
	"modelConnections.connections": (
		input: Record<string, never>,
	) => Effect.Effect<ModelConnectionStatus, unknown>;
	"modelConnections.connect": (input: {
		connectionId?: string;
		provider?: "chatgpt" | "supergrok";
		storage?: "local" | "account";
	}) => Stream.Stream<ModelSignInEvent, unknown>;
	"modelConnections.rename": (input: {
		connectionId: string;
		name: string;
	}) => Effect.Effect<void, unknown>;
	"modelConnections.preferred": (input: {
		connectionId: string;
	}) => Effect.Effect<void, unknown>;
	"modelConnections.disconnect": (input: {
		connectionId: string;
	}) => Effect.Effect<{ revoked: boolean }, unknown>;
	"modelConnections.acknowledgePlan": (input: {
		connectionId: string;
	}) => Effect.Effect<void, unknown>;
}
export interface ModelConnectionsSnapshot extends ModelConnectionStatus {
	readonly loading: boolean;
	readonly busy: string | null;
	readonly signingIn: boolean;
	readonly error: string | null;
	readonly warning: "revocation_unconfirmed" | null;
	readonly loginUrl: string | null;
	readonly device: {
		userCode: string;
		verificationUrl: string;
		expiresAt: number;
	} | null;
	readonly noticeConnectionId: string | null;
}
function codeOf(cause: unknown): string {
	const code =
		typeof cause === "object" && cause !== null && "code" in cause
			? cause.code
			: undefined;
	return typeof code === "string" ? code : "connection_failed";
}
/** Transient OAuth owner; attempts are never persisted or replayed by the command outbox. */
export class ModelConnectionController {
	private value: ModelConnectionsSnapshot = {
		available: false,
		connections: [],
		loading: true,
		busy: null,
		signingIn: false,
		error: null,
		warning: null,
		loginUrl: null,
		device: null,
		noticeConnectionId: null,
	};
	private listeners = new Set<() => void>();
	private login: AbortController | null = null;
	private closed = false;
	private loadVersion = 0;
	constructor(
		private readonly client: () => Promise<ModelConnectionsClient>,
		private readonly openBrowser: (url: string) => void,
	) {}
	readonly snapshot = () => this.value;
	readonly subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private update(patch: Partial<ModelConnectionsSnapshot>) {
		if (this.closed) return;
		this.value = { ...this.value, ...patch };
		for (const listener of this.listeners) listener();
	}
	async load(): Promise<void> {
		const version = ++this.loadVersion;
		try {
			const client = await this.client();
			const result = await Effect.runPromise(
				client["modelConnections.connections"]({}),
			);
			if (version === this.loadVersion)
				this.update({
					...result,
					loading: false,
					error: null,
					noticeConnectionId: result.connections.some(
						(c) => c.provider !== "supergrok" && c.planNoticeSeen,
					)
						? null
						: (result.connections.find(
								(c) => c.provider !== "supergrok" && c.authorized,
							)?.id ?? null),
				});
		} catch (cause) {
			if (version === this.loadVersion)
				this.update({ loading: false, error: codeOf(cause) });
		}
	}
	async connect(
		connectionId?: string,
		provider: "chatgpt" | "supergrok" = "chatgpt",
		storage: "local" | "account" = "local",
	): Promise<void> {
		if (this.closed || this.value.busy) return;
		const attempt = new AbortController();
		this.login = attempt;
		this.update({
			busy: connectionId ?? "connect",
			signingIn: true,
			error: null,
			warning: null,
			loginUrl: null,
			device: null,
		});
		let completed = false;
		try {
			const client = await this.client();
			attempt.signal.throwIfAborted();
			await Effect.runPromise(
				Stream.runForEach(
					client["modelConnections.connect"]({
						...(connectionId ? { connectionId } : {}),
						...(provider === "supergrok" ? { provider } : {}),
						...(storage === "account" ? { storage } : {}),
					}),
					(event) =>
						Effect.sync(() => {
							if (this.login !== attempt || this.closed) return;
							if (event._tag === "device") {
								const url = new URL(event.verificationUrl);
								if (
									url.protocol !== "https:" ||
									!["auth.x.ai", "accounts.x.ai"].includes(url.hostname) ||
									url.username ||
									url.password ||
									url.port
								)
									throw new Error("Unexpected verification URL");
								this.update({ device: event });
							} else if (event._tag === "url") {
								const url = new URL(event.url);
								if (
									url.origin !== "https://auth.openai.com" ||
									url.pathname !== "/api/accounts/authorize" ||
									url.searchParams.has("id_token_hint")
								)
									throw new Error("Unexpected authorization URL");
								this.update({ loginUrl: event.url });
								this.openBrowser(event.url);
							} else {
								completed = true;
								const notice =
									event.connection.provider !== "supergrok" &&
									event.connection.authorized &&
									!event.connection.planNoticeSeen &&
									!this.value.connections.some(
										(c) => c.provider !== "supergrok" && c.planNoticeSeen,
									);
								this.update({
									connections: [
										...this.value.connections.filter(
											(c) => c.id !== event.connection.id,
										),
										event.connection,
									].sort(
										(a, b) =>
											a.createdAt - b.createdAt || a.id.localeCompare(b.id),
									),
									loginUrl: null,
									device: null,
									...(notice
										? { noticeConnectionId: event.connection.id }
										: {}),
								});
							}
						}),
				),
				{ signal: attempt.signal },
			);
			if (!completed) throw new Error("Sign-in stream ended before completion");
			if (this.login === attempt) await this.load();
		} catch (cause) {
			if (this.login === attempt && !attempt.signal.aborted) {
				await this.load();
				if (this.login === attempt) this.update({ error: codeOf(cause) });
			}
		} finally {
			if (this.login === attempt) {
				this.login = null;
				this.update({
					busy: null,
					loginUrl: null,
					device: null,
					signingIn: false,
				});
			}
		}
	}
	cancel(): void {
		const attempt = this.login;
		this.login = null;
		attempt?.abort();
		this.update({
			busy: null,
			loginUrl: null,
			device: null,
			error: null,
			signingIn: false,
		});
	}
	private async mutate(
		id: string,
		operation: (
			client: ModelConnectionsClient,
		) => Effect.Effect<unknown, unknown>,
	): Promise<boolean> {
		if (this.closed || this.value.busy) return false;
		this.update({ busy: id, error: null, warning: null });
		try {
			const client = await this.client();
			if (this.closed) return false;
			await Effect.runPromise(operation(client));
			await this.load();
			return true;
		} catch (cause) {
			this.update({ error: codeOf(cause) });
			return false;
		} finally {
			this.update({ busy: null });
		}
	}
	rename(id: string, name: string) {
		return this.mutate(id, (client) =>
			client["modelConnections.rename"]({ connectionId: id, name }),
		);
	}
	preferred(id: string) {
		return this.mutate(id, (client) =>
			client["modelConnections.preferred"]({ connectionId: id }),
		);
	}
	disconnect(id: string) {
		return this.mutate(id, (client) =>
			client["modelConnections.disconnect"]({ connectionId: id }).pipe(
				Effect.tap((result) =>
					Effect.sync(() => {
						if (!result.revoked)
							this.update({ warning: "revocation_unconfirmed" });
					}),
				),
			),
		);
	}
	async acknowledgePlan() {
		const id = this.value.noticeConnectionId;
		if (
			id &&
			(await this.mutate(id, (client) =>
				client["modelConnections.acknowledgePlan"]({ connectionId: id }),
			))
		)
			this.update({ noticeConnectionId: null });
	}
	activate() {
		this.closed = false;
		this.update({
			busy: null,
			loginUrl: null,
			device: null,
			loading: true,
			signingIn: false,
		});
	}
	dispose() {
		this.closed = true;
		this.loadVersion++;
		this.login?.abort();
		this.login = null;
		this.listeners.clear();
	}
}
