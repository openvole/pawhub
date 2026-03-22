import { z, type PawDefinition } from '@openvole/paw-sdk'
import { Octokit } from '@octokit/rest'

let octokit: Octokit | undefined

function getOctokit(): Octokit {
	if (!octokit) {
		throw new Error('GITHUB_TOKEN not set — paw-github is not configured')
	}
	return octokit
}

function parseRepo(repo: string): { owner: string; repo: string } {
	const parts = repo.split('/')
	if (parts.length !== 2) {
		throw new Error(`Invalid repo format "${repo}" — expected "owner/repo"`)
	}
	return { owner: parts[0], repo: parts[1] }
}

export const paw: PawDefinition = {
	name: '@openvole/paw-github',
	version: '0.1.0',
	description: 'Paw for interacting with GitHub via the Octokit REST API',

	tools: [
		{
			name: 'github_create_issue',
			description: 'Create a GitHub issue in a repository',
			parameters: z.object({
				repo: z.string().describe('Repository in "owner/repo" format'),
				title: z.string().describe('Issue title'),
				body: z.string().describe('Issue body (markdown)'),
				labels: z
					.array(z.string())
					.optional()
					.describe('Labels to apply to the issue'),
			}),
			async execute(params: unknown) {
				const { repo, title, body, labels } = params as {
					repo: string
					title: string
					body: string
					labels?: string[]
				}
				try {
					const { owner, repo: repoName } = parseRepo(repo)
					const { data } = await getOctokit().issues.create({
						owner,
						repo: repoName,
						title,
						body,
						labels,
					})
					return {
						ok: true,
						number: data.number,
						url: data.html_url,
						title: data.title,
					}
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'github_list_issues',
			description: 'List issues in a GitHub repository',
			parameters: z.object({
				repo: z.string().describe('Repository in "owner/repo" format'),
				state: z
					.enum(['open', 'closed', 'all'])
					.optional()
					.describe('Filter by state (default: open)'),
				labels: z
					.string()
					.optional()
					.describe('Comma-separated list of label names to filter by'),
			}),
			async execute(params: unknown) {
				const { repo, state, labels } = params as {
					repo: string
					state?: 'open' | 'closed' | 'all'
					labels?: string
				}
				try {
					const { owner, repo: repoName } = parseRepo(repo)
					const { data } = await getOctokit().issues.listForRepo({
						owner,
						repo: repoName,
						state: state ?? 'open',
						labels,
						per_page: 30,
					})
					const issues = data.map((issue) => ({
						number: issue.number,
						title: issue.title,
						state: issue.state,
						url: issue.html_url,
						labels: issue.labels.map((l: any) =>
							typeof l === 'string' ? l : l.name,
						),
						created_at: issue.created_at,
					}))
					return { ok: true, count: issues.length, issues }
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'github_create_pr',
			description: 'Create a pull request in a GitHub repository',
			parameters: z.object({
				repo: z.string().describe('Repository in "owner/repo" format'),
				title: z.string().describe('Pull request title'),
				body: z.string().describe('Pull request body (markdown)'),
				head: z.string().describe('The branch containing the changes'),
				base: z.string().describe('The branch to merge into'),
			}),
			async execute(params: unknown) {
				const { repo, title, body, head, base } = params as {
					repo: string
					title: string
					body: string
					head: string
					base: string
				}
				try {
					const { owner, repo: repoName } = parseRepo(repo)
					const { data } = await getOctokit().pulls.create({
						owner,
						repo: repoName,
						title,
						body,
						head,
						base,
					})
					return {
						ok: true,
						number: data.number,
						url: data.html_url,
						title: data.title,
					}
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'github_list_prs',
			description: 'List pull requests in a GitHub repository',
			parameters: z.object({
				repo: z.string().describe('Repository in "owner/repo" format'),
				state: z
					.enum(['open', 'closed', 'all'])
					.optional()
					.describe('Filter by state (default: open)'),
			}),
			async execute(params: unknown) {
				const { repo, state } = params as {
					repo: string
					state?: 'open' | 'closed' | 'all'
				}
				try {
					const { owner, repo: repoName } = parseRepo(repo)
					const { data } = await getOctokit().pulls.list({
						owner,
						repo: repoName,
						state: state ?? 'open',
						per_page: 30,
					})
					const prs = data.map((pr) => ({
						number: pr.number,
						title: pr.title,
						state: pr.state,
						url: pr.html_url,
						head: pr.head.ref,
						base: pr.base.ref,
						created_at: pr.created_at,
					}))
					return { ok: true, count: prs.length, prs }
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'github_search_repos',
			description: 'Search GitHub repositories',
			parameters: z.object({
				query: z.string().describe('Search query string'),
			}),
			async execute(params: unknown) {
				const { query } = params as { query: string }
				try {
					const { data } = await getOctokit().search.repos({
						q: query,
						per_page: 20,
					})
					const repos = data.items.map((r) => ({
						full_name: r.full_name,
						description: r.description,
						url: r.html_url,
						stars: r.stargazers_count,
						language: r.language,
					}))
					return { ok: true, total_count: data.total_count, repos }
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'github_get_file',
			description: 'Get file content from a GitHub repository',
			parameters: z.object({
				repo: z.string().describe('Repository in "owner/repo" format'),
				path: z.string().describe('File path within the repository'),
				ref: z
					.string()
					.optional()
					.describe('Git ref (branch, tag, or commit SHA). Defaults to default branch'),
			}),
			async execute(params: unknown) {
				const { repo, path, ref } = params as {
					repo: string
					path: string
					ref?: string
				}
				try {
					const { owner, repo: repoName } = parseRepo(repo)
					const { data } = await getOctokit().repos.getContent({
						owner,
						repo: repoName,
						path,
						ref,
					})
					if (Array.isArray(data)) {
						const entries = data.map((item) => ({
							name: item.name,
							type: item.type,
							path: item.path,
							size: item.size,
						}))
						return { ok: true, type: 'directory', entries }
					}
					if (data.type === 'file' && 'content' in data) {
						const content = Buffer.from(data.content, 'base64').toString('utf-8')
						return {
							ok: true,
							type: 'file',
							path: data.path,
							size: data.size,
							content,
						}
					}
					return { ok: true, type: data.type, path: data.path }
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
	],

	async onLoad() {
		const token = process.env.GITHUB_TOKEN
		if (!token) {
			console.log('[paw-github] GITHUB_TOKEN not set — paw will not function')
			return
		}
		octokit = new Octokit({ auth: token })
		console.log('[paw-github] loaded')
	},

	async onUnload() {
		octokit = undefined
		console.log('[paw-github] unloaded')
	},
}
