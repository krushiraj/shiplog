import { installationOctokit, type GitHub } from "./app";

export type InstallationRepo = { fullName: string; defaultBranch: string; private: boolean; description: string | null };

export async function listInstallationRepos(installationId: number, octokit?: GitHub): Promise<InstallationRepo[]> {
  const gh = octokit ?? (await installationOctokit(installationId));
  const repos = await gh.paginate(gh.rest.apps.listReposAccessibleToInstallation, { per_page: 100 });
  return repos.map((r) => ({
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    private: r.private,
    description: r.description ?? null,
  }));
}
