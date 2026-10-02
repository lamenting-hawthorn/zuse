import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Spinner } from "../../src/components/ui/spinner.tsx";

describe("Spinner", () => {
	it("uses the shared loading label and permits a contextual label", () => {
		expect(renderToStaticMarkup(<Spinner />)).toContain(
			'aria-label="Loading…"',
		);
		expect(renderToStaticMarkup(<Spinner aria-label="Saving" />)).toContain(
			'aria-label="Saving"',
		);
	});
});
