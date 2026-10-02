import { afterEach, expect, it, vi } from "vitest";
import { downloadBlob } from "../../src/lib/download-blob.ts";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it.each([
	false,
	true,
])("releases download URLs after browser consumption, including click failure (%s)", (fails) => {
	vi.useFakeTimers();
	const anchor = {
		href: "",
		download: "",
		click: vi.fn(() => {
			if (fails) throw new Error("blocked");
		}),
		remove: vi.fn(),
	};
	const append = vi.fn();
	vi.stubGlobal("document", { body: { append }, createElement: () => anchor });
	vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const run = () => downloadBlob(new Blob(["content"]), "file.txt");
	if (fails) expect(run).toThrow("blocked");
	else run();
	expect(anchor.href).toBe("blob:test");
	expect(anchor.download).toBe("file.txt");
	expect(append).toHaveBeenCalledWith(anchor);
	expect(anchor.remove).toHaveBeenCalledOnce();
	expect(revoke).not.toHaveBeenCalled();
	vi.advanceTimersByTime(30_000);
	expect(revoke).toHaveBeenCalledWith("blob:test");
});
