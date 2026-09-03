import { defineConfig } from 'cypress'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Minimal `.env` loader. Cypress does not read `.env` on its own (Bruno does,
 * which is why the collections can rely on it), and adding a dependency is a
 * poor trade here — `pnpm install` against the corporate proxy is the flakiest
 * step in this repo's setup (see README), so 15 lines beat one more package.
 *
 * Already-exported variables win, so CI can pass values with no file at all.
 * `KEY=value` is read literally: comments and blanks skipped, one pair of
 * surrounding quotes stripped, trailing CR removed (a `.env` saved by Notepad
 * on Windows otherwise glues `\r` to every value — the same trap the Bruno
 * README documents).
 */
function loadDotEnv(file = '.env'): void {
  const path = resolve(__dirname, file)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    if (key === '' || process.env[key] !== undefined) continue
    const raw = trimmed.slice(separator + 1).trim().replace(/\r$/, '')
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadDotEnv()

/**
 * The app under test is mono-fe's `core` app, which we point at one of three
 * deployments. All three build with `GATSBY_KTO_API=https://api.kto-dev.com`
 * (`apps/core/.env.development` and `.env.amplify`), so switching FE target
 * never changes anything on the backend side of a run — one test CPF, one
 * test-support host and one set of GrowthBook values serve all three.
 *
 *   FE_TARGET=local             -> gatsby develop on this machine
 *   FE_TARGET=pr FE_PR=2170     -> that PR's Amplify preview
 *   FE_TARGET=dev               -> the shared dev site — REQUIRES VPN
 *   CYPRESS_BASE_URL=<url>      -> escape hatch, ignores the two above
 *
 * There is deliberately NO default. `www.kto-dev.com` sits behind Cloudflare
 * and answers 403 to everything off VPN, which makes every spec fail in its
 * `before each` on `cy.visit()` — 58 red tests for a reason that has nothing
 * to do with any of them. Better to say which target you meant. The Amplify
 * previews, by contrast, are publicly reachable, which is why they are the
 * target a CI runner can use without VPN.
 */
const FE_TARGETS: Record<string, (pr?: string) => string> = {
  local: () => 'http://localhost:8000',
  dev: () => 'https://www.kto-dev.com',
  pr: (pr) => `https://pr-${pr}.d2xauiex3dlsqs.amplifyapp.com`,
}

/** Targets that only resolve from inside the corporate network. */
const VPN_ONLY_TARGETS = new Set(['dev'])

/**
 * Two tracks, deliberately separated (see README):
 * - `mocked` intercepts every business endpoint. No VPN, no shared mutable
 *   data — the suite that can gate a PR.
 * - `integrated` drives the same UI against the real backend on dev/stg.
 *   Needs VPN (test-support lives only on the internal gateway) and a test
 *   identity it recycles, so it is scheduled/on-demand, never a PR gate.
 *
 * The spec pattern follows the mode, so an integrated spec can never be picked
 * up by an accidental `cypress run` in the fast track.
 */
const MODES = ['mocked', 'integrated'] as const
type Mode = (typeof MODES)[number]

const SPEC_PATTERNS: Record<Mode, string> = {
  mocked: 'cypress/e2e/mocked/**/*.cy.ts',
  integrated: 'cypress/e2e/integrated/**/*.cy.ts',
}

/**
 * Internal gateways the integrated suite may touch. The test-support layer is
 * fail-closed on the backend (its beans only load when
 * `test-support.environment` is local/dev/stg), and this is the symmetric
 * guard on the client side — a prd host never even gets a request.
 */
const ALLOWED_INTERNAL_HOSTS = [
  'https://boapi.kto-dev.com',
  'https://boapi.kto-stg.com',
]

function fail(message: string): never {
  throw new Error(`[registration-e2e] ${message}`)
}

function resolveMode(): Mode {
  const mode = process.env.CY_MODE ?? 'mocked'
  if (!(MODES as readonly string[]).includes(mode)) {
    fail(`invalid CY_MODE: "${mode}". Use: ${MODES.join(' | ')}`)
  }
  return mode as Mode
}

function resolveTarget(): {
  label: string
  baseUrl: string
  needsVpn: boolean
} {
  if (process.env.CYPRESS_BASE_URL) {
    return {
      label: 'CYPRESS_BASE_URL',
      baseUrl: process.env.CYPRESS_BASE_URL,
      needsVpn: false,
    }
  }
  const target = process.env.FE_TARGET
  if (!target) {
    fail(
      `FE_TARGET is not set. Use: ${Object.keys(FE_TARGETS).join(' | ')} ` +
        `(e.g. FE_TARGET=pr FE_PR=2170) — or set it in .env, see .env.example. ` +
        `There is no default on purpose: "dev" requires VPN and answers 403 to ` +
        `everything without it, which makes every spec fail on cy.visit() for a ` +
        `reason that has nothing to do with the spec.`,
    )
  }
  const resolve = FE_TARGETS[target]
  if (!resolve) {
    fail(
      `invalid FE_TARGET: "${target}". Use: ${Object.keys(FE_TARGETS).join(' | ')}`,
    )
  }
  if (target === 'pr' && !process.env.FE_PR) {
    fail('FE_TARGET=pr requires FE_PR=<mono-fe PR number>')
  }
  const pr = process.env.FE_PR
  return {
    label: target === 'pr' ? `pr(${pr})` : target,
    baseUrl: resolve(pr),
    needsVpn: VPN_ONLY_TARGETS.has(target),
  }
}

/**
 * Fails at config time, not inside a test — a missing key or a non-dev host is
 * a setup mistake, and finding out three steps into a journey that has already
 * written data is strictly worse.
 */
function assertIntegratedEnv(env: Record<string, string>): void {
  const required = ['testCpf', 'flowPassword', 'testSupportKey'] as const
  const missing = required.filter((key) => !env[key])
  if (missing.length > 0) {
    fail(
      `CY_MODE=integrated requires ${missing.join(', ')} in .env — see .env.example`,
    )
  }
  if (!ALLOWED_INTERNAL_HOSTS.some((host) => env.internalApi?.startsWith(host))) {
    fail(
      `internalApi "${env.internalApi}" is not a dev/stg gateway — integrated ` +
        `suite blocked (allowed: ${ALLOWED_INTERNAL_HOSTS.join(', ')})`,
    )
  }
}

const mode = resolveMode()
const target = resolveTarget()

export default defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    baseUrl: target.baseUrl,
    specPattern: SPEC_PATTERNS[mode],
    supportFile: 'cypress/support/e2e.ts',
    retries: { runMode: 0, openMode: 0 },
    // `gatsby develop` compiles a page on first request, so the very first
    // visit against a local target can take far longer than a built deploy.
    pageLoadTimeout: target.label === 'local' ? 120_000 : 60_000,
    // Mobile-first default: most users hit this flow on a phone, so every
    // spec runs at iPhone X's dimensions unless it explicitly overrides with
    // `cy.viewport(...)` — only a handful of tests do that, to also cover a
    // desktop viewport for their flow.
    viewportWidth: 375,
    viewportHeight: 812,
    env: {
      mode,
      apiUrl: process.env.KTO_API_URL ?? 'https://api.kto-dev.com',
      internalApi: process.env.KTO_INTERNAL_API_URL ?? 'https://boapi.kto-dev.com',
      testCpf: process.env.FLOW_TEST_CPF ?? '',
      testLoginEmail: process.env.FLOW_TEST_LOGIN_EMAIL ?? '',
      flowPassword: process.env.FLOW_USER_PASSWORD ?? '',
      testEmailDomain: process.env.FLOW_TEST_EMAIL_DOMAIN ?? 'kto.com',
      testSupportKey: process.env.TEST_SUPPORT_API_KEY ?? '',
      kycTestSupportKey: process.env.KYC_TEST_SUPPORT_API_KEY ?? '',
    },
    setupNodeEvents(on, config) {
      if (mode === 'integrated') {
        assertIntegratedEnv(config.env as Record<string, string>)
      }

      // One line saying exactly what this run is pointed at — cheap insurance
      // against discovering afterwards that it ran against the wrong thing.
      // Secrets are reported as present/absent, never printed.
      const secrets = config.env.testSupportKey ? 'set' : 'unset'
      const vpn =
        target.needsVpn || mode === 'integrated'
          ? '  (requires VPN — without it the gateway answers 403)'
          : ''
      console.log(
        `\n▸ FE: ${target.label} -> ${target.baseUrl}${vpn}` +
          `\n▸ mode: ${mode}` +
          (mode === 'integrated'
            ? `\n▸ BE: ${config.env.apiUrl} (UI) + ${config.env.internalApi} (test-support, requires VPN)` +
              `\n▸ test-support key: ${secrets}`
            : '\n▸ BE: intercepted (no real business call)') +
          '\n',
      )

      // Chrome's autofill/password-manager can steal focus or interrupt
      // `.type()` mid-keystroke on fields like the e-mail input
      // (autoComplete="email" is a real, deliberate UX feature — kept as-is
      // in the app; this only disables the browser-side behavior inside the
      // isolated Cypress test browser, not in production).
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.family === 'chromium' && browser.name !== 'electron') {
          launchOptions.preferences = {
            ...launchOptions.preferences,
            credentials_enable_service: false,
            password_manager_enabled: false,
          }
          launchOptions.args.push(
            '--disable-features=AutofillServerCommunication,PasswordManagerRedesign',
          )
        }
        return launchOptions
      })

      return config
    },
  },
})
