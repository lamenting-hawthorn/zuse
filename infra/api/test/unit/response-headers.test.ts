import { expect, test } from "vitest";
import { withoutResponseHeaders } from "../../src/http.ts";

test("preserves immutable redirects when no internal headers need stripping", () => {
	const response = Response.redirect("https://code.zuse.test/", 302);
	expect(withoutResponseHeaders(response, ["x-zuse-reconcile-machine"])).toBe(
		response,
	);
});
test("strips headers by copying immutable fetch responses without losing the body", async () => {
	const response = await fetch("data:text/plain,callback-result");
	const clean = withoutResponseHeaders(response, ["content-type"]);
	expect(clean.status).toBe(200);
	expect(clean.headers.has("content-type")).toBe(false);
	expect(response.headers.has("content-type")).toBe(true);
	expect(await clean.text()).toBe("callback-result");
});
