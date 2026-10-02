import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { dirname } from "node:path";
export const atomicWritePrivateJson = async (
	path: string,
	value: unknown,
): Promise<void> => {
	const directory = dirname(path);
	await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
	await fs.promises.chmod(directory, 0o700);
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await fs.promises.writeFile(temporaryPath, JSON.stringify(value), {
			flag: "wx",
			mode: 0o600,
		});
		await fs.promises.rename(temporaryPath, path);
		await fs.promises.chmod(path, 0o600);
	} finally {
		await fs.promises.rm(temporaryPath, { force: true });
	}
};
