/**
 * Legacy login's pre-login self-exclusion check
 * (`getUserMigratableStatus`, apps/core/src/utils/getUserMigratableStatus/index.js) —
 * `onSubmit` (apps/core/src/templates/onBoarding/login.js) awaits
 * `POST /registration/user/is-migrateable` before ever calling `doLogin`.
 * Split into its own file (separate from `cypress/e2e/mocked/legacy/login/login.cy.ts`,
 * which covers the plain login behavior) so this condition can be run in
 * isolation — point Cypress at this file directly, or with `--spec`.
 *
 * `isMigratable` is checked *before* `isSelfExcluded` in `onSubmit` — a
 * migratable account opens the migration modal regardless of its
 * self-exclusion status, so those precedence-pinning scenarios live with the
 * migratable ones instead: `cypress/e2e/mocked/legacy/login/migratable.cy.ts`.
 *
 * The new flow (`AuthLandingRoute.js`) has the same idea, with different
 * behavior — see `cypress/e2e/mocked/new/login/self-excluded.cy.ts`.
 */
describe('Legacy login — self-exclusion condition', () => {
  const LEGACY_FLOW = {
    fe_igp_registration_new_ui_experience: { defaultValue: false },
  }

  it('a self-excluded account is blocked with the formatted end-date message, no login attempt', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.intercept('POST', '**/auth/login').as('login')
    cy.stubMigratableStatus({
      isSelfExcluded: true,
      // UTC → America/Sao_Paulo (UTC-3, no DST in Brazil) = 20:59.
      selfExclusionEndDate: '2026-12-31T23:59:00Z',
    })
    cy.acceptCookieBanner()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('#new-login').click()
    cy.wait('@migratableStatus')
    cy.contains(
      'Você não pode entrar ou registrar-se no momento. Por favor, tente novamente após 31/12/2026 20:59',
    ).should('be.visible')
    cy.get('@login.all').should('have.length', 0)
  })
})
