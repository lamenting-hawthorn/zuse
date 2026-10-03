import { describe, expect, it } from "vitest";

import { defaultFileViewForName } from "../../src/lib/file-preview.ts";

describe("file preview", () => {
	it("opens markdown files in preview by default", () => {
		expect(defaultFileViewForName("README.md")).toBe("preview");
		expect(defaultFileViewForName("notes.markdown")).toBe("preview");
		expect(defaultFileViewForName("index.ts")).toBe("edit");
		expect(defaultFileViewForName("index.html")).toBe("edit");
	});
});
