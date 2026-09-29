import type { ExtensionCatalog, ExtensionId } from "@zuse/contracts";
import {
	boundedCleanup,
	emptyCollector,
	withExtensionDeadline,
} from "./extension-client-lifecycle.ts";
import {
	type ActiveRegistration,
	createExtensionRegistryStore,
} from "./extension-registry.tsx";

export class ExtensionRegistry {
	private active = new Map<ExtensionId, ActiveRegistration>();
	private revision = Promise.resolve();
	constructor(private readonly store = createExtensionRegistryStore()) {}

	subscribe = (listener: () => void) => this.store.subscribe(listener);
	getSnapshot = () => this.store.getSnapshot();

	sync(catalog: ExtensionCatalog): void {
		this.revision = this.revision.then(
			() => this.apply(catalog),
			() => this.apply(catalog),
		);
	}

	private async apply(catalog: ExtensionCatalog): Promise<void> {
		const desired = new Map(
			catalog.items
				.filter(
					(item) => item.status === "running" && item.clientBundle !== null,
				)
				.map((item) => [item.id, item] as const),
		);
		for (const [id, registration] of this.active) {
			const item = desired.get(id);
			if (item !== undefined) continue;
			try {
				await boundedCleanup(registration.dispose);
			} catch (cause) {
				console.error("[extensions] cleanup failed", cause);
			} finally {
				this.active.delete(id);
			}
		}
		for (const [id, item] of desired) {
			const previous = this.active.get(id);
			if (previous?.bundle === item.clientBundle || item.clientBundle === null)
				continue;
			const runnableItem = { ...item, clientBundle: item.clientBundle };
			try {
				const { evaluateExtension } = await withExtensionDeadline(
					import("./extension-evaluator.ts"),
					5000,
					"Extension client loading timed out.",
				);
				const candidate = await evaluateExtension(runnableItem);
				this.active.set(id, candidate);
				if (previous) {
					try {
						await boundedCleanup(previous.dispose);
					} catch (cause) {
						console.error("[extensions] cleanup failed", cause);
					}
				}
			} catch (cause) {
				console.error(`[extensions] client setup failed: ${id}`, cause);
				this.active.set(
					id,
					previous
						? {
								...previous,
								error: cause instanceof Error ? cause.message : String(cause),
							}
						: {
								extensionId: id,
								bundle: item.clientBundle,
								contributions: emptyCollector(),
								error: cause instanceof Error ? cause.message : String(cause),
								dispose: async () => {},
							},
				);
			}
		}
		this.store.publish(
			[...this.active.values()].sort((left, right) =>
				left.extensionId.localeCompare(right.extensionId),
			),
		);
	}
}
