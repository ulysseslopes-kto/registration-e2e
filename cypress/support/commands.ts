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
 * Stubs `GET /country/check` (packages/growthbook/src/GrowthBookProvider.tsx)
 * with a fixed country, so `isGrowthBookReady` doesn't depend on the real
 * backend responding. Normally called indirectly via `stubGrowthbookFeatures`;
 * call directly only in a test that needs this endpoint covered without also
 * stubbing GrowthBook features.
 */
Cypress.Commands.add('stubCountryCheck', (name = 'Brazil') => {
  cy.intercept('GET', '**/country/check', { data: { name } }).as(
    'countryCheck',
  )
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
 * Suppress the cookie banner → visit `/registro/` directly. Goes straight to
 * the registration screen instead of the home page → register-CTA click, so
 * tests don't depend on the home page's marketing banners (whose Gatsby
 * `<Link>`s prefetch-`HEAD` their target pages when scrolled into view).
 */
Cypress.Commands.add('startRegistration', () => {
  cy.acceptCookieBanner()
  cy.visit('/registro/')
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
 * /user`, `GET /limit`, `POST /intercom/token` — so a full login round-trip
 * never depends on the real backend.
 */
Cypress.Commands.add(
  'stubLogin',
  (overrides: { statusCode?: number; body?: Record<string, unknown> } = {}) => {
    const {
      statusCode = 200,
      body = { access_token: 'e2e-token', refresh_token: 'e2e-refresh' },
    } = overrides
    cy.intercept('POST', '**/auth/login', { statusCode, body: { data: body } }).as(
      'login',
    )
    cy.intercept('GET', '**/user', {
      data: { id: 'e2e-user', email: 'e2e-test@example.com', first_name: 'E2E' },
    }).as('getUser')
    cy.intercept('GET', '**/limit', { data: [] }).as('getLimits')
    cy.intercept('POST', '**/intercom/token', { data: 'e2e-intercom-token' }).as(
      'intercomToken',
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
      stubCountryCheck(name?: string): Chainable<null>
      /** See implementation doc above. */
      acceptCookieBanner(): Chainable<JQuery<HTMLElement>>
      /** Home → accept cookies → click the header's register CTA. */
      startRegistration(): Chainable<JQuery<HTMLElement>>
      stubCpfCheck(overrides?: {
        status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ERROR'
        cpfCheckId?: string | null
        mobilePrefixAndNumberRequired?: boolean
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
      fillCpfStep(
        cpf?: string,
        options?: { acceptAll?: boolean },
      ): Chainable<JQuery<HTMLElement>>
      fillPasswordStep(password?: string): Chainable<JQuery<HTMLElement>>
      selectEmailVerificationMethod(): Chainable<JQuery<HTMLElement>>
      selectGoogleVerificationMethod(): Chainable<JQuery<HTMLElement>>
      fillEmailStep(email?: string): Chainable<JQuery<HTMLElement>>
      fillOtp(code?: string): Chainable<JQuery<HTMLElement>>
    }
  }
}

export {}
