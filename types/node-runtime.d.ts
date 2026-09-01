/**
 * The few Node built-ins `cypress.config.ts` uses, declared locally instead of
 * pulling in `@types/node`.
 *
 * Deliberate trade: this repo has exactly two dependencies, and its README
 * documents `pnpm install` as the most fragile step of setup (a private-registry
 * 401 or a TLS-inspection failure on a KTO machine). Adding a types-only
 * package to satisfy one config file would also mean touching the lockfile —
 * which is v9, and gets silently rewritten to v6 by any pnpm 8 install. Ten
 * lines of ambient declarations avoid all of that and stay precisely typed
 * (nothing here is `any`).
 *
 * If the repo ever grows real Node-side code — a plugin, a task, a reporter —
 * swap this for `@types/node` and delete the file; at that point the dependency
 * earns its place.
 */

declare const process: {
  env: Record<string, string | undefined>
}

declare const __dirname: string

declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  export function resolve(...segments: string[]): string
}
