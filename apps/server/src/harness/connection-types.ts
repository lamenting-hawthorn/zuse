import type { ModelConnection } from "@zuse/contracts";
import { z } from "zod";
export const registrationSchema = z.object({
	id: z.string(),
	clientId: z.string(),
	subject: z.string(),
	email: z.string().optional(),
	name: z.string(),
	createdAt: z.number(),
	preferred: z.boolean(),
	planNoticeSeen: z.boolean().optional(),
	authorizationGeneration: z.number().int().nonnegative().optional(),
	scope: z.string(),
	idToken: z.string().optional(),
	accessToken: z.string().optional(),
	refreshToken: z.string().optional(),
	expiresAt: z.number().optional(),
	earliestRefreshAt: z.number().optional(),
});
export const pendingRegistrationSchema = z.object({
	id: z.string(),
	clientId: z.string(),
	createdAt: z.number(),
});
export type PendingModelRegistration = z.infer<
	typeof pendingRegistrationSchema
>;
export type ModelRegistration = z.infer<typeof registrationSchema>;
export type ConnectionMetadata = ModelConnection;
export interface ModelVault {
	read(id: string): Promise<ModelRegistration | null>;
	write(value: ModelRegistration): Promise<void>;
	list(): Promise<ModelRegistration[]>;
	hostId(): Promise<string>;
	readPending(id: string): Promise<PendingModelRegistration | null>;
	listPending(): Promise<PendingModelRegistration[]>;
	writePending(value: PendingModelRegistration): Promise<void>;
	removePending(id: string): Promise<void>;
	/** Cross-process lock; reread credentials inside it, including on disconnect. */
	lock<T>(id: string, operation: () => Promise<T>): Promise<T>;
}
