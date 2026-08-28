/**
 * Legacy registration (`RegisterPageContent`/`RegisterContent`,
 * apps/core/src/atomic-components/organisms/registerContent) — the
 * pre-KIB-8932 multi-step form still rendered whenever
 * `fe_igp_registration_new_ui_experience` is off. Not part of the "Registro
 * 2026" test matrix — a separate, isolated suite for the flow it replaced.
 * Covers every step: CPF/e-mail/password → e-mail verification → phone
 * verification → address, ending in the same final submit
 * (`registration/v4`) as the new flow.
 *
 * `registration_new_flow` is forced on in the fixture below purely to dodge
 * a real, reproducible app bug — not because this suite cares about that
 * flag. With it off (this suite's actual GrowthBook default),
 * `getLastIndex()` in apps/core/src/hooks/useRegistrationSteps.js (~line
 * 130) computes `REGISTRATION_STEPS.findIndex(step => !step.isOldFlow) - 1`,
 * which is `0 - 1 = -1` (no step sets `isOldFlow`, so the first step always
 * matches) — and since `-1` isn't nullish, the trailing
 * `?? REGISTRATION_STEPS.length - 1` never kicks in. `formStep` then
 * advances to `-1` on the very first "next", and `REGISTRATION_STEPS[-1]` is
 * undefined — a hard crash advancing past the CPF/e-mail/password step.
 * Worth a real bug report to whoever still owns this flow; this suite works
 * around it rather than asserting around a crash.
 *
 * The optional Google-sign-in `REGISTER_LOBBY` step (behind
 * `fe_social_sign_in_enabled`) isn't covered — same scope call as the new
 * flow's suite skipping Google SSO.
 *
 * Selectors (`#national_id`, `#email`, `#mobilePrefix`, `#mobileNumber`,
 * `#password`, `#nationality`, `#tandc`/`#privacyPolicy`/`#marketing`/
 * `#belongHere`, `#nextBtn1`, `#otp-input`, `#resend`, `#cep`, `#address`,
 * `#addressNumber`, `#state`, `#city`) are literal DOM ids from the shared
 * `Field`/`FieldDropdown`/`Checkbox`/`FieldVerificationCode` primitives —
 * unrelated to the new flow's selectors. Endpoints mostly match the new
 * flow's (`stubSendToken`/`stubValidateToken`/`stubRegister` all work
 * unmodified) except the CPF check (`stubLegacyCpfCheck`, `/cpf/check/v3`
 * not `/cpf-checks/v4`) and phone verification, which has no new-flow
 * equivalent at all (`stubLegacySmsSend`/`stubLegacySmsValidate`).
 *
 * The address step's CEP → street/state/city autofill, and the state/city
 * dropdowns it validates against, are deliberately left un-stubbed: both
 * come from the same real backend (`GET /registration/cep/{cep}` and
 * `GET /country/{id}/regions` + `GET /city`), so hand-rolling a CEP response
 * risks a state/city name that doesn't match what the dropdowns actually
 * loaded — a real, well-known CEP keeps the two in sync automatically.
 */
describe('Legacy registration', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
    registration_new_flow: { defaultValue: true },
    // Off by default — `checkNationalId` gates whether `EmailAndPasswordStep`
    // calls `checkCaf()` (the CPF check) at all; without this, the CPF is
    // accepted at face value past client-side format validation, and
    // `stubLegacyCpfCheck`'s intercept never fires.
    player_registration_national_id_check: { defaultValue: true },
    igp_registration_verification_phases: {
      defaultValue: {
        registration_phase: [
          { step: 'email_verification', visible: true },
          { step: 'phone_verification', visible: true },
          { step: 'address', visible: true },
        ],
        activation_phase: [],
      },
    },
  }

  const fillEmailAndPasswordStep = () => {
    cy.get('#national_id').type('529.982.247-25')
    cy.get('#email').type('e2e-test@example.com')
    cy.get('#mobileNumber').type('11987654321')
    cy.get('#password').type('Sup3rSecret!23')
    cy.get('#nationality').select('Brasileira')
    cy.get('#tandc').check({ force: true })
    cy.get('#privacyPolicy').check({ force: true })
    cy.get('#belongHere').check({ force: true })
  }

  /** Assumes stubEmailCheck/stubLegacyCpfCheck/stubSendToken are already set up. */
  const completeEmailAndPasswordStep = () => {
    fillEmailAndPasswordStep()
    cy.get('#nextBtn1').click()
    cy.wait('@emailCheck')
    cy.wait('@legacyCpfCheck')
    // EmailVerificationStep sends its code automatically on mount.
    cy.wait('@sendToken')
    cy.get('#otp-input', { timeout: 10000 }).should('be.visible')
  }

  /** Assumes stubValidateToken/stubLegacySmsSend are already set up. */
  const completeEmailVerificationStep = (code = '1234') => {
    cy.get('#otp-input').type(code)
    cy.wait('@validateToken')
    // PhoneVerificationStep sends its code automatically on mount.
    cy.wait('@legacySmsSend')
    cy.get('#otp-input', { timeout: 10000 }).should('be.visible')
  }

  /** Assumes stubLegacySmsValidate is already set up. */
  const completePhoneVerificationStep = (code = '1234') => {
    cy.get('#otp-input').type(code)
    cy.wait('@legacySmsValidate')
    cy.get('#cep', { timeout: 10000 }).should('be.visible')
  }

  describe('CPF/e-mail/password step', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(LEGACY_FLOW)
      cy.acceptCookieBanner()
      cy.visit('/registro/')
      cy.get('#register-form', { timeout: 10000 }).should('exist')
    })

    it('renders the legacy form (not the new account-create flow)', () => {
      cy.get('#national_id').should('be.visible')
      cy.get('#email').should('be.visible')
      cy.get('#mobileNumber').should('be.visible')
      cy.get('#password').should('be.visible')
      cy.get('#nextBtn1').should('be.visible').and('be.disabled')
      // Confirms this really is the legacy component, not the new one.
      cy.get('input[inputmode="numeric"]').should('not.exist')
    })

    it('an invalid CPF check-digit shows a format error on blur, "Próximo" stays disabled', () => {
      // 111.444.777-36 — wrong check digit (valid one is ...-35). Validated
      // client-side (`validateNationalId`/`cpfValidator`, no network call) —
      // legacy's message here ("O CPF está incorreto.") is a different
      // translation key from the new flow's "CPF inválido..." string.
      cy.get('#national_id').type('111.444.777-36').blur()
      cy.contains('O CPF está incorreto.').should('be.visible')
      cy.get('#nextBtn1').should('be.disabled')
    })

    it('filling every required field and checking the required consents enables "Próximo"', () => {
      cy.get('#nextBtn1').should('be.disabled')
      fillEmailAndPasswordStep()
      cy.get('#nextBtn1').should('not.be.disabled')
    })

    it('an e-mail already in use shows the inline error and does not advance', () => {
      cy.stubEmailCheck({ valid: false })
      cy.stubLegacyCpfCheck()
      fillEmailAndPasswordStep()
      cy.get('#nextBtn1').click()
      cy.wait('@emailCheck')
      cy.contains(
        'Este e-mail já está em uso. Por favor, escolha outro!',
      ).should('be.visible')
      cy.get('#national_id').should('be.visible')
    })
  })

  describe('e-mail verification step', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(LEGACY_FLOW)
      cy.stubLegacyCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.acceptCookieBanner()
      cy.visit('/registro/')
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      completeEmailAndPasswordStep()
    })

    it('a correct 4-digit code submits automatically and advances to phone verification', () => {
      cy.stubValidateToken()
      cy.stubLegacySmsSend()
      completeEmailVerificationStep()
    })

    it('an incorrect code shows an error toast and stays on this step', () => {
      cy.stubValidateToken({ statusCode: 400, messageCode: 32 })
      cy.get('#otp-input').type('1234')
      cy.wait('@validateToken')
      cy.contains('Código incorreto. Por favor, tente novamente.').should(
        'be.visible',
      )
      cy.get('#otp-input').should('be.visible')
    })
  })

  describe('phone verification step', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(LEGACY_FLOW)
      cy.stubLegacyCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.stubValidateToken()
      cy.stubLegacySmsSend()
      cy.acceptCookieBanner()
      cy.visit('/registro/')
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      completeEmailAndPasswordStep()
      completeEmailVerificationStep()
    })

    it('a correct 4-digit code advances to the address step', () => {
      cy.stubLegacySmsValidate()
      completePhoneVerificationStep()
    })

    it('an incorrect code shows an error toast and stays on this step', () => {
      cy.stubLegacySmsValidate({ statusCode: 400, messageCode: 602 })
      cy.get('#otp-input').type('1234')
      cy.wait('@legacySmsValidate')
      cy.contains('Código incorreto. Por favor, tente novamente.').should(
        'be.visible',
      )
      cy.get('#otp-input').should('be.visible')
    })
  })

  describe('address step (final step — submits registration/v4)', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(LEGACY_FLOW)
      cy.stubLegacyCpfCheck()
      cy.stubEmailCheck()
      cy.stubSendToken()
      cy.stubValidateToken()
      cy.stubLegacySmsSend()
      cy.stubLegacySmsValidate()
      cy.acceptCookieBanner()
      cy.visit('/registro/')
      cy.get('#register-form', { timeout: 10000 }).should('exist')
      completeEmailAndPasswordStep()
      completeEmailVerificationStep()
      completePhoneVerificationStep()
    })

    it('a real CEP auto-fills address/state/city, and submitting registers the account', () => {
      cy.stubRegister()
      cy.stubLogin() // loginUser() downstream calls, after a successful registration/v4
      // Av. Paulista, São Paulo/SP — a stable, well-known real CEP.
      cy.get('#cep').type('01310-100')
      cy.get('#addressNumber').type('1000')
      cy.get('#nextBtn1').should('have.text', 'Registre-se').click()
      cy.wait('@register')
    })

    it('a nonexistent CEP shows an error and falls back to manual entry', () => {
      cy.get('#cep').type('00000-000')
      cy.contains('Este CEP não existe.').should('be.visible')
      cy.get('#address').should('be.visible').and('not.be.disabled')
    })
  })
})
