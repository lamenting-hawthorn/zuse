/** Sidebar recency follows user input, never agent activity or metadata edits. */
export const chatRecency = <T extends Date | number>(chat: {
	readonly lastUserMessageAt?: T | null;
	readonly createdAt: T;
}): T => chat.lastUserMessageAt ?? chat.createdAt;

/** A deterministic tie-break keeps equal timestamps stable during stream updates. */
export const compareChatRecency = (
	left: {
		readonly id: string;
		readonly createdAt: Date;
		readonly lastUserMessageAt?: Date | null;
	},
	right: {
		readonly id: string;
		readonly createdAt: Date;
		readonly lastUserMessageAt?: Date | null;
	},
): number =>
	chatRecency(right).getTime() - chatRecency(left).getTime() ||
	left.id.localeCompare(right.id);
