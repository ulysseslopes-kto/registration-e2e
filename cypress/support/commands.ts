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
 * Same idea as `acceptCookieBanner()` above, but with the cookie AdOpt
 * writes after a human clicks "Rejeitar" (`#adopt-reject-all-button`)
 * instead of "Aceitar" — captured the same way, once, in
 * fixtures/adopt-consent-denied.json. Suppresses the banner just the same
 * (AdOpt still sees the choice as already-answered), only the answer
 * itself differs. Call before `cy.visit()`.
 */
Cypress.Commands.add('denyCookieBanner', () => {
  cy.fixture('adopt-consent-denied.json').then((consent) => {
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
 *
 * By default only the very first call across the whole run pays the 2s wait
 * below (see `hasWaitedForCookieBanner`) — every call after that, in this
 * test or any later one, has already had that delay elapse once. Pass
 * `{ wait: true }` to force it again at a specific call site anyway (e.g.
 * a long gap since the last check), or `{ wait: false }` to force-skip it
 * even on that first call.
 */
let hasWaitedForCookieBanner = false

Cypress.Commands.add(
  'dismissCookieBannerIfVisible',
  (options: { wait?: boolean } = {}) => {
    // AdOpt injects the banner asynchronously, so checking the DOM the
    // instant this command runs can miss it mid-render and wrongly no-op —
    // give it a moment to show up before deciding it isn't there.
    const shouldWait = options.wait ?? !hasWaitedForCookieBanner
    if (shouldWait) {
      hasWaitedForCookieBanner = true
      cy.wait(500)
    }
    return cy.get('body').then(($body) => {
      const $acceptButton = $body.find('#adopt-accept-all-button')
      if ($acceptButton.length) {
        cy.wrap($acceptButton).click({ force: true })
      }
    })
  },
)

/**
 * Visit `/registro/` directly. Goes straight to the registration screen
 * instead of the home page → register-CTA click, so tests don't depend on
 * the home page's marketing banners (whose Gatsby `<Link>`s prefetch-`HEAD`
 * their target pages when scrolled into view). Runs
 * `dismissCookieBannerIfVisible()` right after the visit, so tests start
 * with the banner already out of the way even on the occasions AdOpt
 * renders it despite the (denied, per the global default —
 * `denyCookieBanner()` in `e2e.ts`) `AdoptConsent` cookie.
 */
Cypress.Commands.add('startRegistration', () => {
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

/**
 * Login's own 2FA (`messageCode 455` on `/auth/login` — see
 * cypress/e2e/mocked/{legacy,new}/login/2fa-7-days.cy.ts), email channel.
 * Same `/account-verification/email/...` endpoints in both the legacy
 * (`Login2faContent/EmailVerification`) and new (`login-2fa.hook.tsx`)
 * components — distinct from `stubSendToken`/`stubValidateToken` above,
 * which are the *registration* flow's own `/registration/email/...` pair.
 */
Cypress.Commands.add(
  'stubTwoFaSendEmail',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/account-verification/email/send-email', {
      statusCode,
      body: messageCode ? { messageCode } : { data: {} },
    }).as('sendTwoFaEmail')
  },
)

Cypress.Commands.add(
  'stubTwoFaValidateEmail',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/account-verification/email/validate-token', {
      statusCode,
      body: messageCode ? { messageCode } : { data: {} },
    }).as('validateTwoFaEmail')
  },
)

/**
 * Login's own 2FA, SMS channel — same endpoints in both flows (see
 * `stubTwoFaSendEmail` above). `messageCode: 604`/`1214`
 * (`SMS_PROVIDER_TOO_MANY_REQUESTS_CODE`/`ACCOUNT_VERIFICATION_TOO_MANY_ATTEMPTS_CODE`,
 * checked by both flows' own `isTooManyAttempts`) is the one failure mode
 * that ends the 2FA attempt entirely (`onFail`) rather than just showing an
 * invalid-code error — any other `messageCode` here exercises that
 * ordinary wrong-code path instead.
 */
Cypress.Commands.add(
  'stubTwoFaSendSms',
  (
    overrides: {
      statusCode?: number
      messageCode?: number
      mobileNumber?: string
    } = {},
  ) => {
    const {
      statusCode = 200,
      messageCode,
      mobileNumber = '11987654321',
    } = overrides
    cy.intercept(
      'POST',
      '**/account-verification/mobile-number/send-verification-sms',
      {
        statusCode,
        body: messageCode ? { messageCode } : { data: { mobileNumber } },
      },
    ).as('sendTwoFaSms')
  },
)

Cypress.Commands.add(
  'stubTwoFaValidateSms',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept(
      'POST',
      '**/account-verification/mobile-number/check-verification-sms-code',
      {
        statusCode,
        body: messageCode ? { messageCode } : { data: {} },
      },
    ).as('validateTwoFaSms')
  },
)

/**
 * Legacy forgot-password flow (`ResetPasswordEmailFlow`,
 * apps/core/src/atomic-components/organisms/ResetPasswordFlows/emailFlow.js)
 * — step 1, `doSendResetPasswordEmailCode`. Not gated by any GrowthBook flag
 * (shared verbatim by both the legacy and new login's "Esqueceu a senha?"
 * link — both land on the same `/forgot-password/` component tree). `70`
 * (`login.error.wrongEmail`) and `420` (recaptcha) render inline
 * `#errorMessage`; `729` too — but that key
 * (`forgotPassword.email.channelNotAvailable`) is missing from
 * `lang.flat.json`, so it renders the raw fallback
 * `forgotPassword/email/channelNotAvailable` (real prod behavior, not a
 * test-env quirk — see `formatKey.ts`).
 */
Cypress.Commands.add(
  'stubForgotPasswordSendEmailCode',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/player/password/forgot/email/send-email', {
      statusCode,
      body: messageCode ? { messageCode } : { data: {} },
    }).as('forgotPasswordSendEmailCode')
  },
)

/**
 * Same flow, step 2 — `doValidateResetPasswordEmailCode`. On success the
 * `token`/`userId` pair is fed straight into `doRequestResetPasswordLiveness`
 * (`handleFlowSuccess`, forgot-password.js), so a stub here needs both
 * fields for the flow to proceed. `604` (too many requests) maps to
 * `twoFa.email.tooManyRequests`, itself ALSO missing from
 * `lang.flat.json` — same raw-fallback caveat as the send-email step above.
 * Any other `messageCode` falls through to the generic
 * `twoFa.email.error` toast ("Código inválido...").
 */
Cypress.Commands.add(
  'stubForgotPasswordValidateEmailCode',
  (
    overrides: {
      statusCode?: number
      messageCode?: number
      token?: string
      userId?: string
    } = {},
  ) => {
    const {
      statusCode = 200,
      messageCode,
      token = 'e2e-reset-token',
      userId = 'e2e-reset-user-id',
    } = overrides
    cy.intercept('POST', '**/player/password/forgot/email/validate-token', {
      statusCode,
      body: messageCode ? { messageCode } : { data: { token, userId } },
    }).as('forgotPasswordValidateEmailCode')
  },
)

/**
 * Same flow, SMS channel step 1 — `doSendResetPasswordSMSCode`
 * (`ResetPasswordSMSFlow`, `.../ResetPasswordFlows/smsFlow.js`). Only `729`
 * (channel not available, same missing-translation caveat as the email
 * variant) is handled explicitly by the component; anything else falls back
 * to the flow's own generic error.
 */
Cypress.Commands.add(
  'stubForgotPasswordSendSmsCode',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept(
      'POST',
      '**/player/password/forgot/mobile-number/send-verification-sms',
      {
        statusCode,
        body: messageCode ? { messageCode } : { data: {} },
      },
    ).as('forgotPasswordSendSmsCode')
  },
)

/**
 * Same flow, SMS channel step 2 — `doValidateResetPasswordSMSCode`. Unlike
 * the email variant, `twoFa.sms.tooManyRequests` (messageCode `604`) IS
 * present in `lang.flat.json` ("Muitas tentativas...") — real translated
 * text renders here, no fallback-key caveat.
 */
Cypress.Commands.add(
  'stubForgotPasswordValidateSmsCode',
  (
    overrides: {
      statusCode?: number
      messageCode?: number
      token?: string
      userId?: string
    } = {},
  ) => {
    const {
      statusCode = 200,
      messageCode,
      token = 'e2e-reset-token',
      userId = 'e2e-reset-user-id',
    } = overrides
    cy.intercept(
      'POST',
      '**/player/password/forgot/mobile-number/check-verification-sms-code',
      {
        statusCode,
        body: messageCode ? { messageCode } : { data: { token, userId } },
      },
    ).as('forgotPasswordValidateSmsCode')
  },
)

/**
 * Forgot-password's mandatory liveness kickoff —
 * `doRequestResetPasswordLiveness`, `POST /player/password/forgot/onboarding`
 * — fired unconditionally the instant either OTP step succeeds
 * (`handleFlowSuccess`, forgot-password.js). There is no flag/branch to skip
 * straight to the password-reset form after this; a successful response
 * just transitions into `KycSteps`'s own start screen
 * (`data-qa="kyc-button-start"`, no further network call), which is as far
 * as this repo's mocked specs take this particular entry point — see the
 * forgot-password spec's header comment for why.
 */
Cypress.Commands.add(
  'stubForgotPasswordLiveness',
  (overrides: { statusCode?: number; type?: string } = {}) => {
    const { statusCode = 200, type = 'LIVENESS' } = overrides
    cy.intercept('POST', '**/player/password/forgot/onboarding', {
      statusCode,
      body: {
        data: {
          type,
          url: 'https://kyc.e2e.test/session',
          onboardingId: 'e2e-onboarding-id',
          provider: 'e2e-provider',
          token: 'e2e-kyc-token',
        },
      },
    }).as('forgotPasswordLiveness')
  },
)

/**
 * The token-link reset page (`ResetPasswordContent` local to
 * apps/core/src/templates/onBoarding/reset.js, mounted at `/reset/`) —
 * `doResetPassword`, `POST /auth/password/reset/`. This is a *different*
 * function from the `/forgot-password/` flow's own final step
 * (`doResetPasswordV2`, `POST /player/password/forgot`) — same-looking
 * component names, unrelated code paths. `hasNoData: true` on this adapter
 * call, so a success response needs no `{ data: ... }` envelope at all,
 * unlike every other endpoint in this flow. With the base GrowthBook
 * fixture (`forgot_password_with_liveness` absent → falsy), this page skips
 * its own optional liveness step entirely and renders the password form
 * immediately — the only route in this whole flow where a password change
 * can be driven to completion purely with `cy.intercept`.
 */
Cypress.Commands.add(
  'stubResetPassword',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/auth/password/reset/', {
      statusCode,
      body: messageCode ? { messageCode } : {},
    }).as('resetPassword')
  },
)

/**
 * The "new" (Registration 2026) forgot-password flow's KYC status check —
 * `getKycLivenessStatusByProvider` (packages/core-api/src/adapters/kyc.ts),
 * `GET /liveness/{provider}/{onboardingId}` — polled by `useKycStatus`
 * (packages/kyc/src/hooks/use-kyc-status.hook.ts) the instant
 * `forgot-password-identity.hook.tsx`'s `isCapturing` flips true (clicking
 * "Começar verificação"), no third-party widget or `postMessage` needed:
 * the *first* poll is awaited before any interval is ever set up, so a
 * `status: 'APPROVED'` response here resolves the whole identity step
 * synchronously. This is what lets the new flow's mocked spec drive a real
 * password change to completion, unlike the legacy flow's `KycSteps` (see
 * `forgot-password.cy.ts`'s header comment). Only fires for `kycType ===
 * LIVENESS` (i.e. the liveness `type` stubbed via `stubForgotPasswordLiveness`
 * is anything other than `'IDENTIFICATION_AND_SELFIE'`) — the onboarding
 * variant (`GET /documents/{provider}/{onboardingId}`) isn't covered here.
 * A `REJECTED`/`REPROVED` status with no `id` field skips the extra
 * `GET /documents/{id}/reject-reasons` call (`fetchRejectReason` only fires
 * `if (data?.id)`) — omit `id` unless a test specifically needs that call.
 */
Cypress.Commands.add(
  'stubKycLivenessStatus',
  (
    overrides: {
      status?: 'APPROVED' | 'REJECTED' | 'REPROVED'
      id?: number
      statusCode?: number
    } = {},
  ) => {
    const { status = 'APPROVED', id, statusCode = 200 } = overrides
    cy.intercept('GET', '**/liveness/**', {
      statusCode,
      body: { data: { status, ...(id !== undefined ? { id } : {}) } },
    }).as('kycLivenessStatus')
  },
)

/**
 * The new flow's final step — `doResetPasswordV2`, `POST
 * /player/password/forgot` (`forgot-password.hook.tsx`'s `submitPassword`).
 * Same endpoint the legacy `/forgot-password/` flow's own final step would
 * call, just never reachable in that flow's mocked spec (mandatory KYC with
 * no bypass — see `forgot-password.cy.ts`). Default `{ hasNestedData: true }`
 * envelope on `apiPOST` (no override passed), so success needs `{ data: ... }`
 * — the *opposite* of `stubResetPassword` above (`/auth/password/reset/`,
 * `hasNoData: true`, no body needed at all).
 */
Cypress.Commands.add(
  'stubForgotPasswordResetV2',
  (overrides: { statusCode?: number; messageCode?: number } = {}) => {
    const { statusCode = 200, messageCode } = overrides
    cy.intercept('POST', '**/player/password/forgot', {
      statusCode,
      body: messageCode ? { messageCode } : { data: {} },
    }).as('forgotPasswordResetV2')
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
    cy.fixture('limit.json').then((body) => {
      cy.intercept('GET', '**/limit', body).as('getLimits')
    })
    cy.fixture('intercom-token.json').then((body) => {
      cy.intercept('POST', '**/intercom/token', body).as('intercomToken')
    })
    cy.fixture('deposit-info.json').then((body) => {
      cy.intercept('GET', '**/user-activity-fact/deposit-info', body).as(
        'depositInfo',
      )
    })
    cy.fixture('sportsbook-token.json').then((body) => {
      cy.intercept('GET', '**/sportsbook/token', body).as('kambiToken')
    })
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

// Everything a logged-in session's pages fire off in the background,
// regardless of how that session was reached (`loginBeforeVisit`, the
// legacy/new login forms directly, or landing already-logged-in via
// `onBeforeLoad`-seeded storage) — one command so no caller has to guess
// which of these a given screen actually needs. Every response comes from a
// fixture (captured from a real account, PII swapped for synthetic values —
// see each fixture's own content) rather than an inline literal, `GET
// **/user/user-notification` excepted: it's a genuine `204 No Content`, so
// there's no body to put in a file.
//
Cypress.Commands.add('stubActiveSession', () => {
  cy.fixture('limit.json').then((body) => {
    cy.intercept('GET', '**/limit', body)
  })
  cy.fixture('limit-active.json').then((body) => {
    cy.intercept('GET', '**/bff/limit/active', body)
  })
  cy.fixture('player-rewards.json').then((body) => {
    cy.intercept('GET', '**/player-rewards/**', body)
  })
  cy.fixture('player-rewards-active.json').then((body) => {
    cy.intercept('GET', '**/player-rewards/active', body)
  })
  cy.fixture('wallet.json').then((body) => {
    cy.intercept('GET', '**/wallet', body)
  })
  cy.fixture('settings.json').then((body) => {
    cy.intercept('GET', '**/settings', body)
  })
  cy.fixture('smartico-hash.json').then((body) => {
    cy.intercept('GET', '**/smartico/players/hash', body)
  })
  cy.fixture('rg-risk-review.json').then((body) => {
    cy.intercept('GET', '**/rg-risk-review', body)
  })
  cy.fixture('kyc-documents-pending.json').then((body) => {
    cy.intercept('GET', '**/players/kyc/documents/pending', body)
  })
  cy.fixture('bank-accounts.json').then((body) => {
    cy.intercept('GET', '**/player/bank-accounts', body)
  })
  cy.fixture('deposit-options.json').then((body) => {
    cy.intercept('GET', '**/payments/player/deposit-options/', body)
  })
  cy.fixture('lobbies-deposit.json').then((body) => {
    cy.intercept('GET', '**/lobbies/deposit', body)
  })
  cy.intercept('GET', '**/user/user-notification', {
    statusCode: 204,
    body: '',
  })
  cy.fixture('refresh-token.json').then((body) => {
    cy.intercept('POST', '**/auth/refresh-token', body)
  })
  cy.fixture('required-data.json').then((body) => {
    cy.intercept('GET', '**/user/required-data', body)
  })
  cy.fixture('user.json').then((body) => {
    cy.intercept('GET', '**/user', body)
  })
  // `safeSetUser()` (authProvider.js) also fetches this once logged in —
  // `stubLogin()` sets its own alias for specs that call that, but this
  // covers a session reached any other way (e.g. an auto-login straight off
  // a successful `registration/v4`, no `stubLogin()` in sight).
  cy.fixture('intercom-token.json').then((body) => {
    cy.intercept('POST', '**/intercom/token', body)
  })
  cy.fixture('deposit-info.json').then((body) => {
    cy.intercept('GET', '**/user-activity-fact/deposit-info', body)
  })
  // `KambiSessionProvider` bootstraps as soon as a sportsbook page mounts for
  // a logged-in user — same "don't assume stubLogin() ran" reasoning.
  cy.fixture('sportsbook-token.json').then((body) => {
    cy.intercept('GET', '**/sportsbook/token', body)
  })
})

Cypress.Commands.add(
  'loginBeforeVisit',
  (path: string, user: Record<string, unknown> = {}) => {
    // Drive the real `/login/` form instead of seeding localStorage directly
    // — `storageService.setTokens()` (called by the app's own login handler)
    // is what actually writes `@kto:access_token`/`@kto:refresh_token` and
    // the `token1` session cookie, so logging in for real reproduces that
    // state instead of guessing its shape.
    cy.stubLogin()
    // Registered after `stubLogin()`'s own `GET **/user` stub, so this one
    // wins (Cypress matches the most recently defined intercept) — lets
    // callers shape the logged-in user via `user`, same as before.
    cy.intercept('GET', '**/user', {
      data: {
        id: 'e2e-user',
        email: 'e2e-test@example.com',
        first_name: 'E2E',
        wallet: {
          active: false,
          currency: { symbol: 'R$', short_code: 'BRL' },
        },
        user_language: { urlCode: 'pt-BR' },
        ...user,
      },
    })

    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    // Which form renders depends on `fe_igp_registration_new_ui_experience`
    // — whatever the caller's own `stubGrowthbookFeatures()` already set it
    // to — so wait for either one's username field instead of assuming the
    // new flow. Selectors per cypress/e2e/mocked/{new,legacy}/login/login.cy.ts.
    cy.get('input[autocomplete="username"], #input-new-username', {
      timeout: 15000,
    }).then(($username) => {
      const isLegacyForm = $username.is('#input-new-username')

      if (isLegacyForm) {
        cy.wrap($username).type('e2e-test@example.com')
        cy.get('#input-new-password').type('Sup3rSecret!23')
        cy.dismissCookieBannerIfVisible()
        // Typing can outrun the form's own async validation — wait for it
        // to actually enable the button rather than assuming typing alone
        // was enough by the time this runs.
        cy.get('#new-login').should('not.be.disabled').click()
      } else {
        cy.wrap($username).type('52998224725')
        cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
        // AdOpt can re-show the banner with a delay, after the initial
        // post-visit check already ran clean — check again right before
        // this click, which is exactly where it's been seen covering it.
        cy.dismissCookieBannerIfVisible()
        cy.get('button[type="submit"]').should('not.be.disabled').click()
      }
    })
    cy.wait('@login')
    // Both login pages navigate away from `/login/` on their own once
    // `isLoggedIn` flips (e.g. `AuthLandingRoute.js`'s
    // `useEffect(() => { if (isLoggedIn) navigate('/${sportSlug}/') })`) —
    // that client-side redirect races the `cy.visit(path)` below, and can
    // win, landing on the sportsbook lobby instead of `path`. Waiting for it
    // to actually happen first means our own visit is the last navigation,
    // so it's the one that sticks.
    cy.url().should('not.include', '/login')

    cy.visit(path)
  },
)

// --- Step interactions ---
// Each assumes its backend stub (above) is already set up when the step
// makes a network call, and that the step is already on screen.

/** A well-known algorithmically-valid CPF (also used in packages/utils/src/cpf.spec.ts). */
Cypress.Commands.add(
  'fillCpfStep',
  (
    cpf = '52998224725',
    {
      acceptAll = true,
      couponCode,
    }: { acceptAll?: boolean; couponCode?: string } = {},
  ) => {
    // Waits for the masked/controlled input to actually reflect what was
    // typed before moving on — `type()` fires the keystrokes but doesn't
    // wait for React to settle, so a slow re-render can otherwise leave the
    // field looking empty by the time the checkbox/submit commands run.
    cy.get('input[inputmode="numeric"]')
      .type(cpf)
      .should('not.have.value', '')
    if (couponCode) {
      // The field starts collapsed (`cpf-step.tsx`'s `couponExpanded` state)
      // — has to be opened before it's typeable.
      cy.get('.cpf-coupon-toggle').click()
      cy.get('[data-testid="cpf-coupon-input"] input')
        .type(couponCode)
        .should('have.value', couponCode)
    }
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

/**
 * Everything the new-flow activation KYC screen (`useActivationKyc`,
 * modules/registration/src/features/activation-flow/activation-kyc) calls
 * through `@repo/kyc`, all `{ data: ... }`-wrapped (`apiGET` default):
 * - `GET /session/active` + `GET /onboardings` (`useKycUrl`, on mount) —
 *   `provider: 'CAF'` so the capture step renders a plain `KycIFrame`
 *   (pointed at `about:blank`) instead of loading Unico's SDK.
 * - `GET /documents/CAF/<onboardingId>` (`useKycStatus`, polled once the
 *   user starts verification) answers `status` straight away.
 * - `GET /documents/<id>/reject-reasons` — only read on REJECTED/REPROVED.
 *   An empty list is a provider failure; a non-empty one is a document
 *   issue (`KycFailure`'s `isDocumentError = Boolean(rejectReason)`).
 */
Cypress.Commands.add(
  'stubKycOnboarding',
  (
    overrides: {
      status?: 'APPROVED' | 'REJECTED' | 'REPROVED' | 'PENDING_VALIDATION'
      rejectReasons?: string[]
    } = {},
  ) => {
    const { status = 'APPROVED', rejectReasons = [] } = overrides
    cy.intercept('GET', '**/session/active', { data: 'e2e-session' }).as(
      'kycSession',
    )
    cy.intercept('GET', '**/onboardings*', {
      data: {
        onboardingId: 'e2e-onboarding',
        url: 'about:blank',
        provider: 'CAF',
        token: 'e2e-kyc-token',
      },
    }).as('kycOnboarding')
    cy.intercept('GET', '**/documents/CAF/e2e-onboarding', {
      data: { status, id: 4242 },
    }).as('kycStatus')
    cy.intercept('GET', '**/documents/4242/reject-reasons', {
      data: rejectReasons,
    }).as('kycRejectReasons')
  },
)

/**
 * The new-flow activation address screen's reads and write
 * (`useUserAddress`, modules/registration/src/features/activation-flow/activation-address):
 * - `GET /user/address` — `saved` seeds the prefilled "confirm" stage;
 *   `null` (default) starts on the CEP stage instead.
 * - `GET /country/31/regions` and `GET /city?country_id=31` — 31 is Brazil's
 *   id in the global `/country/registration-dropdown` stub (fixtures.ts).
 * - `PUT /user/update-address-and-mobile-number` — `hasNestedData: false`,
 *   so its body is read as-is.
 */
Cypress.Commands.add(
  'stubUserAddress',
  (
    overrides: {
      saved?: Record<string, string> | null
      statusCode?: number
    } = {},
  ) => {
    const { saved = null, statusCode = 200 } = overrides
    cy.intercept('GET', '**/user/address', { data: saved }).as('userAddress')
    cy.intercept('GET', '**/country/31/regions', {
      data: [{ id: 25, name: 'São Paulo' }],
    }).as('regions')
    cy.intercept({ method: 'GET', url: /\/city(\?|$)/ }, {
      data: [{ id: 1, name: 'São Paulo', regionId: 25 }],
    }).as('cities')
    cy.intercept('PUT', '**/user/update-address-and-mobile-number', {
      statusCode,
      body: {},
    }).as('updateAddress')
  },
)

/**
 * Intercom's messenger, as opened by the auth shell's support icon
 * (`useIntercomMessenger().toggleContactUs` → `intercomProvider.js`): it
 * injects `<script src="https://widget.intercom.io/widget/<app id>">`, then
 * calls `Intercom('shutdown' | 'boot' | 'onShow' | 'onHide' | 'show')`.
 * The script is answered with a stand-in that only records those calls on
 * `window.__intercomCalls` — so `show()` resolves `true` exactly as in
 * production, but nothing real loads or opens. Everything else under
 * Intercom's hosts (API, CDN assets) is short-circuited too, in case
 * anything reaches for it directly.
 */
Cypress.Commands.add('stubIntercomWidget', () => {
  // Catch-alls first: the most recently defined matching intercept wins, so
  // the widget stub below has to come after them to be the one answering.
  cy.intercept({ hostname: /(^|\.)intercom\.io$/ }, { statusCode: 200, body: {} })
  cy.intercept({ hostname: /(^|\.)intercomcdn\.com$/ }, {
    statusCode: 200,
    body: '',
  })
  cy.intercept('GET', 'https://widget.intercom.io/widget/*', {
    statusCode: 200,
    headers: { 'content-type': 'application/javascript' },
    body:
      'window.__intercomCalls = window.__intercomCalls || [];' +
      'window.Intercom = function () {' +
      '  window.__intercomCalls.push(Array.prototype.slice.call(arguments));' +
      '};',
  }).as('intercomWidget')
})

// --- Mixpanel event tracking (packages/tracking/src/event-tracking-provider.tsx) ---
// `mixpanel.init(..., { api_transport: 'sendBeacon' })` sends every batch
// through `navigator.sendBeacon`, which `cy.intercept()` never sees (see the
// sendBeacon note in e2e.ts). So capture happens at the source instead: each
// page's `sendBeacon` is wrapped, Mixpanel's `/track` payloads are decoded
// in-page into `window.__trackedEvents`, and the beacon is swallowed — so no
// test event ever reaches the real Mixpanel project either (its token is
// real in every environment). mixpanel-browser reads `navigator.sendBeacon`
// lazily on every send precisely so it can be patched like this
// (mixpanel.cjs.js, "late reference to navigator.sendBeacon").
//
// Wire format (mixpanel-browser 2.78, `_send_request`): the body is the
// string `data=<encodeURIComponent(json)>`, where `json` is one event object
// or, for batched flushes, an array of them. JSON, not base64, because
// `api_payload_format` defaults to JSON for `*.mixpanel.com` hosts — the
// base64 branch below only covers a future config change.

interface TrackedEvent {
  event: string
  properties: Record<string, unknown>
}

type TrackingWindow = Cypress.AUTWindow & { __trackedEvents?: TrackedEvent[] }

const decodeMixpanelBeacon = (body: unknown): TrackedEvent[] => {
  if (typeof body !== 'string') return []
  const raw = new URLSearchParams(body).get('data')
  if (!raw) return []
  const json = /^\s*[[{]/.test(raw) ? raw : atob(raw)
  const parsed = JSON.parse(json)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/**
 * Starts recording every Mixpanel event the app tracks, for every page this
 * test visits from here on. Call before `cy.visit()` (directly or via
 * `startRegistration`/`loginBeforeVisit`). Events live on the page's
 * `window`, so a full navigation (`cy.visit`) starts a fresh list — assert
 * on events from the page they were tracked on.
 *
 * Tracking itself still needs `fe_igp_event_tracking_enabled` on in the
 * caller's `stubGrowthbookFeatures()` — it's off in the base fixture.
 */
Cypress.Commands.add('recordTrackedEvents', () => {
  // Mixpanel's non-beacon calls (flags/decide, session-recording config)
  // go over fetch/XHR, which intercept *does* see — keep those local too.
  cy.intercept('**mixpanel.com/**', { statusCode: 200, body: '1' })
  cy.on('window:before:load', (win: TrackingWindow) => {
    const events: TrackedEvent[] = []
    win.__trackedEvents = events
    const sendBeacon = win.navigator.sendBeacon.bind(win.navigator)
    win.navigator.sendBeacon = (url, data) => {
      if (!url.toString().includes('mixpanel.com/track')) {
        return sendBeacon(url, data)
      }
      events.push(...decodeMixpanelBeacon(data))
      return true
    }
  })
})

/**
 * Waits until EventTrackingProvider's `mixpanel.init()` has run — every
 * `trackEvent()` before `mixpanelLoaded` flips is a silent no-op, so an
 * interaction fired too early would drop its event for good.
 * `persistence: 'localStorage'` makes init write `mp_<token>_mixpanel`,
 * which is the observable signal used here.
 */
Cypress.Commands.add('waitForMixpanel', () => {
  cy.window({ log: false, timeout: 15000 }).should((win) => {
    const keys = Object.keys(win.localStorage)
    expect(
      keys.some((key) => key.startsWith('mp_') && key.endsWith('_mixpanel')),
      'mixpanel initialized',
    ).to.equal(true)
  })
})

/**
 * Waits for `name` to have been tracked exactly once on the current page
 * (the ticket ACs require exactly once) and yields that event. Batches only
 * flush every `batch_flush_interval_ms` (5s default), hence the timeout.
 * Assert on `.its('properties')` with `deep.include` — it compares strictly,
 * so `10000000` and `'10000000'` don't match, which is what enforces the
 * ticket's integer types.
 */
Cypress.Commands.add(
  'waitForTrackedEvent',
  (name: string, { timeout = 15000 }: { timeout?: number } = {}) =>
    cy
      .window({ log: false, timeout })
      .should((win: TrackingWindow) => {
        const matches = (win.__trackedEvents ?? []).filter(
          (tracked) => tracked.event === name,
        )
        // Listing what *was* tracked makes a rename (e.g. `cpf_saved` vs.
        // `registration_cpf_saved`) readable straight off the failure.
        const tracked = (win.__trackedEvents ?? []).map((t) => t.event)
        expect(
          matches,
          `"${name}" tracked exactly once (tracked: ${tracked.join(', ') || 'none'})`,
        ).to.have.length(1)
      })
      .then(
        (win: TrackingWindow) =>
          (win.__trackedEvents ?? []).find((tracked) => tracked.event === name)!,
      ),
)

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
      denyCookieBanner(): Chainable<JQuery<HTMLElement>>
      /** See implementation doc above. */
      dismissCookieBannerIfVisible(options?: {
        wait?: boolean
      }): Chainable<JQuery<HTMLBodyElement>>
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
      /** See implementation doc above. Shared by both login flows. */
      stubTwoFaSendEmail(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. Shared by both login flows. */
      stubTwoFaValidateEmail(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. Shared by both login flows. */
      stubTwoFaSendSms(overrides?: {
        statusCode?: number
        messageCode?: number
        mobileNumber?: string
      }): Chainable<null>
      /** See implementation doc above. Shared by both login flows. */
      stubTwoFaValidateSms(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. Legacy `/forgot-password/` flow only. */
      stubForgotPasswordSendEmailCode(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. Legacy `/forgot-password/` flow only. */
      stubForgotPasswordValidateEmailCode(overrides?: {
        statusCode?: number
        messageCode?: number
        token?: string
        userId?: string
      }): Chainable<null>
      /** See implementation doc above. Legacy `/forgot-password/` flow only. */
      stubForgotPasswordSendSmsCode(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. Legacy `/forgot-password/` flow only. */
      stubForgotPasswordValidateSmsCode(overrides?: {
        statusCode?: number
        messageCode?: number
        token?: string
        userId?: string
      }): Chainable<null>
      /** See implementation doc above. Legacy `/forgot-password/` flow only. */
      stubForgotPasswordLiveness(overrides?: {
        statusCode?: number
        type?: string
      }): Chainable<null>
      /** See implementation doc above. Legacy `/reset/` token-link page only. */
      stubResetPassword(overrides?: {
        statusCode?: number
        messageCode?: number
      }): Chainable<null>
      /** See implementation doc above. New (Registration 2026) forgot-password flow only. */
      stubKycLivenessStatus(overrides?: {
        status?: 'APPROVED' | 'REJECTED' | 'REPROVED'
        id?: number
        statusCode?: number
      }): Chainable<null>
      /** See implementation doc above. New (Registration 2026) forgot-password flow only. */
      stubForgotPasswordResetV2(overrides?: {
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
      loginBeforeVisit(
        path: string,
        user?: Record<string, unknown>,
      ): Chainable<JQuery<HTMLElement>>
      fillCpfStep(
        cpf?: string,
        options?: { acceptAll?: boolean; couponCode?: string },
      ): Chainable<JQuery<HTMLElement>>
      fillPasswordStep(password?: string): Chainable<JQuery<HTMLElement>>
      selectEmailVerificationMethod(): Chainable<JQuery<HTMLElement>>
      selectGoogleVerificationMethod(): Chainable<JQuery<HTMLElement>>
      fillEmailStep(email?: string): Chainable<JQuery<HTMLElement>>
      fillPhoneStep(mobile?: string): Chainable<JQuery<HTMLElement>>
      fillOtp(code?: string): Chainable<JQuery<HTMLElement>>
      /** See implementation doc above. */
      stubKycOnboarding(overrides?: {
        status?: 'APPROVED' | 'REJECTED' | 'REPROVED' | 'PENDING_VALIDATION'
        rejectReasons?: string[]
      }): Chainable<null>
      /** See implementation doc above. */
      stubUserAddress(overrides?: {
        saved?: Record<string, string> | null
        statusCode?: number
      }): Chainable<null>
      /** See implementation doc above. */
      stubIntercomWidget(): Chainable<null>
      /** See implementation doc above. */
      recordTrackedEvents(): Chainable<null>
      /** See implementation doc above. */
      waitForMixpanel(): Chainable<Cypress.AUTWindow>
      /** See implementation doc above. */
      waitForTrackedEvent(
        name: string,
        options?: { timeout?: number },
      ): Chainable<{ event: string; properties: Record<string, unknown> }>
    }
  }
}

export {}
