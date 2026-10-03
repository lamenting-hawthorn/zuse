const PREVIEWABLE_EXTENSIONS = new Set([
	".htm",
	".html",
	".markdown",
	".md",
	".mdown",
	".mkd",
]);

const MARKDOWN_EXTENSIONS = new Set([".markdown", ".md", ".mdown", ".mkd"]);

const extensionOf = (name: string): string => {
	const lower = name.toLowerCase();
	const dot = lower.lastIndexOf(".");
	return dot === -1 ? "" : lower.slice(dot);
};

export const isPreviewableFileName = (name: string): boolean => {
	return PREVIEWABLE_EXTENSIONS.has(extensionOf(name));
};

export const defaultFileViewForName = (name: string): "edit" | "preview" =>
	MARKDOWN_EXTENSIONS.has(extensionOf(name)) ? "preview" : "edit";
