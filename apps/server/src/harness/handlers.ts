import { MemoizeRpcs } from "@zuse/contracts";
import { Effect, Layer, Stream } from "effect";
import { ModelConnections } from "./connections-service.ts";

export const ModelConnectionsHandlersLayer = Layer.mergeAll(
	MemoizeRpcs.toLayerHandler("modelConnections.connections", () =>
		Effect.flatMap(ModelConnections, (service) => service.status()),
	),
	MemoizeRpcs.toLayerHandler(
		"modelConnections.connect",
		({ connectionId, provider, storage }) =>
			Stream.unwrap(
				Effect.map(ModelConnections, (service) =>
					service.connect(connectionId, provider, storage),
				),
			),
	),
	MemoizeRpcs.toLayerHandler(
		"modelConnections.rename",
		({ connectionId, name }) =>
			Effect.flatMap(ModelConnections, (service) =>
				service.rename(connectionId, name),
			),
	),
	MemoizeRpcs.toLayerHandler("modelConnections.preferred", ({ connectionId }) =>
		Effect.flatMap(ModelConnections, (service) =>
			service.preferred(connectionId),
		),
	),
	MemoizeRpcs.toLayerHandler(
		"modelConnections.disconnect",
		({ connectionId }) =>
			Effect.flatMap(ModelConnections, (service) =>
				service.disconnect(connectionId),
			),
	),
	MemoizeRpcs.toLayerHandler(
		"modelConnections.acknowledgePlan",
		({ connectionId }) =>
			Effect.flatMap(ModelConnections, (service) =>
				service.acknowledgePlan(connectionId),
			),
	),
);
