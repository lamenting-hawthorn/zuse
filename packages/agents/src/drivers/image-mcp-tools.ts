import { readFile, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { imageMime, isWithin } from "../kernel/file-validation.ts";

export const IMAGE_MCP_SERVER_NAME = "zuse-images";
export const MAX_VIEW_IMAGE_BYTES = 10 * 1024 * 1024;

export const IMAGE_MCP_TOOLS = [
	{
		name: "view_image",
		description:
			"View a PNG, JPEG, GIF, or WebP image from the current workspace. Returns the image as multimodal content.",
		inputSchema: {
			type: "object" as const,
			properties: {
				path: {
					type: "string" as const,
					description: "Workspace-relative or absolute image path.",
				},
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
] as const;

export interface ImageMcpToolOptions {
	readonly cwd: string;
}

export const viewWorkspaceImage = async (
	options: ImageMcpToolOptions,
	requestedPath: string,
) => {
	if (requestedPath.trim().length === 0) {
		throw new Error("path is required");
	}
	const root = await realpath(options.cwd);
	const candidate = path.resolve(options.cwd, requestedPath);
	const resolved = await realpath(candidate);
	if (!isWithin(resolved, root)) {
		throw new Error(`Path escapes workspace: ${requestedPath}`);
	}
	const metadata = await stat(resolved);
	if (!metadata.isFile()) throw new Error(`Not a file: ${requestedPath}`);
	if (metadata.size > MAX_VIEW_IMAGE_BYTES) {
		throw new Error("Image exceeds the 10 MiB viewing limit");
	}
	const bytes = await readFile(resolved);
	const mimeType = imageMime(bytes);
	if (mimeType === null) {
		throw new Error(
			"Unsupported image format; expected PNG, JPEG, GIF, or WebP",
		);
	}
	return {
		content: [
			{
				type: "image" as const,
				data: bytes.toString("base64"),
				mimeType,
			},
			{
				type: "text" as const,
				text: `Viewed image: ${path.relative(root, resolved) || path.basename(resolved)}`,
			},
		],
	};
};

export const handleImageTool = async (
	name: string,
	args: Record<string, unknown>,
	options: ImageMcpToolOptions,
) => {
	if (name !== "view_image") throw new Error(`Unknown tool: ${name}`);
	if (typeof args.path !== "string") throw new Error("path is required");
	return viewWorkspaceImage(options, args.path);
};
