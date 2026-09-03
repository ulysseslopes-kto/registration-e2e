/**
 * Legacy login's migratable-account flow, driven end to end through the
 * migration modal into a completed registration
 * (`getUserMigratableStatus`, apps/core/src/utils/getUserMigratableStatus/index.js) —
 * `onSubmit` (apps/core/src/templates/onBoarding/login.js) awaits
 * `POST /registration/user/is-migrateable` before ever calling `doLogin`; a
 * migratable account opens `RegisterModal` with `flow:
 * REGISTER_MODAL_FLOWS.LOGIN` instead.
 *
 * That modal renders the exact same `RegisterContent` component tree as a
 * plain registration (`cypress/e2e/mocked/legacy/registration/registration.cy.ts`)
 * — same steps, same DOM ids (`#otp-input`, `#cep`, `#nextBtn1`, ...), same
 * backend endpoints. The one difference is `EmailAndPasswordStep`
 * (apps/core/.../registerContent/steps/emailAndPasswordStep/index.js): for
 * `flow === REGISTER_MODAL_FLOWS.LOGIN` it renders a "let's migrate you"
 * message instead of CPF/e-mail/password fields, gated only by the three
 * consent checkboxes — `email`/`national_id`/`password` are instead carried
 * over from the login form and the migratable-status response
 * (`RegisterContent`'s `userData` prop, set via `setValue` in a `useEffect`).
 * Clicking "Próximo" there still fires the same `aditionalChecks()`
 * (e-mail-taken check, then the CPF check when
 * `player_registration_national_id_check` is on) as a plain registration —
 * `stubEmailCheck()`/`stubLegacyCpfCheck()` below are for that.
 *
 * `useRegistrationSteps.js`'s own `isMigratable` concept (which would skip
 * every non-start step) never actually engages — nothing in the codebase
 * ever calls the `setMigratableData` it depends on — so despite the flow
 * name, every step below still renders and needs completing, exactly like
 * `registration.cy.ts`'s full-flow test. `registration_new_flow` is forced
 * on in the fixture for the same reason it is there: dodging that same
 * hook's `getLastIndex()` crash when the flag is off (this suite's actual
 * GrowthBook default).
 *
 * Unlike `registration.cy.ts`, the address step here is never given a CEP:
 * `CepAddressStep`'s `handleDefaultData()` (cepAddressStep/index.js) already
 * prepopulates `address`/`state`/`city` straight from the migratable-status
 * response's own `state`/`city`/`address` (`defaultData`, the same
 * `userData` passed through `RegisterContent`) as soon as the real
 * `country/{id}/regions`/`city` lookups it validates those names against
 * resolve — the address a real migrated user already has on file, not a
 * fresh one. `#nextBtn1` only requires `address`/`city`/`state`
 * (`fieldsToWatch` in that component) — `cep` itself isn't required — so it
 * enables on its own once that prefill resolves, with nothing here typed
 * into the CEP field at all.
 */
describe('Legacy login — migratable flow (full registration)', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
    registration_new_flow: { defaultValue: true },
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

  it('a migratable account completes the migration modal and registers', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    // A real capture of POST /registration/user/is-migrateable — migratable,
    // with an existing account's data to carry into the modal, including the
    // `state`/`city`/`address` the address step below prefills from (see the
    // file header).
    cy.stubMigratableStatus({
      migrateable: true,
      hasBalance: true,
      isSelfExcluded: null,
      selfExclusionEndDate: null,
      nationalId: '01564721043',
      phone: '51988888888',
      phonePrefix: '+55',
      state: 'Rio Grande do Sul',
      city: 'Santa Cruz do Sul',
      address: '123',
      zipCode: null,
    })
    cy.stubEmailCheck()
    cy.stubLegacyCpfCheck()
    cy.stubSendToken()
    cy.stubValidateToken()
    cy.stubLegacySmsSend()
    cy.stubLegacySmsValidate()
    cy.stubRegister()
    cy.stubLogin() // loginUser() downstream calls, after a successful registration/v4
    cy.acceptCookieBanner()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('#new-login').click()
    cy.wait('@migratableStatus')

    cy.get('#register-modal').should('be.visible')
    cy.contains('Bem-vindo de volta!').should('be.visible')
    cy.get('#register-modal #nextBtn1').should('be.disabled')
    cy.get('#register-modal #tandc').check({ force: true })
    cy.get('#register-modal #privacyPolicy').check({ force: true })
    cy.get('#register-modal #belongHere').check({ force: true })
    cy.get('#register-modal #nextBtn1').should('not.be.disabled').click()

    // Same `aditionalChecks()` as a plain registration's first step (file
    // header) — the e-mail-taken check, then the CPF check.
    cy.wait('@emailCheck')
    cy.wait('@legacyCpfCheck')
    // EmailVerificationStep sends its code automatically on mount.
    cy.wait('@sendToken')
    cy.get('#otp-input', { timeout: 10000 }).should('be.visible')
    cy.get('#otp-input').type('1234')
    cy.wait('@validateToken')
    // PhoneVerificationStep sends its code automatically on mount.
    cy.wait('@legacySmsSend')
    cy.get('#otp-input', { timeout: 10000 }).should('be.visible')
    cy.get('#otp-input').type('1234')
    cy.wait('@legacySmsValidate')

    // No CEP typed — the migratable-status response's own `state`/`city`/
    // `address` prepopulate this step directly (see the file header).
    // `#nextBtn1` becomes enabled on its own once that prefill resolves
    // against the real regions/cities lookup.
    cy.get('#nextBtn1', { timeout: 10000 })
      .should('have.text', 'Registre-se')
      .and('not.be.disabled')
      .click()
    cy.wait('@register')
  })
})
