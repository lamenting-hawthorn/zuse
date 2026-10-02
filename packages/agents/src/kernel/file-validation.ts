import { isAbsolute, relative } from "node:path";
export const isWithin = (candidate: string, root: string): boolean => {
	const rel = relative(root, candidate);
	return (
		rel !== ".." &&
		!rel.startsWith("../") &&
		!rel.startsWith("..\\") &&
		!isAbsolute(rel)
	);
};
export const imageMime = (
	bytes: Uint8Array,
): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | null => {
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xff &&
		bytes[1] === 0xd8 &&
		bytes[2] === 0xff
	) {
		return "image/jpeg";
	}
	const header = Buffer.from(bytes.subarray(0, 12)).toString("ascii");
	if (header.startsWith("GIF87a") || header.startsWith("GIF89a")) {
		return "image/gif";
	}
	if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") {
		return "image/webp";
	}
	return null;
};
