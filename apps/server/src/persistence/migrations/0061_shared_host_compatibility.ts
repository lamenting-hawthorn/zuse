import { Effect } from "effect";

// Slot 61 was applied on development and staging runtimes. Reserve it forever;
// existing collaboration tables remain untouched until shared-host work returns.
export const Migration0061SharedHostCompatibility = Effect.void;
