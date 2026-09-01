/**
 * Legacy login's pre-login migratable/self-exclusion check
 * (`getUserMigratableStatus`, apps/core/src/utils/getUserMigratableStatus/index.js) —
 * `onSubmit` (apps/core/src/templates/onBoarding/login.js) awaits
 * `POST /registration/user/is-migrateable` before ever calling `doLogin`.
 * Split into its own file (separate from `cypress/e2e/legacy/login/login.cy.ts`,
 * which covers the plain login behavior) so these conditions can be run in
 * isolation: `pnpm cypress:run:legacy:self-excluded`, or point Cypress at
 * this file directly.
 *
 * `isMigratable` is checked *before* `isSelfExcluded` in `onSubmit` — a
 * migratable account opens the migration modal regardless of its
 * self-exclusion status; `isSelfExcluded` only matters once `isMigratable`
 * is false. The last two tests below pin that precedence down explicitly.
 *
 * The new flow (`AuthLandingRoute.js`) has the same idea, with different
 * behavior — see `cypress/e2e/registration/login/self-excluded.cy.ts`.
 */
describe('Legacy login — migratable/self-exclusion conditions', () => {
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

  it('a migratable account with a weak password shows the password hint, no modal, no login attempt', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.intercept('POST', '**/auth/login').as('login')
    cy.stubMigratableStatus({ migrateable: true })
    cy.acceptCookieBanner()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#input-new-username').type('e2e-test@example.com')
    // Missing an uppercase letter and a special character — fails
    // `passwordRegex`, the same client-side gate the migration modal's own
    // password field would otherwise enforce.
    cy.get('#input-new-password').type('weakpass123')
    cy.dismissCookieBannerIfVisible()
    cy.get('#new-login').click()
    cy.wait('@migratableStatus')
    cy.contains(
      'São necessários 8-20 caracteres incluindo pelo menos uma letra minúscula, uma maiúscula, números e caracteres especiais (#@%)',
    ).should('be.visible')
    cy.get('#register-modal').should('not.exist')
    cy.get('@login.all').should('have.length', 0)
  })

  it('a migratable account with a valid password opens the migration modal instead of logging in', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.intercept('POST', '**/auth/login').as('login')
    cy.stubMigratableStatus({ migrateable: true })
    cy.acceptCookieBanner()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.dismissCookieBannerIfVisible()
    cy.get('#new-login').click()
    cy.wait('@migratableStatus')

    // `RegisterModal` → `RegisterContent` with `flow: REGISTER_MODAL_FLOWS.LOGIN`
    // — `EmailAndPasswordStep` shows a "let's migrate you" message instead of
    // the CPF/e-mail/password fields, gated only by the three consents.
    cy.get('#register-modal').should('be.visible')
    cy.contains('Bem-vindo de volta!').should('be.visible')
    cy.contains(
      'Para continuar usando nossos serviços, você precisará verificar e atualizar seus dados.',
    ).should('be.visible')
    cy.get('#register-modal #nextBtn1').should('be.disabled')
    cy.get('#register-modal #tandc').check({ force: true })
    cy.get('#register-modal #privacyPolicy').check({ force: true })
    cy.get('#register-modal #belongHere').check({ force: true })
    cy.get('#register-modal #nextBtn1').should('not.be.disabled')

    cy.get('@login.all').should('have.length', 0)
  })

  it('a migratable, not-self-excluded account (a realistic full response) opens the migration modal', () => {
    // A real capture of POST /registration/user/is-migrateable — migratable,
    // with an existing account's data to carry into the modal, and
    // `isSelfExcluded`/`selfExclusionEndDate` present but `null` (not
    // `false`) — the shape a genuinely non-excluded account actually comes
    // back as.
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.intercept('POST', '**/auth/login').as('login')
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
    // The self-exclusion message must never appear here — `isMigratable` is
    // checked first in `onSubmit` and returns before `isSelfExcluded` (from
    // this same response) is ever looked at.
    cy.contains('Você não pode entrar ou registrar-se no momento').should(
      'not.exist',
    )
    cy.get('@login.all').should('have.length', 0)
  })

  it('a migratable AND self-excluded account still opens the migration modal, not the self-exclusion message', () => {
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.intercept('POST', '**/auth/login').as('login')
    cy.stubMigratableStatus({
      migrateable: true,
      isSelfExcluded: true,
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

    cy.get('#register-modal').should('be.visible')
    cy.contains('Você não pode entrar ou registrar-se no momento').should(
      'not.exist',
    )
    cy.get('@login.all').should('have.length', 0)
  })
})
