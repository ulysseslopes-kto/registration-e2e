/**
 * KIB-9557 — analytics events for the Activation redesign (v1), the
 * activation half (registration's lives in registration/analytics-events.cy.ts).
 * One `it()` per row of the ticket's event tables, grouped the same way,
 * asserting only tracking: event name, "exactly once", and the exact
 * parameters/values/types the ticket specifies.
 *
 * The ticket, not current mono-fe code, is the spec here. At the time of
 * writing there's no mono-fe PR for KIB-9557 yet, and main still fires
 * several of these under older names (e.g. `RG_limits_*` vs.
 * `activation_rg_limits_*`, `registration_address_*` vs. `activation_address_*`
 * — packages/tracking/src/constants.ts), or not at all (invite/complete
 * screens). Those tests are expected to fail until the instrumentation
 * lands; they're how "done" gets checked.
 *
 * How events are captured: see `recordTrackedEvents` in
 * cypress/support/commands.ts — Mixpanel's `sendBeacon` batches are decoded
 * in-page, never sent. `fe_igp_event_tracking_enabled` (off in the base
 * GrowthBook fixture) is turned on for every test via `stubFeatures`.
 *
 * Entry points, per group:
 * - Activation start: the invite screen AccountCreateRoute shows right after
 *   a successful `registration/v4` — the only place it mounts — so these go
 *   through the `/registro/` sign-up first.
 * - RG limits / facial verification / address / activation / reopening: the
 *   sport lobby's ActivationCard for an already-logged-in user (same shortcut
 *   as limits.cy.ts), with `/activation/steps` pointing at the step under
 *   test.
 *
 * Deliberately skipped (`it.skip`): push notification permission — a
 * Flutter-only screen with no Web surface to trigger it.
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

// --- Account-create flow (/registro/), only to reach the invite screen ---

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

describe('KIB-9557 — analytics events, activation (v1)', () => {
  beforeEach(() => {
    cy.recordTrackedEvents()
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
