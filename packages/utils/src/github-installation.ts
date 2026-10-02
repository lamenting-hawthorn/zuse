/** Repository selection lives in GitHub's installation settings. */
export const githubInstallationSettingsUrl = (
	installationId: number,
	account?: { readonly accountType: string; readonly accountLogin: string },
): string =>
	account?.accountType === "Organization"
		? `https://github.com/organizations/${encodeURIComponent(account.accountLogin)}/settings/installations/${installationId}`
		: `https://github.com/settings/installations/${installationId}`;
