import { Context } from "effect";

/** Request-local ownership selection. Never mutate process-wide account identity. */
export const RequestWorkspace = Context.Reference<string>(
	"@zuse/server/RequestWorkspace",
	{ defaultValue: () => "personal" },
);
