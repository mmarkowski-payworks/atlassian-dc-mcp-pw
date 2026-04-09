# Atlassian DC MCP Project Guidelines

## Build/Test/Lint Commands
```bash
# Build all packages (builds common first, then others)
npm run build

# Build specific package
npm run build --workspace=@atlassian-dc-mcp/jira

# Run all tests
npm run test

# Run tests for specific package
npm run test --workspace=@atlassian-dc-mcp/jira

# Run specific test (using Jest)
npx jest -t 'test name' --workspace=@atlassian-dc-mcp/jira

# Development mode
npm run dev:jira
npm run dev:confluence
npm run dev:bitbucket

# Debugging
npm run debug
npm run debug:verbose
```

## Exclusion Controls

Each product supports excluding items from being accessible through the MCP server. Exclusions apply at both user level (env vars / `.env` file) and org level (hard-wired config file). Org-level entries cannot be overridden by users — the final list is always a union.

| Product | Env var | Format | What it blocks |
|---|---|---|---|
| Jira | `JIRA_EXCLUDED_PROJECTS` | Comma-separated project keys, e.g. `SECRET,INTERNAL` | `getIssue`, `getIssueComments`, `createIssue`, `updateIssue`, `postIssueComment`, `getTransitions`, `transitionIssue`; injects `project NOT IN (...)` into `searchIssues` CQL |
| Confluence | `CONFLUENCE_EXCLUDED_SPACES` | Comma-separated space keys, e.g. `HR,LEGAL` | `getContent`, `createContent`, `updateContent`; injects `space.key NOT IN (...)` into `searchContent` CQL |
| Bitbucket | `BITBUCKET_EXCLUDED_REPOS` | Comma-separated `PROJECTKEY/repo-slug` pairs, e.g. `MYPROJ/secret-repo` | All single-repo tools; `getRepositories` silently filters; inbox/dashboard PRs are post-filtered |

**Org-level config file** (hard-wired, not user-configurable):
- Windows: `%PROGRAMDATA%\AtlassianMCP\org.env`
- Linux/macOS: `/etc/atlassian-dc-mcp/org.env`

Uses the same `KEY=value` dotenv format. Org entries are merged with user entries on every `getProductRuntimeConfig` call (lazy, cached per `initializeRuntimeConfig` cycle).

**Key service methods** (when adding new tools that touch repos/spaces/projects):
- Jira: `service.isProjectExcluded(projectKey)`, `service.projectExclusionError(projectKey)`
- Confluence: `service.isSpaceExcluded(spaceKey)`, `service.spaceExclusionError(spaceKey)`
- Bitbucket: `service.isRepoExcluded(projectKey, repoSlug)`, `service.repoExclusionError(projectKey, repoSlug)`

## Code Style Guidelines
- **TypeScript**: Use strong typing, avoid `any`
- **Imports**: External dependencies first, then internal packages, then local imports
- **Classes**: Max 300 lines of code
- **Functions**: Max 35 lines of code
- **Error Handling**: Use `handleApiOperation` utility from common package
- **Naming**: PascalCase for classes/interfaces, camelCase for variables/functions
- **Composition**: Prefer small, composable functions and classes
- **Comments**: Avoid generic comments, only explain non-obvious solutions
- **APIs**: Use service classes with consistent error handling patterns
- **DRY**: Avoid duplication, extract common code into functions or classes