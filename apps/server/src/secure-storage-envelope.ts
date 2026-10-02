import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SecureStorageEnvelope {
	readonly version: 1;
	readonly iv: string;
	readonly ciphertext: string;
	readonly tag: string;
}
export function sealStorage(
	plaintext: string,
	key: Buffer,
	context: Buffer,
): SecureStorageEnvelope {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(context);
	return {
		version: 1,
		iv: iv.toString("base64url"),
		ciphertext: Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]).toString("base64url"),
		tag: cipher.getAuthTag().toString("base64url"),
	};
}
export function openStorage(
	raw: unknown,
	key: Buffer,
	context: Buffer,
): string {
	if (
		typeof raw !== "object" ||
		raw === null ||
		!("version" in raw) ||
		raw.version !== 1 ||
		!("iv" in raw) ||
		typeof raw.iv !== "string" ||
		!("ciphertext" in raw) ||
		typeof raw.ciphertext !== "string" ||
		!("tag" in raw) ||
		typeof raw.tag !== "string"
	)
		throw new Error("Secure storage is corrupt.");
	const decipher = createDecipheriv(
		"aes-256-gcm",
		key,
		Buffer.from(raw.iv, "base64url"),
	);
	decipher.setAAD(context);
	decipher.setAuthTag(Buffer.from(raw.tag, "base64url"));
	return Buffer.concat([
		decipher.update(Buffer.from(raw.ciphertext, "base64url")),
		decipher.final(),
	]).toString("utf8");
}
