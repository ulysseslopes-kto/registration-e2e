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
pnpm cypress:open                # interactive
pnpm cypress:run                 # headless, every spec
pnpm cypress:run:registration    # headless, just the behavioral flow specs
pnpm cypress:run:translations    # headless, just the copy/i18n checks
pnpm cypress:run:legacy          # headless, just the pre-KIB-8932 flow
```

`baseUrl` in `cypress.config.ts` must match whatever port `apps/core` is
actually running on locally.

### Default viewport is mobile (iPhone X)

`viewportWidth`/`viewportHeight` in `cypress.config.ts` are set to iPhone
X's dimensions (375×812) — most users hit this flow on a phone, so that's
the default every spec runs at unless it calls `cy.viewport(...)` itself.
A handful of tests (one per spec file, named `... (desktop)`) explicitly
override to `cy.viewport(1000, 660)` — Cypress's own pre-4.x default — to
also catch layout/interaction regressions on a larger screen along the same
path. Don't add more of those without a reason; the point is that desktop
coverage is the exception here, not the default.

## Layout

```
cypress/
  e2e/registration/        # spec files, one per area of the test matrix
  e2e/translations/        # copy/i18n checks, isolated from the matrix specs
                            # (see cypress:run:translations above) — CMS copy
                            # changes independently of flow behavior, so it's
                            # kept out of the specs it would otherwise flake
  e2e/legacy/               # pre-KIB-8932 login/register flow (still live
                            # whenever fe_igp_registration_new_ui_experience
                            # is off), isolated from the new-flow matrix specs
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

## Legacy flow (`cypress/e2e/legacy/`)

Covers the pre-KIB-8932 single-form login (`LoginContent`) and every step of
the multi-step register (`RegisterContent`: `EmailAndPasswordStep` →
`EmailVerificationStep` → `PhoneVerificationStep` → `CepAddressStep`) that
`apps/core` renders whenever `fe_igp_registration_new_ui_experience` is
off — a different component tree from the new flow, with different DOM
selectors (`#input-new-username`, `#national_id`, `#otp-input`, `#cep`,
`#nextBtn1`, ...). Most backend endpoints are shared with the new flow
(`stubLogin`/`stubEmailCheck`/`stubSendToken`/`stubValidateToken`/
`stubRegister` all work unmodified); three are legacy-only:
`stubLegacyCpfCheck` (`/registration/cpf/check/v3`, not the new flow's
`/cpf-checks/v4`), `stubLegacySmsSend`/`stubLegacySmsValidate` (phone
verification has no new-flow equivalent at all — the new flow's phone step
is a plain field, no OTP), and `stubMigratableStatus`
(`/registration/user/is-migrateable`, login's pre-login migratable/
self-exclusion check — also has no new-flow equivalent yet, see below). The
address step's CEP → street/state/city autofill is deliberately left
un-stubbed and driven with a real, well-known CEP (Av. Paulista, São
Paulo) — it and the state/city dropdowns it validates against both come
from the same real backend, so a hand-rolled CEP response risks a name
mismatch a real one can't.

**Login's migratable/self-exclusion check**: every legacy login test stubs
`stubMigratableStatus` — `onSubmit` awaits `getUserMigratableStatus`
(`POST /registration/user/is-migrateable`) before ever calling `doLogin`, so
an unstubbed real response (not migratable, not excluded, for these
throwaway e2e credentials) is what quietly made the plain login tests work
even before this stub existed. Three conditions are covered: self-excluded
(blocked with a formatted end-date message, no login attempt), migratable
with a weak password (password-hint error, no modal), and migratable with a
valid password (opens the `#register-modal` migration modal — the same
`RegisterContent`/`EmailAndPasswordStep` covered in
`cypress/e2e/legacy/register.cy.ts`, this time with `flow:
REGISTER_MODAL_FLOWS.LOGIN`, gated only by the three consent checkboxes).

The new flow's equivalent (`AuthLandingRoute.js`) is mid-implementation on
an **uncommitted local branch** as of writing and currently has a literal
`const isSelfExcluded = true` left in behind a `TEMP-DEBUG(remove before
commit)` comment — every login on that branch would hit the
account-restriction message and never call `doLogin` at all. Not something
this repo can test until that's fixed and actually deployed; flagged here so
it isn't missed.

Two GrowthBook flags are forced on in the fixture purely to reach/exercise
this flow correctly, independent of what this suite actually cares about
testing:
- `registration_new_flow` — see the known issue below.
- `player_registration_national_id_check` — off by default, gates whether
  `EmailAndPasswordStep` calls the CPF check at all; without it the CPF is
  accepted at face value past client-side format validation, and
  `stubLegacyCpfCheck`'s intercept never fires.

The optional Google-sign-in `REGISTER_LOBBY` step (behind
`fe_social_sign_in_enabled`) isn't covered — same scope call as the new
flow's suite skipping Google SSO.

**Known issue, not a test bug**: advancing past the CPF/e-mail/password step
reproducibly crashes the app (`Cannot destructure property
'showUspsBarMobile' of ... as it is undefined`) whenever the
`registration_new_flow` GrowthBook flag is off/absent — this suite's actual
fixture default. Traced to `getLastIndex()` in
`apps/core/src/hooks/useRegistrationSteps.js` (~line 130):
`REGISTRATION_STEPS.findIndex(step => !step.isOldFlow) - 1` evaluates to
`0 - 1 = -1` (no step sets `isOldFlow`, so the first step always matches),
and since `-1` isn't nullish the trailing `?? REGISTRATION_STEPS.length - 1`
fallback never applies — `formStep` ends up `-1`, and
`REGISTRATION_STEPS[-1]` is undefined. This suite forces
`registration_new_flow: true` to route through the other (correct) branch
of that same function and dodge the crash — see the comment in
`cypress/e2e/legacy/register.cy.ts`. Worth a real bug report to whoever
still owns this flow.

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
- `cy.dismissCookieBannerIfVisible()` — real-click fallback for when AdOpt
  renders the banner anyway despite the cookie above (seen intermittently —
  AdOpt appears to revalidate consent against its own backend). Clicks the
  real "Aceitar" button (`#adopt-accept-all-button`) if present, a no-op
  otherwise. Call defensively right before a click that could land on/near
  where the banner covers the page.
- `cy.startRegistration()` — accept cookies → visit `/registro/` directly
  (skips the home page, so tests don't depend on its marketing banners).
- `cy.stubCpfCheck()`, `stubEmailCheck()`, `stubSendToken()`,
  `stubValidateToken()`, `stubSocialSignIn()`, `stubMarkVerified()`,
  `stubRegister()`, `stubLogin()` — one intercept per backend endpoint the
  flow can call (mono-fe's `packages/core-api/src/adapters/auth.ts`), each
  taking overrides to simulate rejections/errors/messageCodes.
- `cy.stubLegacyCpfCheck()` — the legacy register flow's CPF check
  (`/registration/cpf/check/v3`), a different endpoint from `stubCpfCheck`'s
  new-flow `/cpf-checks/v4`. Legacy-flow specs only.
- `cy.stubLegacySmsSend()`, `stubLegacySmsValidate()` — the legacy register
  flow's phone-verification step (send/validate SMS code) — no new-flow
  equivalent exists. Legacy-flow specs only.
- `cy.stubMigratableStatus(overrides?)` — the legacy login flow's pre-login
  migratable/self-exclusion check (`/registration/user/is-migrateable`).
  Defaults to not-migratable/not-excluded; pass `{ migrateable: true }` or
  `{ isSelfExcluded: true, selfExclusionEndDate }` to simulate either
  condition. Legacy-flow specs only.
- `cy.fillCpfStep()`, `fillPasswordStep()`, `selectEmailVerificationMethod()`,
  `selectGoogleVerificationMethod()`, `fillEmailStep()`, `fillOtp()` — fill
  and submit one step, assuming its network stub (if any) is already set up.
