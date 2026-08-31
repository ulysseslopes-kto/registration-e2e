/**
 * Full smoke run of the "Registration 2026" account-create flow (KIB-8932):
 * CPF → password → e-mail verification (method → e-mail → OTP) → final
 * `registration/v4` submit. Every backend call the flow can make along this
 * path is intercepted (see cypress/support/commands.ts) so the test never
 * depends on a real backend or a real e-mail/CPF being valid server-side.
 * Run twice — once at the suite's default viewport (iPhone X — see
 * cypress.config.ts), once at a desktop one — to catch layout/interaction
 * regressions specific to larger screens along the same path.
 *
 * Requires apps/core's dev server running (`pnpm --filter core dev` — see
 * cypress.config.ts for the expected baseUrl).
 */
describe('Account create — full flow (mocked backend)', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.stubEmailCheck()
    cy.stubSendToken()
    cy.stubValidateToken()
    cy.stubRegister()
    // Mixpanel tracking is currently off (fe_igp_event_tracking_enabled isn't
    // in the base fixture), so this is a no-op today — but it's the same real
    // project token used in every environment (see mixpanel-tracking.cy.ts),
    // so this stays here as a guardrail against ever hitting it for real if
    // that default changes.
    cy.intercept('POST', '**/track/**', { statusCode: 200 }).as('mixpanelTrack')
  })

  it('creates an account end to end with every backend call stubbed', () => {
    cy.startRegistration()

    cy.fillCpfStep()
    cy.wait('@cpfCheck')

    cy.fillPasswordStep()

    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')

    cy.fillOtp()
    cy.wait('@validateToken')

    // Final registration/v4 submit, fired from the last step's goNext.
    cy.wait('@register')
    cy.contains('Criando sua conta').should('be.visible')
  })

  it('creates an account end to end on a desktop viewport', () => {
    cy.viewport(1000, 660)
    cy.startRegistration()

    cy.fillCpfStep()
    cy.wait('@cpfCheck')

    cy.fillPasswordStep()

    cy.selectEmailVerificationMethod()
    cy.fillEmailStep()
    cy.wait('@emailCheck')
    cy.wait('@sendToken')

    cy.fillOtp()
    cy.wait('@validateToken')

    cy.wait('@register')
    cy.contains('Criando sua conta').should('be.visible')
  })
})
