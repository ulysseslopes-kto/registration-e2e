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
corepack enable             # uses the pnpm version pinned in package.json
pnpm install
pnpm exec cypress install   # downloads the Cypress binary
cp .env.example .env        # .env is gitignored — never commit it
```

`packageManager` in `package.json` pins pnpm, so `corepack` gives everyone the
same version. It matters here: the lockfile is v9 (pnpm 9/10) and installing
with pnpm 8 silently **rewrites it to v6**, producing a ~1500-line diff that
has nothing to do with your change. Also, pnpm 8 rejects this repo's
`pnpm-workspace.yaml` outright (`ERR_PNPM_INVALID_WORKSPACE_CONFIGURATION —
packages field missing or empty`), because the file exists to carry
`onlyBuiltDependencies` — a pnpm 10 setting — not to declare a workspace.

`.env` holds the run's target and, for the integrated suite, its secrets. Only
`.env.example` is committed; the real file is gitignored, same convention as
the Bruno collections in `player-service/http/bruno-flows`.

### Corporate network gotchas

Both commands above hit the network and can fail on a KTO machine for two
unrelated reasons:

1. **`pnpm install` gets a 401 from a private registry** — if this repo (or
   your global pnpm config) points `@kto`/other scopes at KTO's CodeArtifact
   proxy, your local auth token may have expired. Run `pnpm setup:aws`
   (`scripts/setup-aws.sh`) to install/configure the AWS CLI if needed, log
   into SSO if your session expired, and refresh the CodeArtifact token —
   same script mono-fe uses for this.

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
pnpm cypress:open                # interactive, FE_TARGET from .env
pnpm cypress:run                 # headless, every spec of the current mode, FE_TARGET from .env
pnpm cypress:open:local          # interactive, FE_TARGET=local (overrides .env)
pnpm cypress:open:dev            # interactive, FE_TARGET=dev
pnpm cypress:open:pr             # interactive, FE_TARGET=pr (FE_PR still comes from .env)
pnpm cypress:run:local           # headless, FE_TARGET=local
pnpm cypress:run:dev             # headless, FE_TARGET=dev
pnpm cypress:run:pr              # headless, FE_TARGET=pr
pnpm typecheck                   # tsc --noEmit over cypress/ and cypress.config.ts
```

To run a subset of specs instead of a whole mode, pass `--spec` directly —
e.g. `pnpm cypress:run --spec "cypress/e2e/mocked/legacy/**/*.cy.ts"` or
`pnpm cypress:run --spec "cypress/e2e/mocked/new/login/self-excluded.cy.ts"`
(see "Layout" below for the full tree).

### Which app the run points at (`FE_TARGET`)

`baseUrl` is resolved at startup, not hardcoded — a preview URL pinned in the
config dies the moment its PR closes, taking every spec with it. Three named
targets, set in `.env` (see `.env.example`) or exported per command:

```bash
FE_TARGET=pr FE_PR=2170      pnpm cypress:run   # that PR's Amplify preview — publicly reachable
FE_TARGET=local              pnpm cypress:run   # http://localhost:8000 — needs `pnpm --filter core dev` in your mono-fe checkout
FE_TARGET=dev                pnpm cypress:run   # https://www.kto-dev.com — REQUIRES VPN
CYPRESS_BASE_URL=https://…   pnpm cypress:run   # escape hatch, ignores the two above
```

**There is no default target, on purpose.** `www.kto-dev.com` sits behind
Cloudflare and answers `403` to everything from outside the corporate network —
so does `api.kto-dev.com` and `boapi.kto-dev.com`. Off VPN, a run against `dev`
fails in every spec's `before each` on `cy.visit()`: 58 red tests for a reason
that has nothing to do with any of them. Naming the target is cheaper than
debugging that. The Amplify previews, by contrast, *are* publicly reachable,
which is what makes them the target a CI runner can use with no VPN at all.

An invalid target, a missing one, or `FE_TARGET=pr` without `FE_PR`, fails at
startup with a message saying what to do rather than a confusing `undefined`
baseUrl. Every run prints a one-line banner with the resolved target, mode and
backend — flagging VPN when the combination needs it — before it starts.

All three targets build with `GATSBY_KTO_API=https://api.kto-dev.com`
(`apps/core/.env.development` and `.env.amplify`), so **switching FE target
never changes anything on the backend side of a run** — one test identity, one
test-support host and one set of GrowthBook values serve all three.

`FE_TARGET=local` also gets a longer `pageLoadTimeout` (120s): `gatsby develop`
compiles a page on first request, so the very first `cy.visit('/registro/')`
can take far longer than it does against a built deploy.

### Two tracks: `mocked` (default) and `integrated` (`CY_MODE`)

```bash
pnpm cypress:run                       # CY_MODE=mocked — every business endpoint intercepted
CY_MODE=integrated pnpm cypress:run    # real backend on dev/stg — see "Integrated suite" below
```

`specPattern` follows the mode, so an integrated spec can never be picked up by
an accidental run of the fast track (and vice versa):

| Mode | Specs | Shared mutable data | Fit for a PR gate |
|---|---|---|---|
| `mocked` | `cypress/e2e/mocked/**` | no | **yes** |
| `integrated` | `cypress/e2e/integrated/**` | yes (one test identity) | no — scheduled/on-demand |

VPN is a property of the **target**, not of the mode: `local` and `pr` need
none, `dev` always does. `integrated` needs it on top of that regardless of
target, because `/test-support/**` is only routed on the internal gateway. So
`mocked` + `pr` is the only combination that runs from anywhere — which is
exactly the one a PR gate wants.

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

Every spec lives at the intersection of two independent axes — **how** the
backend is reached (top level) and **which** UI is under test (second
level):

```
cypress/
├── e2e/
│   ├── mocked/          # CY_MODE=mocked — every business call intercepted, no VPN
│   │   ├── legacy/      # pre-KIB-8932 UI, still live whenever
│   │   │   └── login/   # fe_igp_registration_new_ui_experience is off
│   │   └── new/         # "Registration 2026" (KIB-8932) — current login/register UI
│   │       ├── login/
│   │       └── registration/
│   └── integrated/      # CY_MODE=integrated — same UI, driven against the REAL
│       ├── legacy/      # backend on dev/stg (see below). No cy.intercept() on any
│       └── new/         # business endpoint — only cy.request() in commands/api.ts,
│                         # for setup/teardown against the internal gateway
├── fixtures/
│   └── registration/    # stubbed GrowthBook features response (mocked suite only)
└── support/
    └── commands/        # commands/api.ts — integrated suite's cy.request layer
```

- **`mocked/` vs `integrated/` — how the backend is reached.** `mocked/`
  stubs every business endpoint with `cy.intercept()` (via commands like
  `stubCpfCheck`, `stubLogin`, `stubRegister`, …), so it needs no VPN and is
  safe to gate a PR on (see the table above). `integrated/` never intercepts
  a business endpoint — the browser calls the real API directly, and the
  only network mocking anywhere in that tree is one deliberate, narrowly
  scoped exception per flow for the e-mail/phone OTP screens (a real code
  goes to a real inbox/phone nothing in CI can read — see "E-mail
  verification cannot be driven through the UI" below). `cy.request()` calls
  in `commands/api.ts` are a different thing entirely: Node-side setup/
  teardown against the internal test-support gateway, not a stub of
  anything the browser does.
- **`legacy/` vs `new/` — which UI is under test.** `new/` is the current
  "Registration 2026" (KIB-8932) login/register flow — `AuthLandingRoute`/
  `modules/registration`'s `useAccountCreate`, rendered whenever
  `fe_igp_registration_new_ui_experience` is on. `legacy/` is the
  pre-KIB-8932 single-form login (`LoginContent`) and multi-step register
  (`RegisterContent`) — a different component tree entirely, with different
  DOM selectors (`#input-new-username`, `#national_id`, `#otp-input`, `#cep`,
  …), still rendered whenever that flag is off. The two share most backend
  endpoints (`/auth/login`, `/registration/email/*`, `/registration/v4`),
  but the CPF check and phone verification each have a legacy-only endpoint
  (see "Legacy flow" below).

The two trees aren't a 1:1 mirror of each other — `integrated/` stays to one
file per flow (a single happy path proving FE and BE agree end to end),
while `mocked/` splits the same ground into one file per behavior/condition,
since only the latter needs to cover every branch cheaply.

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
| `login/login.cy.ts` | 01 Login | LOGIN-01..04, 07, 08 (05/06 skipped) |
| `cpf.cy.ts` | 02 CPF step | CPF-01..08 |
| `email-verification.cy.ts` | 03 E-mail verification | EMAIL-01..08 (09/10 skipped) |
| `password.cy.ts` | 04 Password step | PW-01..05 |
| `phone.cy.ts` | 05 Phone step | PHONE-01..03, 05 (04 skipped) |
| `orchestration.cy.ts` | 06 Orchestration & flags | ORCH-01..04, 06..08 (05 skipped) |
| `shell.cy.ts` | 07 Shared shell & UI | SHELL-01, 03, 05 (02/04 skipped) |
| `account-create.cy.ts` | — | Standalone full-flow smoke test |
| `mixpanel-tracking.cy.ts` | — | Mixpanel events fired along the flow (not in the original matrix) |
| `login/self-excluded.cy.ts` | — | Migratable/self-exclusion conditions, isolated (not in the original matrix — see below) |

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

### New login's migratable/self-exclusion check (`cypress/e2e/registration/login/self-excluded.cy.ts`)

Kept in its own file inside `cypress/e2e/registration/login/`, alongside
`login.cy.ts` (the LOGIN-01..08 matrix specs) but separate, so these
conditions can run in isolation
(`pnpm cypress:run:registration:self-excluded`). `AuthLandingRoute.js`'s
`onLogin` awaits `getUserMigratableStatus`
(`POST /registration/user/is-migrateable`, `cy.stubMigratableStatus`) before
ever calling `doLogin`, same idea as the legacy flow's equivalent below —
but the actual behavior differs: this flow has **no migration modal yet**
(explicit TODO in `AuthLandingRoute.js`), so a migratable account just logs
in normally regardless of its self-exclusion status (`getSelfExclusionMessage`,
`modules/registration/src/features/auth-landing/self-exclusion.ts`, returns
early on `isMigratable` before ever looking at `isSelfExcluded`). Only a
genuinely self-excluded, non-migratable account is blocked — with the
`AccountRestrictionModal` (`role="dialog"`, toggles an `opacity-0`/
`opacity-100` class rather than `display: none`, so assert on that class,
not bare `.should('be.visible')`).

## Legacy flow (`cypress/e2e/legacy/`)

Covers the pre-KIB-8932 single-form login (`LoginContent`) and every step of
the multi-step register (`RegisterContent`: `EmailAndPasswordStep` →
`EmailVerificationStep` → `PhoneVerificationStep` → `CepAddressStep`) that
`apps/core` renders whenever `fe_igp_registration_new_ui_experience` is
off — a different component tree from the new flow, with different DOM
selectors (`#input-new-username`, `#national_id`, `#otp-input`, `#cep`,
`#nextBtn1`, ...). Most backend endpoints are shared with the new flow
(`stubLogin`/`stubEmailCheck`/`stubSendToken`/`stubValidateToken`/
`stubRegister`/`stubMigratableStatus` all work unmodified); two are
legacy-only: `stubLegacyCpfCheck` (`/registration/cpf/check/v3`, not the new
flow's `/cpf-checks/v4`) and `stubLegacySmsSend`/`stubLegacySmsValidate`
(phone verification has no new-flow equivalent at all — the new flow's
phone step is a plain field, no OTP). The address step's CEP →
street/state/city autofill is deliberately left un-stubbed and driven with
a real, well-known CEP (Av. Paulista, São Paulo) — it and the state/city
dropdowns it validates against both come from the same real backend, so a
hand-rolled CEP response risks a name mismatch a real one can't.

**This spec needs VPN, and it is the only one that does.** Beyond the CEP
above, `useRegisterData`'s `initNationalities()`
(`apps/core/src/hooks/useRegisterData.js`) fills the `#nationality` dropdown
from a real API call and swallows the failure (`if (!ok) return`), so off the
corporate network the dropdown is simply empty and
`cy.select('Brasileira')` fails — taking 5 of this spec's tests with it, for a
reason that has nothing to do with the flow under test. Everything else in the
mocked suite passes from anywhere: 85 of 94 green off VPN, the 6 failures all
here, 3 skipped by design.

**Login's migratable/self-exclusion check** (`cypress/e2e/legacy/login/self-excluded.cy.ts`,
`pnpm cypress:run:legacy:self-excluded`) — kept in its own file, alongside
`login.cy.ts` (the plain-login behavior) but separate, so these conditions
can be run in isolation: `onSubmit` awaits
`getUserMigratableStatus` (`POST /registration/user/is-migrateable`) before
ever calling `doLogin` — an unstubbed real response (not migratable, not
excluded, for these throwaway e2e credentials) is what quietly makes the
plain login tests work without stubbing this endpoint at all. Conditions
covered here: self-excluded (blocked with a formatted end-date message, no
login attempt), migratable with a weak password (password-hint error, no
modal), migratable with a valid password (opens the `#register-modal`
migration modal — the same `RegisterContent`/`EmailAndPasswordStep` covered
in `cypress/e2e/mocked/legacy/registration/registration.cy.ts`, this time with `flow:
REGISTER_MODAL_FLOWS.LOGIN`, gated only by the three consent checkboxes), a
realistic full response (migratable, `isSelfExcluded`/`selfExclusionEndDate`
present but `null`), and migratable+self-excluded together (pins down that
`isMigratable` is checked first, so it still opens the migration modal
rather than the self-exclusion message).

The new flow's equivalent is covered separately in
`cypress/e2e/registration/login/self-excluded.cy.ts` (see above) — its
behavior genuinely differs (no migration modal yet), not just its file
location.

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
`cypress/e2e/mocked/legacy/registration/registration.cy.ts`. Worth a real bug report to whoever
still owns this flow.

## Integrated suite (`CY_MODE=integrated`)

The same UI, driven against the real backend on dev — the Cypress counterpart
of the Bruno flows in `player-service/http/bruno-flows` (KIB-8187) and
`auth-service/http/bruno-flows` (KIB-8448), which is where the mechanics below
come from. It exists to prove what neither of the other two layers can:

| Layer | Proves | Runs |
|---|---|---|
| Bruno flows (BE repos) | the API accepts/rejects correctly — 28 `/registration/v4` guards, SIGAP, provider fixtures | manual/scheduled, VPN |
| this repo, `mocked` | the FE reacts correctly to every response shape | **PR gate**, no VPN |
| this repo, `integrated` | FE and BE **agree** — request contract, `messageCode`s, resulting player state | scheduled/on-demand, VPN |

### Topology

The FE talks to the public gateway; setup and teardown talk to the internal
one, which is the only place `/test-support/**` is routed (confirmed in
`gitops/clusters/kto-bet-br-dev/apps/player-service/values.yaml`):

```
browser (UI)  ->  api.kto-dev.com            cpf-checks/v4, registration/v4, auth/login, …
cy.request    ->  boapi.kto-dev.com/player   test-support: recycle, seeds  (VPN required)
cy.request    ->  api.kto-dev.com            registration/email/mark-verified (no VPN)
```

`cy.request` runs in Cypress's Node process — no CORS, no browser sandbox — so
it can reach the internal gateway the page itself cannot.

### What stays stubbed even here

GrowthBook, `/country/check`, `meta.json`, Mixpanel, Smartico/GSI, and the
`send-token`/`validate-token` pair. **Not** the twelve business endpoints.

One rule about the flag fixture: a `fe_`-prefixed flag is FE-only and can be
stubbed to anything, but a flag with **no prefix is read by the backend too**
under the SCREAMING_CASE twin of the same name
(`captcha_registration_solution` ↔ `CAPTCHA_REGISTRATION_SOLUTION`,
`player_registration_national_id_check` ↔ `PLAYER_REGISTRATION_NATIONAL_ID_CHECK`,
`igp_registration_verification_phases` ↔ `IGP_REGISTRATION_VERIFICATION_PHASES`).
Those must mirror the environment's real values — invent one and the FE and the
backend disagree, and the flow fails for a reason that has nothing to do with
the test.

### E-mail verification cannot be driven through the UI

The real OTP is a 4-digit code delivered to a mailbox nothing here can read.
`cy.markEmailVerified()` is the way through — `POST
/registration/email/mark-verified`, the same automation path the Bruno flows
use, exposed on the public gateway. Hiding the step in the UI with
`visible: false` does **not** work: `/registration/v4` still rejects a
pre-registration without a verified e-mail ("Email cannot be null", pinned by
guard 02 of `flow-1n-registration-guards`).

### Test identity, and cleaning up after it

One fixed CPF (`FLOW_TEST_CPF`) with epoch-derived e-mail and mobile, recycled
between runs — `cy.recyclePlayer()`, i.e. `DELETE
/test-support/players/{nationalId}`. Same scheme as the Bruno flows, with two
differences that come from Cypress rather than Bruno:

- **Clean before *and* after.** Mocha's `after` does not run when the browser
  crashes or the run is interrupted; Bruno gets away with a single trailing
  `99-cleanup` only because its runner is strictly linear. Pass
  `{ expectClean: true }` on the `beforeEach` call to get a loud log when the
  identity *was* dirty, i.e. when a previous run died mid-way.
- **Don't parallelise.** Specs inside one `cypress run` are already sequential;
  parallelism only arrives with `--parallel` + Cypress Cloud, so the fix is
  simply never to enable it here. The collision that actually bites is two
  people running the same CPF at the same time — hence one CPF per machine, in
  each person's own `.env`.

Every seed (`cy.seedJudicialExclusion`, `cy.seedBlacklistEmail`) **must** be
cleared in the same spec, with the recycle as the safety net — a leaked seed
contaminates the environment for everyone. Keep blacklist patterns narrow
enough to match only this suite's own addresses, the way the Bruno flow uses a
throwaway domain.

`recyclePlayer` frees the identity; it is not erasure. The backend tombstones
`national_id`/`email`/`username`/`mobile_number` on the `users` row, closes the
account, deletes the Keycloak user and removes a leftover pre-registration —
but the CPF still reached anti-fraud (with the provider's real name/DOB),
SIGAP, the `PlayerRegisteredEvent` Kafka stream and the service logs, none of
which any cleanup touches. Worth knowing before choosing which CPF to use.

### Guards

`cypress.config.ts` refuses to start an integrated run when `FLOW_TEST_CPF`,
`FLOW_USER_PASSWORD` or `TEST_SUPPORT_API_KEY` is missing, or when the resolved
internal gateway is not an allow-listed dev/stg host — the client-side mirror of
the backend's own fail-closed `TestSupportGuard`. Both fail at config time, not
three steps into a journey that has already written data.

Before the first run, three things are worth checking on the environment:

1. GrowthBook: are `CAPTCHA_CPFCHECK_FEATURE`,
   `CAPTCHA_EMAIL_VERIFICATION_FEATURE` and `CAPTCHA_REGISTRATION_FEATURE` off?
   `CaptchaValidateTokenService.validate()` returns success before it ever looks
   at a token when the endpoint's flag is off, which is the cheapest way past
   captcha. The `x-kto-automation` header the Bruno flows use is **not** an
   option from the browser: the public gateway's `accessControlAllowHeaders`
   does not list it, so the CORS preflight kills the request.
2. Is the test-support layer live?
   `curl -s https://boapi.kto-dev.com/player/v3/api-docs | grep -c test-support`
   → `1`. Note the account **status** and **lock** seeders live on a separate
   branch, and kyc-service has its own test-support layer — check both before
   relying on the sensitive-login scenarios.
3. A test CPF that is valid in the anti-fraud provider's sandbox **with
   complete basic data** — a CPF with no name/DOB there makes the
   `/registration/v4` enrichment fail, which looks like a test bug and isn't.

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
  AdOpt appears to revalidate consent against its own backend, and can
  re-show the banner more than once in the same test). Clicks the real
  "Aceitar" button (`#adopt-accept-all-button`) if present, a no-op
  otherwise. Cheap enough to call at every point the banner has actually
  been seen covering something: right after `cy.visit()` (`startRegistration()`
  does this automatically), right before a click near where it could cover
  the page, and again after a response that re-renders the page (e.g. right
  after `cy.wait()`-ing on a network stub) — see
  `cypress/e2e/registration/login/self-excluded.cy.ts` for a spec that needs
  all three.
- `cy.startRegistration()` — accept cookies → visit `/registro/` directly
  (skips the home page, so tests don't depend on its marketing banners) →
  `dismissCookieBannerIfVisible()`.
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
  These are the one part of the support layer both modes share: driving the UI
  is identical whether the backend behind it is stubbed or real.

## Backend commands (`cypress/support/commands/api.ts`)

Integrated suite only (`CY_MODE=integrated`), and all `cy.request` rather than
`cy.intercept` — see "Integrated suite" above for the topology and the rules
around cleanup. Declared in both modes, since declaring a command costs nothing
until it is called.

- `cy.recyclePlayer(nationalId?, { expectClean? })` — frees the test identity
  for the next run (`DELETE /test-support/players/{nationalId}`). Idempotent,
  200 even with nothing to recycle, so it is safe to call defensively — and it
  should be called in `beforeEach` *and* `after`, not just `after`. Yields the
  backend's report (`userRecycled`, `preRegistrationDeleted`) or `null` when the
  call failed, in which case it logs loudly instead of failing the test.
  `expectClean: true` logs a warning when the identity *was* dirty on entry,
  i.e. a previous run died before cleaning up.
- `cy.markEmailVerified(email, nationalId?)` — the automation path past e-mail
  verification (`POST /registration/email/mark-verified`, public gateway, no
  VPN). Body is snake_case, matching the backend DTO.
- `cy.freshIdentity()` — yields `{ cpf, email, mobile, password }`: fixed CPF
  (the recycle is what frees it), epoch-derived e-mail and mobile so two runs
  never collide on the unique columns.
- `cy.seedJudicialExclusion(nationalId?)` / `cy.clearJudicialExclusion(nationalId?)`
  — TEST-ONLY seed reaching the judicial branch of registration. Every seed
  MUST be cleared in the same spec.
- `cy.seedBlacklistEmail(pattern)` / `cy.clearBlacklistEmail(id)` — blacklists
  an e-mail pattern, yielding the row id needed to remove it. Keep the pattern
  narrow enough that only this suite's own addresses can match it.
- `cy.pollUntil(description, predicate, { attempts?, waitMs? })` — bounded
  retry for state the platform only reaches asynchronously (the KYC player is
  created by a Kafka consumer, so there is nothing to wait on synchronously).
  The Cypress equivalent of the Bruno flows' `bru.setNextRequest` self-loops;
  `description` is what the timeout message names, so a failure reads as a
  diagnosis.
