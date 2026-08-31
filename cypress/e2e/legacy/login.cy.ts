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
 *
 * Every test below stubs `/registration/user/is-migrateable`
 * (`cy.stubMigratableStatus`) — `onSubmit` awaits it before ever calling
 * `doLogin`, so an unstubbed real backend response (not migratable, not
 * excluded, for these throwaway e2e credentials) is what makes the plain
 * login tests above work without even knowing this endpoint exists. The new
 * flow (`AuthLandingRoute.js`) has the same idea in progress on a separate,
 * uncommitted branch, but currently ships with a literal
 * `const isSelfExcluded = true` left in — worth flagging to whoever owns
 * that work, not something this repo can test until it's fixed and deployed.
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

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
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

    cy.get('#input-new-username').type('e2e-test@example.com')
    // Missing an uppercase letter and a special character — fails
    // `passwordRegex`, the same client-side gate the migration modal's own
    // password field would otherwise enforce.
    cy.get('#input-new-password').type('weakpass123')
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

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
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

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
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
    // isMigratable is checked before isSelfExcluded in onSubmit (login.js) —
    // this pins that precedence down explicitly, in case that ordering ever
    // gets reshuffled.
    cy.stubGrowthbookFeatures(LEGACY_FLOW)
    cy.intercept('POST', '**/auth/login').as('login')
    cy.stubMigratableStatus({
      migrateable: true,
      isSelfExcluded: true,
      selfExclusionEndDate: '2026-12-31T23:59:00Z',
    })
    cy.acceptCookieBanner()
    cy.visit('/login/')

    cy.get('#input-new-username').type('e2e-test@example.com')
    cy.get('#input-new-password').type('Sup3rSecret!23')
    cy.get('#new-login').click()
    cy.wait('@migratableStatus')

    cy.get('#register-modal').should('be.visible')
    cy.contains('Você não pode entrar ou registrar-se no momento').should(
      'not.exist',
    )
    cy.get('@login.all').should('have.length', 0)
  })
})
