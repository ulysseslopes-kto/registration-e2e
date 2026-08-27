# registration-e2e

Cypress e2e project covering the "Registration 2026" login and
account-create flows (mono-fe, KIB-8932), driven against `apps/core`'s dev
server from the main `mono-fe` repo, following the
"Matriz de Testes — Registro 2026" test matrix.

This project was extracted from `apps/e2e` inside the mono-fe monorepo into
its own repo/history. It still targets the same app — you need a checkout of
mono-fe running its `core` app locally to actually run these specs against.

## Setup

```bash
pnpm install
pnpm exec cypress install   # downloads the Cypress binary
```

### Corporate network gotchas

Both commands above hit the network and can fail on a KTO machine for two
unrelated reasons:

1. **`pnpm install` gets a 401 from a private registry** — if this repo (or
   your global pnpm config) points `@kto`/other scopes at KTO's CodeArtifact
   proxy, your local auth token may have expired. Refresh it the same way you
   do for any other KTO project (SSO login / `aws codeartifact login`
   equivalent).

2. **`cypress install` fails with `self-signed certificate in certificate
   chain`** — the corporate proxy does TLS inspection on
   `download.cypress.io`, and Node doesn't trust that certificate by
   default. Point Node at the corporate root CA before installing:

   ```bash
   security find-certificate -a -p /Library/Keychains/System.keychain > ~/corp-ca.pem
   export NODE_EXTRA_CA_CERTS=~/corp-ca.pem
   pnpm exec cypress install
   ```

   Add `export NODE_EXTRA_CA_CERTS=~/corp-ca.pem` to your shell profile so
   it's set for future installs (Cypress binary upgrades, other tools that
   download over HTTPS, etc). Don't reach for
   `NODE_TLS_REJECT_UNAUTHORIZED=0` instead — that disables TLS certificate
   validation entirely and is not a safe substitute.

### `ELECTRON_RUN_AS_NODE` breaks Cypress

If `cypress verify`/`cypress open`/`cypress run` fails with something like:

```
Cypress.app/Contents/MacOS/Cypress: bad option: --no-sandbox
Cypress.app/Contents/MacOS/Cypress: bad option: --smoke-test
```

check for the `ELECTRON_RUN_AS_NODE` environment variable:

```bash
env | grep ELECTRON_RUN_AS_NODE
```

If it's set (some editor/tooling integrations set it globally so their own
Electron-based processes run as plain Node), it forces *any* Electron
binary — including Cypress's — to start as a headless Node process instead
of the real Electron/Chromium runtime. Cypress then tries to parse its own
Chromium flags with Node's arg parser, which is exactly the "bad option"
error above.

Fix: `unset ELECTRON_RUN_AS_NODE` in the shell you run Cypress from. The
`cypress:open`/`cypress:run`/`test:e2e` scripts run `scripts/check-env.sh`
first and fail fast with a clear message if it's still set, instead of the
cryptic Cypress error.

## Running

```bash
# terminal 1 — the app under test, from your mono-fe checkout
pnpm --filter core dev            # http://localhost:8000 (or your configured port)

# terminal 2 — Cypress, from this repo
pnpm cypress:open     # interactive
pnpm cypress:run      # headless
```

`baseUrl` in `cypress.config.ts` must match whatever port `apps/core` is
actually running on locally.

## Layout

```
cypress/
  e2e/registration/        # spec files, one per area of the test matrix
  fixtures/registration/   # stubbed GrowthBook features response
  fixtures/adopt-consent.json  # captured AdOpt cookie value (see below)
  support/                 # commands.ts, e2e.ts
```

`cypress/support/e2e.ts` also has a global `beforeEach` that runs before
every spec, stubbing:
- `GET **/meta.json**` — apps/core's own new-deploy-check request, so no test
  depends on that build artifact existing or matching.
- Two third-party scripts loaded unconditionally on every page when `baseUrl`
  points at a real deployed build (not `gatsby develop`): Smartico and Google
  Identity Services (`accounts.google.com/gsi`). Neither is exercised by any
  spec — see the comments in `e2e.ts` for why each is safe to block outright.
  GTM and AdOpt (goadopt.io) are deliberately *not* blocked, even though
  they're also unused: AdOpt loads inside the GTM container on a real build,
  and it's AdOpt's own script that reads the `AdoptConsent` cookie
  (`acceptCookieBanner()`) to suppress its banner — block either one and the
  banner stays on screen, covering the page underneath it.

Specs map to the "Matriz de Testes — Registro 2026" (KIB-8932) sections:

| Spec | Matrix section | Cases |
|---|---|---|
| `login.cy.ts` | 01 Login | LOGIN-01..04, 07, 08 (05/06 skipped) |
| `cpf.cy.ts` | 02 CPF step | CPF-01..08 |
| `email-verification.cy.ts` | 03 E-mail verification | EMAIL-01..08 (09/10 skipped) |
| `password.cy.ts` | 04 Password step | PW-01..05 |
| `phone.cy.ts` | 05 Phone step | PHONE-01..03, 05 (04 skipped) |
| `orchestration.cy.ts` | 06 Orchestration & flags | ORCH-01..04, 06..08 (05 skipped) |
| `shell.cy.ts` | 07 Shared shell & UI | SHELL-01, 03, 05 (02/04 skipped) |
| `account-create.cy.ts` | — | Standalone full-flow smoke test |
| `mixpanel-tracking.cy.ts` | — | Mixpanel events fired along the flow (not in the original matrix) |

**Skipped, and why** — each is called out in its spec file's header comment too:
- **Google SSO** (LOGIN-05/06, EMAIL-09/10): `useGoogleLogin` opens a real
  Google OAuth popup; Cypress cannot drive cross-origin popups or a real
  Google account.
- **PHONE-04** (accessible name without a visible label): needs axe-core or
  a real screen reader to verify meaningfully, not a plain DOM assertion.
- **ORCH-05** (SSO always skips e-mail verification): reaching the flow with
  `verifiedEmail` set requires either the real Google OAuth exchange above,
  or React Router history *state* set by `navigate(path, { state })` — not
  reproducible via a plain `cy.visit()`.
- **SHELL-02/04** (CMS marketing-banner variants): `MarketingBanner`'s
  `useBanners` resolves via Gatsby's build-time GraphQL static query, not a
  runtime fetch — there's no network request to intercept from the browser.

**SHELL-05 is a regression test, now fixed and green**: it caught
`apps/core/src/templates/onBoarding/register.js` rendering the legacy
register form on every direct visit until GrowthBook resolved (no readiness
guard, unlike `login.js`'s `FlagLoadingScreen` — see LOGIN-07). That's fixed
in mono-fe; the test now asserts the legacy form never appears.

## Custom commands (`cypress/support/commands.ts`)

- `cy.stubGrowthbookFeatures(overrides?)` — intercepts the GrowthBook
  features request with `fixtures/registration/growthbook-features.json`,
  shallow-merging `overrides` onto its `features` map (pass `{ flagKey:
  null }` to simulate a flag being entirely absent). Call before
  `cy.visit()`.
- `cy.acceptCookieBanner()` — sets the `AdoptConsent` cookie AdOpt
  (goadopt.io) itself writes once accepted (captured once in
  `fixtures/adopt-consent.json`), so specs don't depend on that third-party
  banner script loading and rendering before every test.
- `cy.startRegistration()` — accept cookies → visit `/registro/` directly
  (skips the home page, so tests don't depend on its marketing banners).
- `cy.stubCpfCheck()`, `stubEmailCheck()`, `stubSendToken()`,
  `stubValidateToken()`, `stubSocialSignIn()`, `stubMarkVerified()`,
  `stubRegister()`, `stubLogin()` — one intercept per backend endpoint the
  flow can call (mono-fe's `packages/core-api/src/adapters/auth.ts`), each
  taking overrides to simulate rejections/errors/messageCodes.
- `cy.fillCpfStep()`, `fillPasswordStep()`, `selectEmailVerificationMethod()`,
  `selectGoogleVerificationMethod()`, `fillEmailStep()`, `fillOtp()` — fill
  and submit one step, assuming its network stub (if any) is already set up.
