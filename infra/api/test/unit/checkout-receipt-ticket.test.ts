import { Effect } from "effect";
import { exportJWK, generateKeyPair } from "jose";
import { expect, test } from "vitest";
import {
	signCheckoutReceiptTicket,
	verifyCheckoutReceiptTicket,
} from "../../src/crypto.ts";

test.each([
	undefined,
	"Personal",
	"Acme",
])("round-trips legacy and workspace receipt identity: %s", async (workspaceName) => {
	const keys = await generateKeyPair("EdDSA", { extractable: true });
	const input = {
		mintPrivateJwk: await exportJWK(keys.privateKey),
		issuer: "https://api.example.test",
		accountId: workspaceName === "Acme" ? "organization:org_a" : "user_a",
		offerId: "cloud-workspace-v1",
		workspaceName,
		ttlMs: 60_000,
		nowMs: 1_800_000_000_000,
	};
	const token = await Effect.runPromise(signCheckoutReceiptTicket(input));
	const verification = {
		token,
		mintPublicJwk: await exportJWK(keys.publicKey),
		issuer: input.issuer,
		nowMs: input.nowMs,
	};
	const claims = await Effect.runPromise(
		verifyCheckoutReceiptTicket(verification),
	);
	expect(claims).toEqual({
		accountId: input.accountId,
		offerId: input.offerId,
		...(workspaceName === undefined ? {} : { workspaceName }),
	});
	await expect(
		Effect.runPromise(
			verifyCheckoutReceiptTicket({
				...verification,
				nowMs: input.nowMs + 61_000,
			}),
		),
	).rejects.toMatchObject({ code: "invalid_checkout_ticket" });
});
