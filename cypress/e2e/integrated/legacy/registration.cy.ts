/**
 * Legacy registration (`RegisterContent`,
 * apps/core/src/atomic-components/organisms/registerContent) against the
 * REAL backend — `cypress/e2e/mocked/legacy/registration/registration.cy.ts`'s counterpart
 * for `CY_MODE=integrated`. Only runs when the integrated spec pattern picks
 * it up; `if (Cypress.env('mode') !== 'integrated') return` below is a
 * second, defensive guard in case this file is ever targeted directly with
 * the wrong `CY_MODE`.
 *
 * What's real and what isn't:
 * - The combined CPF/e-mail/password step's CPF check
 *   (`/registration/cpf/check/v3`, real polling via
 *   `getRegistrationCpfCheckStatus` — useCAFPolling.js), the e-mail-taken
 *   check, `send-token`, the phone step's real `send-verification-sms`, the
 *   address step's real CEP → street/state/city autofill, and the final
 *   `registration/v4` + auto-login (`loginUser()`, index.js:313) all hit the
 *   real API — none of them are `cy.intercept()`-stubbed, and this spec
 *   doesn't use a pass-through `cy.intercept(...).as(...)` on any of them to
 *   key a `cy.wait()`: sync is done by waiting on what the UI does in
 *   response instead.
 * - `validate-token` (e-mail OTP) is stubbed for the exact same reason as
 *   the new flow's integrated spec (`cypress/e2e/integrated/new/
 *   registration.cy.ts`) — the real code goes to a real inbox nothing in
 *   CI can read. `cy.markEmailVerified()` right after satisfies the
 *   server-side "e-mail must be verified" requirement for real, the same way
 *   it does there.
 * - `check-verification-sms-code` (phone OTP) is stubbed for the same
 *   reason — the real code goes to a real phone nothing in CI can read.
 *   Unlike e-mail there is no equivalent `mark-verified` call for phone in
 *   commands/api.ts, and none was needed: the new flow's phone step
 *   (phone-step.tsx) has no OTP at all and its `registration/v4` still
 *   succeeds, which is evidence the backend doesn't independently gate
 *   registration on phone verification — but that's inferred from the OTHER
 *   flow's code path, not confirmed against this one directly. If this spec
 *   ever 400s on the final submit specifically, this stub is the first
 *   place to check.
 * - GrowthBook features are REAL here (no `cy.stubGrowthbookFeatures()`),
 *   and so is `GET /country/check` (no `cy.stubCountryCheck()`) — this spec
 *   depends on whatever `fe_igp_registration_new_ui_experience`,
 *   `registration_new_flow`, `player_registration_national_id_check`, and
 *   `igp_registration_verification_phases` actually are in the target
 *   environment rendering the legacy UI with the CPF national-id check and
 *   the e-mail/phone/address step set this spec drives below. If the live
 *   config no longer matches that shape, this spec's failure is the signal,
 *   not a bug in the spec — see `useRegistrationSteps.js` for the crash the
 *   mocked suite's fixture works around, which this spec has no fixture to
 *   fall back on. A real country-check response that isn't `active: true`
 *   sends `SplitBannerLayout` straight to `/blocked` instead — also a real
 *   signal, not a spec bug.
 *
 * A real, well-known CEP (Av. Paulista, São Paulo/SP) is used for the
 * address step, same one the mocked suite uses — the state/city dropdowns it
 * populates come from the same real backend either way, so there's nothing
 * to fake here regardless of mode.
 *
 * `cy.recyclePlayer()` runs before *and* after each test — the test CPF
 * (`Cypress.env('testCpf')`, one per machine) has to be free of any account
 * before a real `registration/v4` will accept it again.
 */
describe('Legacy registration — full flow (integrated backend)', () => {
  before(function () {
    if (Cypress.env('mode') !== 'integrated') {
      this.skip()
    }
  })

  beforeEach(() => {
    cy.recyclePlayer(undefined, { expectClean: true })
  })

  after(() => {
    cy.recyclePlayer()
  })

  it('creates an account end to end against the real backend', () => {
    // The two deliberate intercepts in this spec — see the file header.
    cy.stubValidateToken()
    cy.stubLegacySmsValidate()
    cy.acceptCookieBanner()
    cy.visit('/registro/')
    cy.dismissCookieBannerIfVisible()
    cy.get('#register-form', { timeout: 10000 }).should('exist')

    cy.freshIdentity().then((identity) => {
      cy.get('#national_id').type(identity.cpf)
      cy.get('#email').type(identity.email)
      cy.get('#mobileNumber').type(identity.mobile)
      cy.get('#password').type(identity.password)
      cy.get('#nationality').select('Brasileira')
      cy.get('#tandc').check({ force: true })
      cy.get('#privacyPolicy').check({ force: true })
      cy.get('#belongHere').check({ force: true })
      cy.dismissCookieBannerIfVisible()
      cy.get('#nextBtn1').click()

      // No network alias to wait on (see file header) — the real CPF check
      // (polled until terminal) and e-mail check both gate this "Próximo",
      // and the e-mail step's OTP input only renders once both clear.
      cy.get('#otp-input', { timeout: 30000 }).should('be.visible')
      // Any 4-digit code passes — validate-token is stubbed (file header).
      cy.get('#otp-input').type('1234')
      // Real server-side verification — see the file header for why this is
      // still needed even though validate-token's client-side check above is
      // faked.
      cy.markEmailVerified(identity.email, identity.cpf)

      // PhoneVerificationStep sends its real SMS automatically on mount —
      // wait for its (freshly re-mounted, same #otp-input id) input before
      // typing into it.
      cy.get('#otp-input', { timeout: 30000 }).should('be.visible')
      // Any 4-digit code passes — check-verification-sms-code is stubbed
      // (file header).
      cy.get('#otp-input').type('1234')

      // Av. Paulista, São Paulo/SP — a stable, well-known real CEP; its
      // address/state/city autofill is a real backend call (file header).
      cy.get('#cep', { timeout: 30000 }).should('be.visible')
      cy.get('#cep').type('01310-100')
      cy.get('#addressNumber').type('1000')
      cy.dismissCookieBannerIfVisible()
      cy.get('#nextBtn1').should('have.text', 'Registre-se').click()

      // Final submit + auto-login are deferred behind the real
      // `registration/v4` call (index.js's onSubmit); success redirects away
      // from `/registro` (window.location.href = `/${sportSlug}/`) — this is
      // the only signal we wait on for it.
      cy.url({ timeout: 30000 }).should('not.include', '/registro')
    })
  })
})
