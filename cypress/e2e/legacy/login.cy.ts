/**
 * Legacy login (`LoginContent` inside apps/core/src/templates/onBoarding/login.js) —
 * the pre-KIB-8932 single-form login, still rendered whenever
 * `fe_igp_registration_new_ui_experience` is off. Not part of the "Registro
 * 2026" test matrix (that's what the specs under cypress/e2e/registration/
 * cover) — this is a separate, isolated suite for the flow it replaced,
 * kept around for as long as that flag can still be off in production.
 *
 * Selectors here (`#input-new-username`, `#input-new-password`, `#new-login`,
 * ...) are unrelated to the new flow's (`input[autocomplete="username"]`,
 * `.step-primary-button`, ...) — the two flows share the same backend
 * endpoints (`/auth/login`) but are otherwise separate components.
 */
describe('Legacy login', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
  }

  it('renders the legacy form (not the new auth-landing) when the flag is off', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.acceptCookieBanner()
    cy.visit('/login/')

    cy.get('#input-new-username').should('be.visible')
    cy.get('#input-new-password').should('be.visible')
    cy.get('#new-login').should('be.visible')
    // Confirms this really is the legacy component, not the new one.
    cy.get('input[autocomplete="username"]').should('not.exist')
  })

  it('valid credentials log in and redirect away from /login', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.stubLogin()
    cy.acceptCookieBanner()
    cy.visit('/login/')

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.get('#new-login').click()
    cy.wait('@login')
    cy.url().should('not.include', '/login')
  })

  it('a login failure shows the generic error message, no redirect', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    // messageCode 174 → "login failed, check your username/password"
    // (treatLogginErrors.js) — any code absent from that switch falls back
    // to the raw `error.message`, which is empty for a hand-rolled stub body
    // and renders a blank, zero-height `#errorMessage`.
    cy.stubLogin({ statusCode: 401, body: { messageCode: 174 } })
    cy.acceptCookieBanner()
    cy.visit('/login/')

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.get('#new-login').click()
    cy.wait('@login')
    cy.get('#errorMessage').should('be.visible')
    cy.url().should('include', '/login')
  })

  it('"Registre-se agora" (#joinNow) navigates to the registration page', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.acceptCookieBanner()
    cy.visit('/login/')

    cy.get('#joinNow').click()
    cy.url().should('include', '/registro')
  })
})
