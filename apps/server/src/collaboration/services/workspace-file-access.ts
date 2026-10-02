import type { FolderId, WorktreeId } from "@zuse/contracts";
import { Context } from "effect";

/** Server-issued scope for a teammate's read of an explicitly shared checkout. */
export class WorkspaceFileAccess extends Context.Service<
	WorkspaceFileAccess,
	{
		readonly folderId: FolderId;
		readonly worktreeId: WorktreeId | null;
	}
>()("zuse/collaboration/WorkspaceFileAccess") {}
