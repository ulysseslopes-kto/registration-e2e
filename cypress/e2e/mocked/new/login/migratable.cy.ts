/**
 * New "Registration 2026" login's migratable-account flow, driven end to end
 * through the migration modal into a completed registration
 * (`AuthLandingRoute.js`'s `onLogin` awaits `getUserMigratableStatus`,
 * `POST /registration/user/is-migrateable`, before ever calling `doLogin`).
 *
 * A migratable account here opens the exact same modal as the legacy flow
 * (`AuthLandingRoute.js` → `open({ type: ModalTypes.REGISTER, data: { flow:
 * REGISTER_MODAL_FLOWS.LOGIN, ... } })` → `ModalContainer` →
 * `RegisterModal`/`RegisterContent`, apps/core/.../atomic-components/organisms/
 * registerModal — the pre-KIB-8932 component tree, unrelated to the new
 * account-create module). `AuthLandingRoute.js` explicitly mounts
 * `<SuspensfulComponent componentName="ModalContainer" .../>` itself for
 * exactly this reason ("this route has no other layout ancestor that already
 * renders it"). This spec is otherwise identical to
 * `cypress/e2e/mocked/legacy/login/migratable.cy.ts` — same modal, same
 * steps, same DOM ids (`#otp-input`, `#nextBtn1`, ...), same backend stubs —
 * the only difference is which login form submits first
 * (`input[autocomplete="username"]`/`button[type="submit"]` here vs
 * `#input-new-username`/`#new-login` there).
 *
 * `getSelfExclusionMessage` (modules/registration/src/features/auth-landing/
 * self-exclusion.ts) returns `undefined` for a migratable account before
 * ever looking at `isSelfExcluded` — `onLogin` checks `isMigratable` first
 * and opens the modal before that self-exclusion check even runs, so a
 * migratable-and-self-excluded account still gets the modal here too (see
 * `cypress/e2e/mocked/new/login/self-excluded.cy.ts` for the self-exclusion
 * condition on its own, non-migratable).
 *
 * `useRegistrationSteps.js`'s own `isMigratable` concept (which would skip
 * every non-start step) never actually engages — nothing in the codebase
 * ever calls the `setMigratableData` it depends on — so every step below
 * still renders and needs completing, exactly like `registration.cy.ts`'s
 * full-flow test. `registration_new_flow` is forced on in the fixture for
 * the same reason it is there: dodging that hook's `getLastIndex()` crash
 * when the flag is off (this suite's actual GrowthBook default).
 *
 * The address step is never given a CEP: `CepAddressStep`'s
 * `handleDefaultData()` (cepAddressStep/index.js) prepopulates
 * `address`/`state`/`city` straight from the migratable-status response's
 * own `state`/`city`/`address` once the real `country/{id}/regions`/`city`
 * lookups it validates those names against resolve.
 */
describe('New login — migratable flow (full registration)', () => {
  const LEGACY_MODAL_FLOW = {
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
    cy.stubGrowthbookFeatures(LEGACY_MODAL_FLOW)
    // Same real capture of POST /registration/user/is-migrateable used by
    // the legacy flow's equivalent — see the file header.
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
    // Deliberately errors out — if `isMigratable` doesn't open the modal and
    // the app falls through to a plain `doLogin()` instead, this makes that
    // visible (a login error on screen) instead of silently succeeding and
    // navigating away, which would look like nothing happened at all.
    cy.stubLogin({ statusCode: 401, body: { messageCode: 174 } })
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('input[autocomplete="username"]')
      .type('52998224725')
      .should('not.have.value', '')
    cy.get('input[autocomplete="current-password"]')
      .type('Sup3rSecret!23')
      .should('have.value', 'Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('button[type="submit"]').click()
    cy.wait('@migratableStatus')
    cy.get('#register-modal').should('be.visible')
    cy.contains('Bem-vindo de volta!').should('be.visible')
    cy.get('#register-modal #nextBtn1').should('be.disabled')
    cy.get('#register-modal #tandc').check({ force: true })
    cy.get('#register-modal #privacyPolicy').check({ force: true })
    cy.get('#register-modal #belongHere').check({ force: true })
    cy.get('#register-modal #nextBtn1').should('not.be.disabled').click()

    // Same `aditionalChecks()` as a plain registration's first step — the
    // e-mail-taken check, then the CPF check.
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
