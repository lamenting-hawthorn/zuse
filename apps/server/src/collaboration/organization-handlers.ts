import { MemoizeRpcs, OrganizationError } from "@zuse/contracts";
import { Effect, Layer } from "effect";
import {
	type MachineControlError,
	MachineControlService,
} from "../machine/machine-control-service.ts";
import { CollaborationService } from "./services/collaboration-service.ts";

const withOrganizations = <A>(
	run: (
		service: MachineControlService["Service"],
	) => Effect.Effect<A, MachineControlError>,
) =>
	Effect.flatMap(MachineControlService, run).pipe(
		Effect.mapError(
			(error) =>
				new OrganizationError({
					code:
						error.code === "not-allowed" ||
						error.code === "not-found" ||
						error.code === "conflict" ||
						error.code === "invalid-request"
							? error.code
							: "unavailable",
				}),
		),
	);

export const OrganizationHandlersLayer = Layer.mergeAll(
	MemoizeRpcs.toLayerHandler("organizations.list", () =>
		withOrganizations((service) => service.listOrganizations()),
	),
	MemoizeRpcs.toLayerHandler("organizations.create", (input) =>
		withOrganizations((service) => service.createOrganization(input)),
	),
	MemoizeRpcs.toLayerHandler("organizations.get", ({ organizationId }) =>
		Effect.gen(function* () {
			const details = yield* withOrganizations((service) =>
				service.getOrganization(organizationId),
			);
			const collaboration = yield* CollaborationService;
			yield* collaboration
				.synchronizeOrganization(details)
				.pipe(
					Effect.mapError(() => new OrganizationError({ code: "unavailable" })),
				);
			return details;
		}),
	),
	MemoizeRpcs.toLayerHandler("organizations.invite", (input) =>
		withOrganizations((service) => service.inviteOrganizationMember(input)),
	),
	MemoizeRpcs.toLayerHandler("organizations.revokeInvite", (input) =>
		withOrganizations((service) => service.revokeOrganizationInvite(input)),
	),
	MemoizeRpcs.toLayerHandler("organizations.setRole", (input) =>
		withOrganizations((service) => service.setOrganizationRole(input)),
	),
	MemoizeRpcs.toLayerHandler("organizations.removeMember", (input) =>
		withOrganizations((service) => service.removeOrganizationMember(input)),
	),
);
