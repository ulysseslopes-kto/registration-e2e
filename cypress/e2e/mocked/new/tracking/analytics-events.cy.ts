/**
 * KIB-9557 — analytics events for the Account Creation & Activation redesign
 * (v1). One `it()` per row of the ticket's event tables, grouped the same
 * way, asserting only tracking: event name, "exactly once", and the exact
 * parameters/values/types the ticket specifies.
 *
 * The ticket, not current mono-fe code, is the spec here. At the time of
 * writing there's no mono-fe PR for KIB-9557 yet, and main still fires
 * several of these under older names (e.g. `cpf_saved` vs.
 * `registration_cpf_saved`, `RG_limits_*` vs. `activation_rg_limits_*`,
 * `registration_address_*` vs. `activation_address_*` —
 * packages/tracking/src/constants.ts), or not at all (phone step, account
 * creation outcome, invite/complete screens). Those tests are expected to
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
 *   cypress/e2e/mocked/new/registration/.
 * - Login: `/login/` (AuthLandingRoute → AuthLanding).
 * - Activation start: the invite screen AccountCreateRoute shows right after
 *   a successful `registration/v4` — the only place it mounts.
 * - RG limits / facial verification / address / activation / reopening: the
 *   sport lobby's ActivationCard for an already-logged-in user (same shortcut
 *   as activation/limits.cy.ts), with `/activation/steps` pointing at the
 *   step under test.
 *
 * Deliberately skipped (`it.skip`, each says why): events with no Web
 * surface to trigger them — biometric login, Apple login/verification, push
 * notification permission (Flutter-only screens). Google flows never drive
 * the real OAuth popup (`useGoogleLogin`, same reason as LOGIN-05/06 in
 * login/login.cy.ts): selection events fire before it would open, and the
 * Google sign-up (`user_created`) replays the login screen's hand-off
 * instead — see that test.
 *
 * Supersedes registration/mixpanel-tracking.cy.ts's approach (it waits on
 * `cy.intercept('**\/track/**')`, which never sees sendBeacon traffic) and
 * its pre-KIB-9557 event names.
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

// --- Activation (sport lobby → ActivationCard) ---

const INVITE_TITLE = 'Vamos deixar sua conta pronta para diversão?'

// `ACTIVATION_OVERLAY_CLASS` — every native activation screen's wrapper.
const activationScreen = () => cy.get('.activation-step-overlay')

/** Logs in, lands on the lobby, and waits for the ActivationCard's CTA. */
const openLobbyWithActivationCard = () => {
  cy.loginBeforeVisit('/')
  // "No limits set yet" — same premise as activation/limits.cy.ts.
  cy.fixture('limit-empty.json').then((body) => {
    cy.intercept('GET', '**/limit', body)
  })
  cy.dismissCookieBannerIfVisible()
  cy.wait('@activationSteps', { timeout: 20000 })
  cy.waitForMixpanel()
  cy.dismissCookieBannerIfVisible()
  cy.contains('button', 'Ativar conta', { timeout: 15000 }).should(
    'be.visible',
  )
}

const startActivationFromCard = () => {
  openLobbyWithActivationCard()
  cy.contains('button', 'Ativar conta').click()
}

const openRgLimits = () => {
  startActivationFromCard()
  cy.contains('Hora de definir seus limites', { timeout: 15000 }).should(
    'be.visible',
  )
}

const openManualLimits = () => {
  openRgLimits()
  cy.dismissCookieBannerIfVisible()
  activationScreen().contains('button', 'Definir manualmente').click()
  cy.contains('Definir meus limites').should('be.visible')
}

const chooseOtherOption = (fieldId: string) => {
  cy.get(`#${fieldId}`).click()
  cy.get(`#${fieldId}-options`).contains('button', 'Outro').click()
}

/**
 * RG is the only pending step until "Usar limites máximos" is clicked;
 * every read after that reports nothing left, so the flow finishes and the
 * completion screen ("Conta ativada!") mounts. Keyed on the click, not on
 * a read count — the lobby's own redirect remounts the card and re-reads
 * this several times before the CTA is ever clickable (see the last test in
 * activation/limits.cy.ts).
 */
const reachActivationComplete = () => {
  let hasSubmittedLimits = false
  cy.intercept('GET', '**/activation/steps', (req) => {
    req.reply({
      body: {
        data: {
          active: hasSubmittedLimits,
          nextStep: hasSubmittedLimits ? null : 'rg',
          steps: hasSubmittedLimits ? [] : [{ step: 'rg', completed: false }],
        },
      },
    })
  }).as('activationSteps')
  openRgLimits()
  cy.dismissCookieBannerIfVisible()
  activationScreen()
    .contains('button', 'Usar limites máximos')
    .click()
    .then(() => {
      hasSubmittedLimits = true
    })
  cy.contains('Conta ativada!', { timeout: 20000 }).should('be.visible')
}

const openKyc = () => {
  cy.stubActivationSteps({ nextStep: 'kyc' })
  startActivationFromCard()
  cy.wait('@kycOnboarding')
  cy.contains('Verifique sua identidade', { timeout: 15000 }).should(
    'be.visible',
  )
}

const startKycVerification = () => {
  openKyc()
  cy.dismissCookieBannerIfVisible()
  activationScreen().contains('button', 'Começar verificação').click()
  cy.wait('@kycStatus')
}

const SAVED_ADDRESS = {
  address: 'Avenida Paulista',
  number: '1000',
  complement: '',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'São Paulo',
  cep: '01310100',
}

const openAddress = (saved: Record<string, string> | null) => {
  cy.stubActivationSteps({ nextStep: 'address' })
  cy.stubUserAddress({ saved })
  startActivationFromCard()
  cy.wait('@userAddress')
}

describe('KIB-9557 — analytics events, account creation & activation (v1)', () => {
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

  describe('Activation start step', () => {
    beforeEach(() => {
      stubFeatures()
      cy.stubCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.stubValidateToken()
      cy.stubRegister()
      stubPostLoginSession()
    })

    const reachInvite = () => {
      completeRegistration()
      cy.contains(INVITE_TITLE, { timeout: 20000 }).should('be.visible')
    }

    it('activation_onboarding_screen_loaded — invite screen after sign-up', () => {
      reachInvite()

      cy.waitForTrackedEvent('activation_onboarding_screen_loaded')
    })

    it('activation_started — "Ativar minha conta"', () => {
      reachInvite()
      cy.dismissCookieBannerIfVisible()
      cy.contains('button', 'Ativar minha conta').click()

      cy.waitForTrackedEvent('activation_started')
    })

    it('activation_skipped — "Agora não"', () => {
      reachInvite()
      cy.dismissCookieBannerIfVisible()
      cy.contains('button', 'Agora não').click()

      cy.waitForTrackedEvent('activation_skipped')
    })
  })

  describe('RG limits', () => {
    beforeEach(() => {
      stubFeatures({
        fe_registration_loss_limits_enabled: { defaultValue: true },
      })
      stubPostLoginSession()
    })

    it('activation_rg_limits_method_screen_loaded — choice stage mounts', () => {
      openRgLimits()

      cy.waitForTrackedEvent('activation_rg_limits_method_screen_loaded')
    })

    it('activation_rg_limits_max_method_selected — max limits, integer BRL 10000000 and 24 hours', () => {
      openRgLimits()
      cy.dismissCookieBannerIfVisible()
      activationScreen().contains('button', 'Usar limites máximos').click()

      cy.waitForTrackedEvent('activation_rg_limits_max_method_selected')
        .its('properties')
        .should('deep.include', {
          financial_loss_value: 10000000,
          game_time_limit_value: 24,
        })
    })

    it('activation_rg_limits_screen_loaded — manual stage mounts', () => {
      openManualLimits()

      cy.waitForTrackedEvent('activation_rg_limits_screen_loaded')
    })

    // The "Outro" playtime input takes minutes (activation/limits.cy.ts:
    // typing 60 posts `duration: '60'`) — 120 minutes is 2 hours, the unit
    // the ticket wants this reported in.
    it('activation_rg_limits_submitted — manual limits as integers, playtime in hours', () => {
      openManualLimits()
      chooseOtherOption('activation-limits-loss')
      cy.get('#activation-limits-loss').type('50000')
      chooseOtherOption('activation-limits-playtime')
      cy.get('#activation-limits-playtime').type('120')
      cy.dismissCookieBannerIfVisible()
      activationScreen().contains('button', 'Confirmar meus limites').click()
      cy.wait('@setLimit')

      cy.waitForTrackedEvent('activation_rg_limits_submitted')
        .its('properties')
        .should('deep.include', {
          financial_loss_value: 50000,
          game_time_limit_value: 2,
        })
    })
  })

  describe('Facial verification', () => {
    beforeEach(() => {
      stubFeatures()
      stubPostLoginSession()
    })

    it('activation_identity_verification_start_screen_loaded — intro mounts', () => {
      cy.stubKycOnboarding()
      openKyc()

      cy.waitForTrackedEvent(
        'activation_identity_verification_start_screen_loaded',
      )
    })

    it('activation_identity_verification_started — "Começar verificação"', () => {
      cy.stubKycOnboarding({ status: 'PENDING_VALIDATION' })
      startKycVerification()

      cy.waitForTrackedEvent('activation_identity_verification_started')
    })

    it('user_verified — the onboarding comes back APPROVED', () => {
      cy.stubKycOnboarding({ status: 'APPROVED' })
      startKycVerification()

      cy.waitForTrackedEvent('user_verified')
    })

    it('activation_error_loaded — reason "verification_error" (rejected, no document reason)', () => {
      cy.stubKycOnboarding({ status: 'REJECTED', rejectReasons: [] })
      startKycVerification()
      cy.contains('Erro na verificação', { timeout: 1500 }).should(
        'be.visible',
      )

      cy.waitForTrackedEvent('activation_error_loaded')
        .its('properties')
        .should('deep.include', { reason: 'verification_error' })
    })

    it('activation_error_loaded — reason "document_issue" (rejected with a document reason)', () => {
      cy.stubKycOnboarding({
        status: 'REJECTED',
        rejectReasons: ['Documento ilegível'],
      })
      startKycVerification()
      cy.contains('Problema com seu documento', { timeout: 15000 }).should(
        'be.visible',
      )

      cy.waitForTrackedEvent('activation_error_loaded')
        .its('properties')
        .should('deep.include', { reason: 'document_issue' })
    })
  })

  describe('Address', () => {
    beforeEach(() => {
      stubFeatures()
      stubPostLoginSession()
    })

    it('activation_prefilled_address_screen_loaded — a saved address is shown to confirm', () => {
      openAddress(SAVED_ADDRESS)
      cy.contains('Confirme seu endereço residencial').should('be.visible')

      cy.waitForTrackedEvent('activation_prefilled_address_screen_loaded')
    })

    it('activation_address_screen_loaded — editing the prefilled address ("Alterar")', () => {
      openAddress(SAVED_ADDRESS)
      cy.dismissCookieBannerIfVisible()
      activationScreen().contains('button', 'Alterar').click()
      cy.contains('Complete seu endereço').should('be.visible')

      cy.waitForTrackedEvent('activation_address_screen_loaded')
    })

    // Fires on the "verify" stage the CEP lookup lands on, not on the CEP
    // entry stage itself (activation-address.hook.tsx). The lookup goes
    // through `GET /registration/cep/<cep>` while `fe_igp_cep_service_direct`
    // is off; its state/city match `stubUserAddress`'s dropdowns.
    it('activation_address_with_cep_screen_loaded — no saved address, CEP found', () => {
      cy.intercept('GET', '**/registration/cep/*', {
        data: {
          street: 'Avenida Paulista',
          state: 'São Paulo',
          city: 'São Paulo',
        },
      }).as('cepLookup')
      openAddress(null)
      cy.contains('Cadastre seu endereço').should('be.visible')
      cy.dismissCookieBannerIfVisible()
      cy.get('#activation-address-cep').type('01310100')
      activationScreen().contains('button', 'Buscar endereço').click()
      cy.wait('@cepLookup')
      cy.contains('Complete seu endereço').should('be.visible')

      cy.waitForTrackedEvent('activation_address_with_cep_screen_loaded')
    })

    it('activation_address_without_cep_screen_loaded — "Não sei meu CEP"', () => {
      openAddress(null)
      cy.dismissCookieBannerIfVisible()
      activationScreen().contains('button', 'Não sei meu CEP').click()
      activationScreen().contains('button', 'Buscar com CEP').should('exist')

      cy.waitForTrackedEvent('activation_address_without_cep_screen_loaded')
    })

    it('activation_address_saved — confirming the prefilled address', () => {
      openAddress(SAVED_ADDRESS)
      cy.dismissCookieBannerIfVisible()
      activationScreen().contains('button', 'Confirmar').click()
      cy.wait('@updateAddress')

      cy.waitForTrackedEvent('activation_address_saved')
    })
  })

  describe('Activation', () => {
    beforeEach(() => {
      stubFeatures({
        fe_registration_loss_limits_enabled: { defaultValue: true },
      })
      stubPostLoginSession()
    })

    it('account_activated — completion screen after the last step', () => {
      reachActivationComplete()

      cy.waitForTrackedEvent('account_activated')
    })

    it('activation_ftd_started — "Faça seu primeiro depósito"', () => {
      reachActivationComplete()
      cy.dismissCookieBannerIfVisible()
      activationScreen()
        .contains('button', 'Faça seu primeiro depósito', { timeout: 10000 })
        .click()

      cy.waitForTrackedEvent('activation_ftd_started')
    })

    it('activation_ftd_skipped — "Agora não" on the completion screen', () => {
      reachActivationComplete()
      cy.dismissCookieBannerIfVisible()
      activationScreen()
        .contains('button', 'Faça seu primeiro depósito', { timeout: 10000 })
        .should('be.visible')
      activationScreen().contains('button', 'Agora não').click()

      cy.waitForTrackedEvent('activation_ftd_skipped')
    })
  })

  describe('Push notification', () => {
    // The permission-request screen these belong to only exists in the
    // Flutter app — nothing on Web mounts it.
    it.skip('push_notification_request_screen_loaded — Flutter-only', () => {})
    it.skip('push_notification_config_started — Flutter-only', () => {})
    it.skip('push_notification_alowed — Flutter-only', () => {})
    it.skip('push_notification_denied — Flutter-only', () => {})
    it.skip('push_notification_request_skipped — Flutter-only', () => {})
  })

  describe('Activation flow reopening', () => {
    beforeEach(() => {
      stubFeatures({
        fe_registration_loss_limits_enabled: { defaultValue: true },
      })
      stubPostLoginSession()
    })

    it('activation_reopened — location "component", screen_name "sport_lobby"', () => {
      startActivationFromCard()

      cy.waitForTrackedEvent('activation_reopened')
        .its('properties')
        .should('deep.include', {
          location: 'component',
          screen_name: 'sport_lobby',
        })
    })

    it('activation_component_expanded — "Ver etapas da ativação" on the card', () => {
      openLobbyWithActivationCard()
       cy.get('button[aria-expanded="false"] [data-testid="chevron-down-icon"]')
        .should('be.visible')
        .click()

      cy.waitForTrackedEvent('activation_component_expanded')
    })
  })
})
