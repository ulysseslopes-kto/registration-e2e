/**
 * KIB-9557 — analytics events for the Account Creation redesign (v1), the
 * registration half (activation's lives in activation/analytics-events.cy.ts).
 * One `it()` per row of the ticket's event tables, grouped the same way,
 * asserting only tracking: event name, "exactly once", and the exact
 * parameters/values/types the ticket specifies.
 *
 * The ticket, not current mono-fe code, is the spec here. At the time of
 * writing there's no mono-fe PR for KIB-9557 yet, and main still fires
 * several of these under older names (e.g. `cpf_saved` vs.
 * `registration_cpf_saved` — packages/tracking/src/constants.ts), or not at
 * all (phone step, account creation outcome). Those tests are expected to
 * fail until the instrumentation lands; they're how "done" gets checked.
 *
 * How events are captured: see `recordTrackedEvents` in
 * cypress/support/commands.ts — Mixpanel's `sendBeacon` batches are decoded
 * in-page, never sent. `fe_igp_event_tracking_enabled` (off in the base
 * GrowthBook fixture) is turned on for every test via `stubFeatures`.
 *
 * Entry points, per group:
 * - Header/CPF/password/phone/verification/account creation: `/registro/`
 *   (AccountCreateRoute → AccountCreateFlow), same helpers as the rest of
 *   this folder.
 * - Login: `/login/` (AuthLandingRoute → AuthLanding).
 *
 * Deliberately skipped (`it.skip`, each says why): events with no Web
 * surface to trigger them — biometric login, Apple login/verification.
 * Google flows never drive the real OAuth popup (`useGoogleLogin`, same
 * reason as LOGIN-05/06 in login/login.cy.ts): selection events fire before
 * it would open, and the Google sign-up (`user_created`) replays the login
 * screen's hand-off instead — see that test.
 */

const stubFeatures = (extra: Record<string, unknown> = {}) =>
  cy.stubGrowthbookFeatures({
    fe_igp_event_tracking_enabled: { defaultValue: true },
    ...extra,
  })

/**
 * Everything a logged-in session fires once the lobby mounts — same set as
 * activation/limits.cy.ts's `beforeEach`: the global session calls
 * (`stubActiveSession`), the ActivationCard's `/activation/steps`, and the
 * `/limit/period` + `POST /limit` pair (RealityCheckProvider posts its own
 * default on login — `stubSetLimit` routes that to `@realityCheckLimit`).
 * For any group whose tests end logged in: login, sign-up (auto-login off
 * `registration/v4`) and every activation screen. A test that needs a
 * different `/activation/steps` answer stubs it after this, so it wins.
 */
const stubPostLoginSession = () => {
  cy.stubActiveSession()
  cy.stubActivationSteps()
  cy.stubLimitPeriods()
  cy.stubSetLimit()
  // Kambi's player-rewards status (`ctn-auth-api.kambicdn.com/player/api/
  // .../reward/status/...`), fired by the sportsbook once logged in. e2e.ts's
  // `**kambicdn.com/**` glob doesn't catch it — seen going out for real
  // (401) — so match on hostname instead.
  cy.intercept({ hostname: /(^|\.)kambicdn\.com$/ }, { statusCode: 200, body: {} })
}

// --- Account-create flow (/registro/) ---

const startRegistration = () => {
  cy.startRegistration()
  cy.waitForMixpanel()
}

const passCpfStep = () => {
  cy.fillCpfStep()
  cy.wait('@cpfCheck')
}

const reachVerificationMethod = () => {
  startRegistration()
  passCpfStep()
  cy.fillPasswordStep()
}

const reachOtp = () => {
  reachVerificationMethod()
  cy.selectEmailVerificationMethod()
  cy.fillEmailStep()
  cy.wait('@emailCheck')
  cy.wait('@sendToken')
}

const completeRegistration = () => {
  reachOtp()
  cy.fillOtp()
  cy.wait('@validateToken')
  cy.wait('@register')
}

/** Order phone first so it's reachable without the e-mail sub-flow. */
const stubPhoneFirst = () => {
  stubFeatures({
    fe_igp_registration_post_password_step_order: {
      defaultValue: {
        post_password_phase: [
          { step: 'phone', visible: true },
          { step: 'email_verification', visible: true },
        ],
      },
    },
  })
  cy.stubCpfCheck({ mobilePrefixAndNumberRequired: true })
}

/**
 * `useGoogleLogin` calls `window.open` for its OAuth popup — neutralized so
 * nothing real opens; the tracking call runs before it either way.
 */
const neutralizeGooglePopup = () => {
  cy.on('window:before:load', (win) => {
    win.open = () => null
  })
}

describe('KIB-9557 — analytics events, account creation (v1)', () => {
  beforeEach(() => {
    cy.recordTrackedEvents()
  })

  describe('Header', () => {
    beforeEach(() => {
      stubFeatures()
      cy.stubCpfCheck()
      cy.stubIntercomWidget()
    })

    it('customer_support_opened — support icon in the header, location "header"', () => {
      startRegistration()
      cy.get('.auth-shell-support-button').click()
      // The click went all the way through to opening the messenger.
      cy.wait('@intercomWidget')
      cy.window()
        .its('__intercomCalls')
        .should('deep.include', ['show'])

      cy.waitForTrackedEvent('customer_support_opened')
        .its('properties')
        .should('deep.include', { location: 'header' })
    })
  })

  describe('Login', () => {
    beforeEach(() => {
      stubFeatures()
      cy.stubLogin()
      stubPostLoginSession()
    })

    const openLogin = () => {
      cy.visit('/login/')
      cy.dismissCookieBannerIfVisible()
      cy.waitForMixpanel()
    }

    const submitLogin = () => {
      cy.get('input[autocomplete="username"]').type('e2e-test@example.com')
      cy.get('input[autocomplete="current-password"]').type('Sup3rSecret!23')
      cy.dismissCookieBannerIfVisible()
      cy.get('button[type="submit"]').should('not.be.disabled').click()
    }

    it('login_with_email_selected — submitting the e-mail/password form', () => {
      openLogin()
      submitLogin()

      cy.waitForTrackedEvent('login_with_email_selected')
    })

    it('logged_in — once the login succeeds', () => {
      openLogin()
      submitLogin()
      cy.wait('@login')

      cy.waitForTrackedEvent('logged_in')
    })

    it('login_with_google_selected — the Google button', () => {
      neutralizeGooglePopup()
      openLogin()
      cy.get('.auth-landing-google-button').click()

      cy.waitForTrackedEvent('login_with_google_selected')
    })

    it('registration_started — the "create account" link', () => {
      openLogin()
      cy.get('.auth-landing-register-link').click()

      cy.waitForTrackedEvent('registration_started')
    })

    it.skip('login_with_biometric_turned_on — Flutter-only, no biometric login on Web', () => {})

    it.skip('login_with_apple_selected — Flutter-only, no Apple login on Web', () => {})
  })

  describe('CPF step', () => {
    beforeEach(() => {
      stubFeatures()
      cy.stubCpfCheck()
    })

    it('registration_cpf_screen_loaded — on mount', () => {
      startRegistration()

      cy.waitForTrackedEvent('registration_cpf_screen_loaded')
    })

    it('registration_cpf_saved — after an approved CPF submit', () => {
      startRegistration()
      passCpfStep()

      cy.waitForTrackedEvent('registration_cpf_saved')
    })

    it('registration_legal_acceptance_view_more_opened — expanding "Ver mais"', () => {
      startRegistration()
      cy.get('.cpf-terms-toggle').click()

      cy.waitForTrackedEvent('registration_legal_acceptance_view_more_opened')
    })
  })

  describe('Password step', () => {
    beforeEach(() => {
      stubFeatures()
      cy.stubCpfCheck()
    })

    it('registration_password_screen_loaded — on mount', () => {
      startRegistration()
      passCpfStep()

      cy.waitForTrackedEvent('registration_password_screen_loaded')
    })

    it('registration_password_saved — after submitting a valid password', () => {
      reachVerificationMethod()

      cy.waitForTrackedEvent('registration_password_saved')
    })
  })

  describe('Phone step', () => {
    beforeEach(() => {
      stubPhoneFirst()
    })

    it('registration_phone_screen_loaded — on mount', () => {
      reachVerificationMethod()
      cy.get('input[inputmode="tel"]').should('be.visible')

      cy.waitForTrackedEvent('registration_phone_screen_loaded')
    })

    it('registration_phone_saved — after submitting a valid number', () => {
      reachVerificationMethod()
      cy.fillPhoneStep()
      cy.get('.verification-method-row').should('exist')

      cy.waitForTrackedEvent('registration_phone_saved')
    })
  })

  describe('Account verification step', () => {
    beforeEach(() => {
      stubFeatures()
      cy.stubCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
    })

    it('registration_method_screen_loaded — on mount', () => {
      reachVerificationMethod()
      cy.get('.verification-method-row').should('exist')

      cy.waitForTrackedEvent('registration_method_screen_loaded')
    })

    // The event name's typo is the ticket's (and constants.ts's) literal.
    it('verfication_method_selected — method "email"', () => {
      reachVerificationMethod()
      cy.selectEmailVerificationMethod()

      cy.waitForTrackedEvent('verfication_method_selected')
        .its('properties')
        .should('deep.include', { method: 'email' })
    })

    it('verfication_method_selected — method "google"', () => {
      neutralizeGooglePopup()
      reachVerificationMethod()
      cy.selectGoogleVerificationMethod()

      cy.waitForTrackedEvent('verfication_method_selected')
        .its('properties')
        .should('deep.include', { method: 'google' })
    })

    it.skip('verfication_method_selected — method "apple": no Apple verification on Web', () => {})

    it('registration_email_input_screen_loaded — after choosing e-mail', () => {
      reachVerificationMethod()
      cy.selectEmailVerificationMethod()

      cy.waitForTrackedEvent('registration_email_input_screen_loaded')
    })

    it('registration_email_code_verification_screen_loaded — OTP screen mounts', () => {
      reachOtp()

      cy.waitForTrackedEvent('registration_email_code_verification_screen_loaded')
    })

    // Fired by `submitOtp` (email-verification-step.hook.tsx) once the typed
    // code comes back from `registration/email/validate-token`, with a
    // `response` param reporting the outcome — the ticket's table lists no
    // params for this event; `response` is the implementation's, kept as
    // agreed for v1.
    it('registration_email_code_sent — response "success" when the code is accepted', () => {
      cy.stubValidateToken()
      reachOtp()
      cy.fillOtp()
      cy.wait('@validateToken')

      cy.waitForTrackedEvent('registration_email_code_sent')
        .its('properties')
        .should('deep.include', { response: 'success' })
    })

    it('registration_email_code_sent — response "fail" when the code is rejected', () => {
      cy.stubValidateToken({ statusCode: 400 })
      reachOtp()
      cy.fillOtp()
      cy.wait('@validateToken')

      cy.waitForTrackedEvent('registration_email_code_sent')
        .its('properties')
        .should('deep.include', { response: 'fail' })
    })
  })

  describe('Account creation', () => {
    beforeEach(() => {
      stubFeatures()
      cy.stubCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.stubValidateToken()
    })

    // The ticket calls this param `method`; the implementation sends
    // `register_method` (`resolveRegisterMethod`, account-create.utils.ts) —
    // kept as agreed for v1.
    it('user_created — register_method "email", after registration/v4 succeeds', () => {
      cy.stubRegister()
      stubPostLoginSession()
      completeRegistration()

      cy.waitForTrackedEvent('user_created')
        .its('properties')
        .should('deep.include', { register_method: 'email' })
    })

    // A Google sign-up reaches `/registro/` from the login screen's Google
    // button with the account's e-mail in sessionStorage
    // (`storageService.setSessionValue('verifiedEmail', ...)`, read once by
    // AccountCreateRoute). Seeding it directly replays that hand-off without
    // the OAuth popup: the e-mail step auto-verifies it through
    // `mark-verified` and `resolveRegisterMethod` reports `google`.
    it('user_created — register_method "google", sign-up handed over from Google login', () => {
      cy.stubMarkVerified()
      cy.stubRegister()
      stubPostLoginSession()
      cy.visit('/registro/', {
        onBeforeLoad: (win) => {
          win.sessionStorage.setItem('@kto:verifiedEmail', 'e2e-test@example.com')
        },
      })
      cy.dismissCookieBannerIfVisible()
      cy.waitForMixpanel()
      passCpfStep()
      cy.fillPasswordStep()
      cy.wait('@markVerified')
      cy.wait('@register')

      cy.waitForTrackedEvent('user_created')
        .its('properties')
        .should('deep.include', { register_method: 'google' })
    })

    it.skip('user_created — register_method "apple": no Apple sign-up on Web', () => {})

    it('registration_cpf_restricted_screen_loaded — a REJECTED CPF check ends on the restricted screen', () => {
      stubFeatures({
        fe_igp_registration_cpf_check_poll_ms: { defaultValue: 50 },
      })
      cy.intercept('POST', '**/registration/cpf-checks/v4', {
        data: { status: 'PENDING', cpfCheckId: 'kib-9557' },
      }).as('cpfCheck')
      cy.intercept('GET', '**/registration/cpf-checks/v4/kib-9557', {
        data: { status: 'REJECTED', cpfCheckId: 'kib-9557' },
      })
      reachOtp()
      cy.fillOtp()
      cy.contains('button', 'Voltar').should('be.visible')

      cy.waitForTrackedEvent('registration_cpf_restricted_screen_loaded')
    })

    it('registration_server_error_screen_loaded — registration/v4 fails', () => {
      cy.stubRegister({ statusCode: 500 })
      completeRegistration()
      cy.contains('button', 'Tentar novamente').should('be.visible')

      cy.waitForTrackedEvent('registration_server_error_screen_loaded')
    })
  })
})
