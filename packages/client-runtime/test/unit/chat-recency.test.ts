import { expect, it } from "vitest";
import { chatRecency, compareChatRecency } from "../../src/chat-recency.ts";

it("uses user input or creation time, ignoring agent activity", () => {
	const chat = {
		id: "a",
		createdAt: new Date(10),
		updatedAt: new Date(200),
		lastMessageAt: new Date(200),
		lastUserMessageAt: new Date(20),
	};
	expect(chatRecency(chat).getTime()).toBe(20);
	expect(chatRecency({ ...chat, lastUserMessageAt: null }).getTime()).toBe(10);
	expect(chatRecency({ createdAt: 10, lastUserMessageAt: 20 })).toBe(20);
	expect(chatRecency({ createdAt: 10 })).toBe(10);
});
it("keeps equal timestamps stable when stream upserts change input order", () => {
	const a = { id: "a", createdAt: new Date(10) };
	const b = { id: "b", createdAt: new Date(10) };
	expect([b, a].sort(compareChatRecency)).toEqual([a, b]);
	expect([a, b].sort(compareChatRecency)).toEqual([a, b]);
});
