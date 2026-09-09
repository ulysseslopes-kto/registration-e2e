/**
 * Stubs the GrowthBook features response (apps/core fetches it from
 * `GATSBY_GROWTHBOOK_URL/api/features/GATSBY_GROWTHBOOK_KEY`, see
 * packages/growthbook/src/core.ts) so tests get deterministic flag values
 * instead of whatever is live on the real GrowthBook project. `featureOverrides`
 * is shallow-merged onto the base fixture's `features` map — each key replaces
 * that flag's whole `{ defaultValue }` entry, e.g.:
 * `cy.stubGrowthbookFeatures({ captcha_registration_solution: { defaultValue: 'TURNSTILE' } })`.
 * Also stubs `GET /country/check` (see `stubCountryCheck`) — GrowthBookProvider's
 * `load()` awaits both before `isGrowthBookReady` flips, so a test stubbing one
 * without the other still depends on the real country-check endpoint.
 * Call before `cy.visit()` — GrowthBook fetches its features once on init.
 */
Cypress.Commands.add(
  'stubGrowthbookFeatures',
  (featureOverrides: Record<string, unknown | null> = {}) => {
    cy.stubCountryCheck()
    cy.fixture('registration/growthbook-features.json').then((base) => {
      const features: Record<string, unknown> = {
        ...base.features,
        ...featureOverrides,
      }
      // A `null` override removes the flag entirely, simulating it being
      // absent from GrowthBook so the app falls back to its own default.
      for (const [key, value] of Object.entries(featureOverrides)) {
        if (value === null) delete features[key]
      }
      cy.intercept('GET', '**/api/features/**', {
        ...base,
        features,
      }).as('growthbookFeatures')
    })
  },
)

/**
 * Lets the real GrowthBook features response through and patches one or more
 * keys on the way past — everything else stays whatever is actually live.
 * Unlike `stubGrowthbookFeatures` (which replaces the whole response with the
 * fixture), this is for an integrated spec that needs a flag pinned for
 * determinism — e.g. which UI variant renders — without giving up real flags
 * for everything else. Call before `cy.visit()`.
 *
 * Calling this more than once in the same test (a real pattern — e.g.
 * pinning both `fe_igp_registration_new_ui_experience` and
 * `fe_registration_loss_limits_enabled`) has to *accumulate* overrides, not
 * replace them: each call registers its own `cy.intercept()` on the same
 * `**\/api/features/**` pattern, and Cypress only ever runs the
 * most-recently-registered one that matches — an unaccumulated second call
 * would silently shadow the first key's override entirely, reverting it to
 * whatever's actually live. `growthbookFeatureOverrides` collects every key
 * requested so far *within this test*, and the intercept (re-registered on
 * every call, but always reading the full accumulated set through the
 * closure) applies all of them together — cleared before each test via
 * `test:before:run` so a previous test's overrides never leak into the next.
 */
let growthbookFeatureOverrides: Record<string, unknown> = {}
Cypress.on('test:before:run', () => {
  growthbookFeatureOverrides = {}
})
Cypress.Commands.add('overrideGrowthbookFeature', (key: string, value: unknown) => {
  growthbookFeatureOverrides[key] = value
  cy.intercept('GET', '**/api/features/**', (req) => {
    req.continue((res) => {
      Object.assign(res.body.features, growthbookFeatureOverrides)
      res.send(res.body)
    })
  }).as('growthbookFeatures')
})

/**
 * Stubs `GET /country/check` with a fixed, always-allowed country. Two
 * unrelated consumers read this same response:
 * - `packages/growthbook/src/GrowthBookProvider.tsx` — only needs it to
 *   resolve so `isGrowthBookReady` flips (the new v4 flow's only dependency
 *   on this endpoint).
 * - `apps/core/src/context/authProvider.js`, via `mapCountryCheckToAuthDataCheck`
 *   (`countryCheckMapper.js`) — derives `countryBlocked: !countryCheck.active`
 *   from it. `SplitBannerLayout`/`SplitLayout` (the legacy login/register
 *   pages' wrapper) redirect straight to `/blocked` when that's true, so
 *   `active: true` (plus the two `*_blocked` flags) is required for legacy
 *   specs even though the new flow never reads those fields.
 * Normally called indirectly via `stubGrowthbookFeatures`; call directly only
 * in a test that needs this endpoint covered without also stubbing GrowthBook
 * features.
 */
Cypress.Commands.add('stubCountryCheck', (name = 'Brazil') => {
  cy.intercept('GET', '**/country/check', {
    data: {
      name,
      active: true,
      login_blocked: false,
      registration_blocked: false,
    },
  }).as('countryCheck')
})

/**
 * Suppresses the AdOpt (goadopt.io) cookie-consent banner that apps/core
 * loads on every page — it covers the auth-shell content (e.g. the
 * verification method rows) until accepted. Rather than clicking through the
 * real third-party banner on every test (slow, and flaky under headless/CI
 * timing), this sets the `AdoptConsent` cookie AdOpt itself writes once a
 * human clicks "Aceitar" (captured once in fixtures/adopt-consent.json) —
 * AdOpt sees it as already-answered and never renders the banner. Call
 * before `cy.visit()`.
 */
Cypress.Commands.add('acceptCookieBanner', () => {
  cy.fixture('adopt-consent.json').then((consent) => {
    cy.setCookie('AdoptConsent', consent.AdoptConsent, { secure: true })
  })
})

/**
 * Real-click fallback for when the AdOpt banner renders anyway despite the
 * `AdoptConsent` cookie `acceptCookieBanner()` sets — seen intermittently
 * (AdOpt revalidates consent against its own backend, and can apparently
 * decide to re-show the banner even with a previously-accepted cookie in
 * place). `#adopt-accept-all-button` is AdOpt's own stable id for "Aceitar".
 * A no-op when the banner isn't present, so it's cheap to call defensively.
 *
 * Call it twice, not once: right after `cy.visit()` (so tests start with the
 * banner already out of the way — `startRegistration()` does this
 * automatically), *and* again right before any click on/near where the
 * banner would cover the page. AdOpt can render with a delay after the
 * page loads, so the post-visit check alone can still miss a banner that
 * shows up later — right before the click is where it's actually been seen
 * covering a submit button.
 */
Cypress.Commands.add('dismissCookieBannerIfVisible', () => {
  return cy.get('body').then(($body) => {
    const $acceptButton = $body.find('#adopt-accept-all-button')
    if ($acceptButton.length) {
      cy.wrap($acceptButton).click({ force: true })
    }
  })
})

/**
 * Suppress the cookie banner → visit `/registro/` directly. Goes straight to
 * the registration screen instead of the home page → register-CTA click, so
 * tests don't depend on the home page's marketing banners (whose Gatsby
 * `<Link>`s prefetch-`HEAD` their target pages when scrolled into view).
 * Also runs `dismissCookieBannerIfVisible()` right after the visit, so tests
 * start with the banner already out of the way even on the occasions AdOpt
 * renders it despite the cookie.
 */
Cypress.Commands.add('startRegistration', () => {
  cy.acceptCookieBanner()
  cy.visit('/registro/')
  cy.dismissCookieBannerIfVisible()
})

// --- Backend stubs (packages/core-api/src/adapters/auth.ts) ---
// Every endpoint except `email/check` is unwrapped by the adapter as
// `{ data: T }` (`hasNestedData: true`, the default); `email/check` uses
// `{ valid: true }` directly (`hasNestedData: false, hasValid: true`). A
// non-2xx `statusCode` makes the adapter report `ok: false` with `error` set
// to the response body — use that to simulate backend rejections.

Cypress.Commands.add(
  'stubCpfCheck',
  (
    overrides: {
      status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ERROR'
      cpfCheckId?: string | null
      mobilePrefixAndNumberRequired?: boolean
      statusCode?: number
    } = {},
  ) => {
    const { statusCode = 200, ...data } = overrides
    cy.intercept('POST', '**/registration/cpf-checks/v4', {
      statusCode,
      body: {
        data: {
          status: 'APPROVED',
          cpfCheckId: null,
          mobilePrefixAndNumberRequired: false,
          ...data,
        },
      },
    }).as('cpfCheck')
  },
)

/**
 * Legacy registration's CPF check (`useCAFPolling.checkCaf`,
 * apps/core/src/atomic-components/organisms/registerContent/customComponents/hooks/useCAFPolling.js)
 * — a *different* endpoint from the new v4 flow's `stubCpfCheck`
 * (`/registration/cpf/check/v3`, not `/cpf-checks/v4`), with an unwrapped
 * response body (no `{ data: ... }` nesting). Passing `status` simulates a
 * rejection (`INVALID`/`NOT_PROCESSED`/`DUPLICATED`) by omitting `afId`,
 * which is what actually triggers `showCpfError` in the app — the default
 * (no `status`) returns a same-request approval (`afId` + `cpf` both
 * present), so the flow never has to poll the GET status endpoint.
 */
Cypress.Commands.add(
  'stubLegacyCpfCheck',
  (
    overrides: {
      status?: 'INVALID' | 'NOT_PROCESSED' | 'DUPLICATED'
      statusCode?: number
    } = {},
  ) => {
    const { statusCode = 200, status } = overrides
    const body = status
      ? { status }
      : {
          afId: 'e2e-legacy-af-id',
          cpf: '52998224725',
          status: 'APPROVED',
          onboardingId: 'e2e-legacy-onboarding-id',
        }
    cy.intercept('POST', '**/registration/cpf/check/v3', {
      statusCode,
      body,
    }).as('legacyCpfCheck')
  },
)

/**
 * Legacy registration's phone-verification step (`PhoneVerificationStep`,
 * `doRegistrationSmsSend`) — sends the SMS code. The component checks
 * `data?.mobileVerificationStatus === 'REQUESTED'` in addition to `ok`, so
 * both must be right for it to treat the send as successful.
 */
Cypress.Commands.add(
  'stubLegacySmsSend',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/registration/mobile-number/send-verification-sms', {
      statusCode,
      body: messageCode
        ? { messageCode }
        : { data: { mobileVerificationStatus: 'REQUESTED' } },
    }).as('legacySmsSend')
  },
)

/**
 * Legacy registration's phone-verification step (`PhoneVerificationStep`,
 * `doRegistrationSmsValidation`) — validates the entered SMS code. Same
 * `data?.mobileVerificationStatus` check as `stubLegacySmsSend`, expecting
 * `'VERIFIED'` instead of `'REQUESTED'`.
 */
Cypress.Commands.add(
  'stubLegacySmsValidate',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept(
      'POST',
      '**/registration/mobile-number/check-verification-sms-code',
      {
        statusCode,
        body: messageCode
          ? { messageCode }
          : { data: { mobileVerificationStatus: 'VERIFIED' } },
      },
    ).as('legacySmsValidate')
  },
)

/**
 * Legacy login's pre-login migratable/self-exclusion check
 * (`getUserMigratableStatus`, apps/core/src/utils/getUserMigratableStatus/index.js)
 * — `POST /registration/user/is-migrateable`, awaited before `doLogin` ever
 * runs. `hasNestedData: true` (the adapter's default), so the response is
 * unwrapped at `data`; `migrateable` (not `isMigratable`) is the raw field
 * name the backend uses, renamed by `getUserMigratableStatus` on the way out.
 * `isMigratable` is checked *before* `isSelfExcluded` in `onSubmit`
 * (login.js) — a migratable account opens the migration modal regardless of
 * its self-exclusion status; `isSelfExcluded` only matters once
 * `isMigratable` is false. `nationalId`/`phone`/`phonePrefix`/`state`/
 * `city`/`address`/`hasBalance` are the migrated account's existing data,
 * carried into the migration modal's prepopulated `userData`. A real
 * response also includes `zipCode`, but `getUserMigratableStatus` doesn't
 * read it — passing it here is realistic but inert.
 * Defaults to the common case (not migratable, not excluded) so a plain
 * login test doesn't have to think about this endpoint at all.
 */
Cypress.Commands.add(
  'stubMigratableStatus',
  (
    overrides: {
      migrateable?: boolean
      hasBalance?: boolean
      isSelfExcluded?: boolean | null
      selfExclusionEndDate?: string | null
      nationalId?: string | null
      phone?: string | null
      phonePrefix?: string | null
      state?: string | null
      city?: string | null
      address?: string | null
      zipCode?: string | null
      statusCode?: number
    } = {},
  ) => {
    const { statusCode = 200, migrateable = false, ...rest } = overrides
    cy.intercept('POST', '**/registration/user/is-migrateable', {
      statusCode,
      body: {
        message: null,
        messageCode: null,
        data: { migrateable, ...rest },
      },
    }).as('migratableStatus')
  },
)

Cypress.Commands.add(
  'stubEmailCheck',
  (overrides: { valid?: boolean; status?: string } = {}) => {
    cy.intercept('POST', '**/registration/email/check', {
      valid: true,
      ...overrides,
    }).as('emailCheck')
  },
)

Cypress.Commands.add(
  'stubSendToken',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/registration/email/send-token', {
      statusCode,
      body: messageCode ? { messageCode } : { data: {} },
    }).as('sendToken')
  },
)

Cypress.Commands.add(
  'stubValidateToken',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/registration/email/validate-token', {
      statusCode,
      body: messageCode ? { messageCode } : { data: {} },
    }).as('validateToken')
  },
)

Cypress.Commands.add(
  'stubSocialSignIn',
  (overrides: { statusCode?: number; body?: Record<string, unknown> } = {}) => {
    const { statusCode = 200, body = {} } = overrides
    cy.intercept('POST', '**/auth/social/sign-in', { statusCode, body }).as(
      'socialSignIn',
    )
  },
)

Cypress.Commands.add(
  'stubMarkVerified',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/registration/email/mark-verified', {
      statusCode,
      body: messageCode ? { messageCode } : { data: {} },
    }).as('markVerified')
  },
)

/**
 * Stubs `doLogin` plus every downstream call `AuthContext.loginUser` makes
 * on a successful login (apps/core/src/context/authProvider.js) — `GET
 * /user`, `GET /limit`, `POST /intercom/token`, `GET
 * /user-activity-fact/deposit-info` — so a full login round-trip never
 * depends on the real backend. `wallet.active`/`hasFirstTimeDeposit` must
 * both be present (even though only used to decide whether to trigger a
 * geolocation prompt) — `loginUser` reads
 * `depositResponse.data.hasFirstTimeDeposit || user.data.wallet.active`
 * unconditionally right after login, so a response missing either throws an
 * uncaught exception that fails the test even on an otherwise-successful login.
 *
 * Also stubs `GET /sportsbook/token` — a login that redirects onto a
 * sportsbook page (both flows' post-login destination) mounts
 * `KambiSessionProvider` there, which bootstraps the Kambi widget for the
 * now-logged-in user and fetches this ticket as part of that
 * (`getAuthKambiUser`, apps/core/src/context/KambiSessionProvider.js). Not
 * nested in `{ data }` — `getAuthKambiUser` reads the body directly
 * (`hasNestedData: false`).
 */
Cypress.Commands.add(
  'stubLogin',
  (overrides: { statusCode?: number; body?: Record<string, unknown> } = {}) => {
    const {
      statusCode = 200,
      body = { access_token: 'e2e-token', refresh_token: 'e2e-refresh' },
    } = overrides
    // `hasNestedData: true` (doLogin's default) only unwraps a *successful*
    // response's `{ data: ... }` envelope — an error response is read
    // straight off `error.response.data` with no unwrapping, so nesting it
    // the same way would bury `messageCode` where `treatLoginErrors`
    // (shared by both the legacy and the new-flow login) can't see it.
    const responseBody = statusCode >= 200 && statusCode < 300 ? { data: body } : body
    cy.intercept('POST', '**/auth/login', { statusCode, body: responseBody }).as(
      'login',
    )
    cy.intercept('GET', '**/user', {
      data: {
        id: 'e2e-user',
        email: 'e2e-test@example.com',
        first_name: 'E2E',
        wallet: { active: false },
      },
    }).as('getUser')
    cy.intercept('GET', '**/limit', { data: [] }).as('getLimits')
    cy.intercept('POST', '**/intercom/token', { data: 'e2e-intercom-token' }).as(
      'intercomToken',
    )
    cy.intercept('GET', '**/user-activity-fact/deposit-info', {
      data: { hasFirstTimeDeposit: false },
    }).as('depositInfo')
    cy.intercept('GET', '**/sportsbook/token', { token: 'e2e-kambi-token' }).as(
      'kambiToken',
    )
  },
)

Cypress.Commands.add(
  'stubRegister',
  (overrides: { statusCode?: number; body?: Record<string, unknown> } = {}) => {
    const { statusCode = 200, body = { id: 'e2e-fake-user-id' } } = overrides
    cy.intercept('POST', '**/registration/v4', { statusCode, body: { data: body } }).as(
      'register',
    )
  },
)

/**
 * The "Registration 2026" activation flow's own step orchestrator
 * (`useActivationSteps`, `modules/registration/.../activation-flow/use-activation-steps.hook.ts`)
 * — `GET /activation/steps`, read once when `ActivationInviteScreen`/
 * `ActivationFlowCard` mounts (to light up their "Ativar minha conta"/
 * "Ativar conta" CTA) and again after each step's `onComplete`
 * (`ActivationStepModal`'s `advanceToStepAfterRead`) to decide what comes
 * next. `getActivationSteps` (`activation.ts`) passes no adapter options, so
 * it uses `apiGET`'s default `hasNestedData: true` — the response body must
 * be wrapped in `{ data: ... }`, unlike `getUserLimitPeriods`/`getUserLimits`
 * elsewhere in this file, which explicitly opt out of that envelope.
 *
 * `active: false` is the default on purpose, not a typo: `isActivationPending`
 * (`use-activation-steps.hook.ts`) is `data?.active === false && steps.length
 * > 0` — with `active: true` the card/invite screen both read "nothing
 * pending" and never show their CTA at all (`ActivationFlowCard`'s
 * `isVisible = enabled && isActivationPending`, `ActivationInviteScreen`'s own
 * `hasNothingToActivate` even navigates away via `onNoPendingSteps`).
 */
Cypress.Commands.add(
  'stubActivationSteps',
  (
    overrides: {
      active?: boolean
      nextStep?: string | null
      steps?: Array<{ step: string; completed: boolean }>
      statusCode?: number
    } = {},
  ) => {
    const {
      statusCode = 200,
      active = false,
      nextStep = 'rg',
      steps = nextStep ? [{ step: nextStep, completed: false }] : [],
    } = overrides
    cy.intercept('GET', '**/activation/steps', {
      statusCode,
      body: { data: { active, nextStep, steps } },
    }).as('activationSteps')
  },
)

/**
 * `getUserLimitPeriods` (`GET /limit/period`, `hasNestedData: false`) — the
 * RG-limits screen's `findPeriodByName` matches on `name` (the API's
 * `'Daily'`/`'Weekly'`/`'Monthly'`, not the `'Day'`/`'Week'`/`'Month'` the UI
 * works in) to find this period's `id`/`duration` for the `/limit`
 * payloads. `id: 1, duration: 24` (hours) is what turns into the real
 * `period_id: "1"`/`duration: "1440"` (minutes) the redesigned screen's
 * "Usar limites máximos" path is documented to send.
 */
Cypress.Commands.add(
  'stubLimitPeriods',
  (
    overrides: {
      periods?: Array<{ id: number; name: string; duration: number }>
      statusCode?: number
    } = {},
  ) => {
    const {
      statusCode = 200,
      periods = [{ id: 1, name: 'Daily', duration: 24 }],
    } = overrides
    cy.intercept('GET', '**/limit/period', {
      statusCode,
      body: { data: periods },
    }).as('limitPeriods')
  },
)

/**
 * The RG-limits screen's own writes — `POST /limit` for a first-time limit,
 * `PUT /limit/{id}` when one is already active for the period
 * (`buildLossLimitDraft`/`buildSessionLimitDraft`,
 * `activation-limits.utils.ts`). Both endpoints only need `response.ok`
 * (`storeLimit` in `use-rg-limits.hook.ts` never reads the body), so a bare
 * 2xx/non-2xx is enough here — for a test needing one call to fail and the
 * other to succeed (the screen's partial-failure path), intercept
 * `**\/limit` directly instead and branch on `req.body.type`
 * (`'STOP_LOSS'`/`'GAMING_SESSION'`).
 *
 * `POST /limit` isn't exclusive to this screen: `RealityCheckProvider`
 * (globally mounted, `apps/core/src/context/realityCheckProvider.js`) POSTs
 * a `type: 'REALITY_CHECK'` limit of its own the moment `isLoggedIn` is true
 * and the user has none yet — always true on this suite's fake session. A
 * single `POST /limit` intercept would catch that one under the same
 * `@setLimit` alias, ahead of and mixed in with the RG screen's own
 * STOP_LOSS/GAMING_SESSION writes. Routed to its own `@realityCheckLimit`
 * alias instead so `@setLimit` only ever holds this screen's calls.
 */
Cypress.Commands.add(
  'stubSetLimit',
  (overrides: { statusCode?: number } = {}) => {
    const { statusCode = 200 } = overrides
    cy.intercept('POST', '**/limit', (req) => {
      req.alias = req.body?.type === 'REALITY_CHECK' ? 'realityCheckLimit' : 'setLimit'
      req.reply({ statusCode, body: {} })
    })
    cy.intercept('PUT', '**/limit/*', { statusCode, body: {} }).as(
      'updateLimit',
    )
  },
)

/**
 * The calls that fire globally the instant `isLoggedIn` flips true —
 * regardless of *how* it got there (a real login, or `visitAsLoggedInUser`
 * skipping straight past one) or which page it happens on — that a
 * `cy.visit()`-only shortcut would otherwise leave hitting the real dev
 * API, all wired into providers mounted unconditionally in
 * `AppProviders.js`:
 * - `AuthProvider`'s `useWalletQuery({ enabled: !!isLoggedIn })` →
 *   `GET /wallet`.
 * - `AuthProvider`'s `useVault`'s `getUserActiveVault`/`getUserClaimedVault`
 *   → `GET /player-rewards/...`.
 * - `PaymentsProvider`'s `getRollbackWithdrawalSettings` (only when
 *   `storageService`'s cached `rollbackSettings` is empty, which it always
 *   is on a fresh fake session) → `GET /settings`.
 * - `SmarticoProvider`'s identity hand-off (`assignUserIdentity`,
 *   `smarticoUtils.js`) → `GET /smartico/players/hash`.
 * - `POST /auth/refresh-token`, as a safety net — `coreApi.ts`'s 401
 *   interceptor would otherwise clear the fake session and bounce to
 *   `/login/` the moment anything else 401s.
 *
 * `GET /bff/limit/active` is `Layout`'s own
 * `useLimitUsage({ enabled: isLoggedIn })` (`@repo/my-account`) — a
 * different endpoint from `stubSetLimit`'s `/limit` POST/PUT.
 *
 * Also stubbed, for the same reason (fired by other `Layout`-mounted
 * compliance/deposit widgets the instant `isLoggedIn` is true, regardless of
 * the RG screen this suite actually cares about):
 * - `RiskMatrixModal` (`organisms/layout/index.js`) → `GET /rg-risk-review`,
 *   whenever `localStorage`'s `hasCheckedRiskReview` isn't set — always true
 *   on a fresh fake session.
 * - `SOWModal` (same Layout) → `GET /players/kyc/documents/pending`.
 * - the deposit widget's `useDepositPrerequisites`
 *   (`modules/deposit/src/hooks/use-deposit-prerequisites.hook.ts`) →
 *   `GET /player/bank-accounts` and `GET /payments/player/deposit-options/`.
 * - the header's own notification check (`organisms/header/index.js`) →
 *   `GET /user/user-notification`, 5s after mount, whenever
 *   `localStorage`'s `notification` isn't set — stubbed as a bare 204: a
 *   real 200 with any truthy body pops the notification modal open
 *   (`response.ok && response.data` is the only guard, `header/index.js`),
 *   which would sit on top of the RG screen this suite is testing.
 *
 * None of this overlaps `stubLogin` — that one covers a real
 * `POST /auth/login`'s aftermath (`/user`, `/intercom/token`, ...), none of
 * which fire on this bootstrap path (see `visitAsLoggedInUser`'s doc for
 * why).
 */
Cypress.Commands.add('stubActiveSession', () => {
  cy.intercept('GET', '**/limit', { data: [] })
  cy.intercept('GET', '**/bff/limit/active', { data: [] })
  cy.intercept('GET', '**/player-rewards/**', { data: [] })
  cy.intercept('GET', '**/wallet', {
    data: {
      active: false,
      currency: { symbol: 'R$', short_code: 'BRL' },
    },
  })
  cy.intercept('GET', '**/settings', { data: { withdrawal_rollback: false } })
  cy.intercept('GET', '**/smartico/players/hash', {
    data: 'e2e-smartico-hash',
  })
  cy.intercept('GET', '**/rg-risk-review', {
    data: { has_pending_review: false },
  })
  cy.intercept('GET', '**/players/kyc/documents/pending', { data: [] })
  cy.intercept('GET', '**/player/bank-accounts', {
    data: { activeAccounts: [], inactiveAccounts: [] },
  })
  cy.intercept('GET', '**/payments/player/deposit-options/', { data: [] })
  cy.intercept('GET', '**/user/user-notification', {
    statusCode: 204,
    body: '',
  })
  cy.intercept('POST', '**/auth/refresh-token', {
    data: { access_token: 'e2e-token', refresh_token: 'e2e-refresh' },
  })
})

/**
 * Skips the real login/registration UI entirely by seeding the same
 * `localStorage`/cookie a successful one leaves behind, then visiting
 * straight into an already-authenticated page load —
 * `authProvider.js`'s mount effect reads `@kto:access_token`/`@kto:user`
 * (`storageService.getAccessToken`/`getUser`) *synchronously off
 * `localStorage`*, sets `user` state directly, and only *arms* a 5-minute
 * `fetchUser` interval — no `GET /user` (or any network call at all) is
 * needed for `isLoggedIn` to become `true`. `cookiePrefix` is `@kto:`
 * (`GATSBY_COOKIE_PREFIX`) in every env this suite can point at.
 * `token1` (`SESSION_COOKIE_NAME`) is set for parity with a real login even
 * though nothing currently reads it as an `isLoggedIn` condition.
 *
 * Pair with `stubActiveSession()` first — the moment `isLoggedIn` flips,
 * `AuthProvider` fires calls of its own that need stubbing regardless of
 * which page this lands on.
 */
Cypress.Commands.add(
  'visitAsLoggedInUser',
  (path: string, user: Record<string, unknown> = {}) => {
    cy.visit(path, {
      onBeforeLoad(win) {
        win.localStorage.setItem('@kto:access_token', 'e2e-token')
        win.localStorage.setItem('@kto:refresh_token', 'e2e-refresh')
        win.localStorage.setItem(
          '@kto:user',
          JSON.stringify({
            id: 'e2e-user',
            email: 'e2e-test@example.com',
            first_name: 'E2E',
            wallet: {
              active: false,
              currency: { symbol: 'R$', short_code: 'BRL' },
            },
            // `smarticoUtils.js`'s `assignUserIdentity` reads
            // `user.user_language.urlCode` unconditionally if the identity
            // hand-off ever runs — present so that doesn't throw.
            user_language: { urlCode: 'pt-BR' },
            ...user,
          }),
        )
        win.document.cookie = 'token1=e2e-session; path=/'
      },
    })
  },
)

// --- Step interactions ---
// Each assumes its backend stub (above) is already set up when the step
// makes a network call, and that the step is already on screen.

/** A well-known algorithmically-valid CPF (also used in packages/utils/src/cpf.spec.ts). */
Cypress.Commands.add(
  'fillCpfStep',
  (cpf = '52998224725', { acceptAll = true }: { acceptAll?: boolean } = {}) => {
    // Waits for the masked/controlled input to actually reflect what was
    // typed before moving on — `type()` fires the keystrokes but doesn't
    // wait for React to settle, so a slow re-render can otherwise leave the
    // field looking empty by the time the checkbox/submit commands run.
    cy.get('input[inputmode="numeric"]')
      .type(cpf)
      .should('not.have.value', '')
    if (acceptAll) {
      cy.get('input[type="checkbox"]').first().check({ force: true }).should('be.checked')
    }
    cy.get('.step-primary-button').click()
  },
)

// `.should('have.value', ...)` after each `.type()` below waits for the
// controlled input to actually catch up with what was typed before moving
// on — otherwise a slow React re-render can leave the field holding only
// the first few characters by the time the submit button is clicked (seen
// first on the CPF field, see fillCpfStep above).

Cypress.Commands.add('fillPasswordStep', (password = 'Sup3rSecret!23') => {
  cy.get('input[type="password"]').type(password).should('have.value', password)
  cy.get('.step-primary-button').click()
})

Cypress.Commands.add('selectEmailVerificationMethod', () => {
  cy.get('.verification-method-row').first().click()
})

Cypress.Commands.add('selectGoogleVerificationMethod', () => {
  cy.get('.verification-method-row').eq(1).click()
})

Cypress.Commands.add('fillEmailStep', (email = 'e2e-test@example.com') => {
  cy.get('input[type="email"]').type(email).should('have.value', email)
  cy.get('.step-primary-button').click()
})

/**
 * `PhoneStep` (modules/registration/.../steps/phone-step/phone-step.tsx) —
 * only rendered when the CPF check reports `mobilePrefixAndNumberRequired`,
 * so it doesn't run for every identity. No SMS/OTP is involved, unlike the
 * e-mail step: it's a plain field, safe to automate end to end. `mobile` is
 * the DDD + number only (no prefix) — the country-code select defaults to
 * `+55` and isn't touched here.
 *
 * `.should('have.value', masked)` waits for the masked/controlled input
 * (`maskPhone`, packages/utils/src/phone.ts — `(00) 00000-0000`) to actually
 * catch up with what was typed, same reason as `fillCpfStep`/`fillPasswordStep`
 * above: without it, a slow React re-render can leave `canProceed`
 * (`isValidPhoneNumber`) false when `.step-primary-button` gets clicked, so
 * the click silently no-ops (disabled button) and the spec hangs waiting on
 * whatever comes after this step instead of failing here with a clear cause.
 */
Cypress.Commands.add('fillPhoneStep', (mobile = '11987654321') => {
  const masked = `(${mobile.slice(0, 2)}) ${mobile.slice(2, 7)}-${mobile.slice(7, 11)}`
  cy.get('input[inputmode="tel"]').type(mobile).should('have.value', masked)
  cy.get('.step-primary-button').click()
})

/** OTP_LENGTH is 4 (email-verification-step.consts.ts) — auto-submits on the 4th digit. */
Cypress.Commands.add('fillOtp', (code = '1234') => {
  cy.get('input[data-input-otp="true"]').type(code)
})

declare global {
  namespace Cypress {
    interface Chainable {
      /** See implementation doc above. */
      stubGrowthbookFeatures(
        featureOverrides?: Record<string, unknown | null>,
      ): Chainable<null>
      /** See implementation doc above. */
      overrideGrowthbookFeature(key: string, value: unknown): Chainable<null>
      /** See implementation doc above. */
      stubCountryCheck(name?: string): Chainable<null>
      /** See implementation doc above. */
      acceptCookieBanner(): Chainable<JQuery<HTMLElement>>
      /** See implementation doc above. */
      dismissCookieBannerIfVisible(): Chainable<JQuery<HTMLBodyElement>>
      /** Home → accept cookies → click the header's register CTA. */
      startRegistration(): Chainable<JQuery<HTMLElement>>
      stubCpfCheck(overrides?: {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ERROR'
        cpfCheckId?: string | null
        mobilePrefixAndNumberRequired?: boolean
        statusCode?: number
      }): Chainable<null>
      /** See implementation doc above. Legacy flow only. */
      stubLegacyCpfCheck(overrides?: {
        status?: 'INVALID' | 'NOT_PROCESSED' | 'DUPLICATED'
        statusCode?: number
      }): Chainable<null>
      /** See implementation doc above. Legacy flow only. */
      stubLegacySmsSend(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. Legacy flow only. */
      stubLegacySmsValidate(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. Legacy flow only. */
      stubMigratableStatus(overrides?: {
        migrateable?: boolean
        hasBalance?: boolean
        isSelfExcluded?: boolean | null
        selfExclusionEndDate?: string | null
        nationalId?: string | null
        phone?: string | null
        phonePrefix?: string | null
        state?: string | null
        city?: string | null
        address?: string | null
        zipCode?: string | null
        statusCode?: number
      }): Chainable<null>
      stubEmailCheck(overrides?: {
        valid?: boolean
        status?: string
      }): Chainable<null>
      stubSendToken(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      stubValidateToken(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      stubSocialSignIn(overrides?: {
        statusCode?: number
        body?: Record<string, unknown>
      }): Chainable<null>
      stubMarkVerified(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      stubLogin(overrides?: {
        statusCode?: number
        body?: Record<string, unknown>
      }): Chainable<null>
      stubRegister(overrides?: {
        statusCode?: number
        body?: Record<string, unknown>
      }): Chainable<null>
      stubActivationSteps(overrides?: {
        active?: boolean
        nextStep?: string | null
        steps?: Array<{ step: string; completed: boolean }>
        statusCode?: number
      }): Chainable<null>
      stubLimitPeriods(overrides?: {
        periods?: Array<{ id: number; name: string; duration: number }>
        statusCode?: number
      }): Chainable<null>
      stubSetLimit(overrides?: { statusCode?: number }): Chainable<null>
      stubActiveSession(): Chainable<null>
      /** Bootstraps an already-logged-in session via localStorage, then visits `path`. Pair with `stubActiveSession()`. */
      visitAsLoggedInUser(
        path: string,
        user?: Record<string, unknown>,
      ): Chainable<JQuery<HTMLElement>>
      fillCpfStep(
        cpf?: string,
        options?: { acceptAll?: boolean },
      ): Chainable<JQuery<HTMLElement>>
      fillPasswordStep(password?: string): Chainable<JQuery<HTMLElement>>
      selectEmailVerificationMethod(): Chainable<JQuery<HTMLElement>>
      selectGoogleVerificationMethod(): Chainable<JQuery<HTMLElement>>
      fillEmailStep(email?: string): Chainable<JQuery<HTMLElement>>
      fillPhoneStep(mobile?: string): Chainable<JQuery<HTMLElement>>
      fillOtp(code?: string): Chainable<JQuery<HTMLElement>>
    }
  }
}

export {}
