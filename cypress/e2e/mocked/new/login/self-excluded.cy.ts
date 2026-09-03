/**
 * New "Registration 2026" login's pre-login self-exclusion check
 * (`AuthLandingRoute.js` → `getSelfExclusionMessage`,
 * modules/registration/src/features/auth-landing/self-exclusion.ts).
 * `onLogin` awaits `getUserMigratableStatus`
 * (`POST /registration/user/is-migrateable`) before calling `doLogin`. Kept
 * in its own file (separate from `cypress/e2e/mocked/new/login/login.cy.ts`,
 * the "Matriz de Testes" LOGIN-01..08 specs) so this condition can be run in
 * isolation — point Cypress at this file directly, or with `--spec`. Mirrors
 * `cypress/e2e/mocked/legacy/login/self-excluded.cy.ts` for the pre-KIB-8932
 * flow.
 *
 * `getSelfExclusionMessage` returns early (`undefined`) when the account is
 * migratable, *before* ever looking at `isSelfExcluded` — those
 * precedence-pinning scenarios live with the migratable ones instead:
 * `cypress/e2e/mocked/new/login/migratable.cy.ts`.
 *
 * The self-exclusion modal (`AccountRestrictionModal`) stays mounted at all
 * times (`createPortal` to `document.body`) and only toggles an
 * `opacity-0`/`opacity-100` class based on `isOpen` — no `display: none` —
 * so asserting `.should('be.visible')` alone would pass even while closed.
 * Assertions here check for the `opacity-100`/`opacity-0` class directly.
 *
 * `dismissCookieBannerIfVisible()` gets called three times per submit
 * (`submitLoginForm()` below) rather than once — AdOpt has been observed
 * re-showing the banner with a delay at each of these points: right after
 * `cy.visit()`, right before the submit click, and again right after the
 * `is-migrateable` response comes back (which re-renders the page). Any one
 * of those moments missing the check is enough to cover the submit button
 * or the account-restriction modal's own title underneath it.
 */
describe('New login — self-exclusion condition', () => {
  const submitLoginForm = (password = 'Sup3rSecret!23') => {
    // `.should('have.value', ...)` waits for the controlled input to
    // actually catch up before moving on — otherwise a slow re-render can
    // leave "Entrar" still disabled by the time it's clicked (same race
    // `fillCpfStep`/`fillPasswordStep` guard against in commands.ts).
    cy.get('input[autocomplete="username"]')
      .type('52998224725')
      .should('not.have.value', '')
    cy.get('input[autocomplete="current-password"]')
      .type(password)
      .should('have.value', password)
    cy.dismissCookieBannerIfVisible()
    cy.get('button[type="submit"]').click()
  }

  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.visit('/login/')
    cy.dismissCookieBannerIfVisible()
  })

  it('a self-excluded account is blocked with the formatted end-date message, no login attempt', () => {
    cy.stubLogin()
    cy.stubMigratableStatus({
      isSelfExcluded: true,
      // UTC → America/Sao_Paulo (UTC-3, no DST in Brazil) = 20:59.
      selfExclusionEndDate: '2026-12-31T23:59:00Z',
    })
    submitLoginForm()
    cy.wait('@migratableStatus')
    cy.dismissCookieBannerIfVisible()

    cy.get('[role="dialog"]')
      .should('have.class', 'opacity-100')
      .and(
        'contain.text',
        'Você não pode entrar ou registrar-se no momento. Por favor, tente novamente após 31/12/2026 20:59',
      )
    cy.contains('Restrição de conta').should('be.visible')
    cy.get('@login.all').should('have.length', 0)
  })

  it('(desktop): a self-excluded account is blocked with the formatted end-date message, no login attempt', () => {
    cy.viewport(1000, 660)
    cy.stubLogin()
    cy.stubMigratableStatus({
      isSelfExcluded: true,
      selfExclusionEndDate: '2026-12-31T23:59:00Z',
    })
    submitLoginForm()
    cy.wait('@migratableStatus')
    cy.dismissCookieBannerIfVisible()

    cy.get('[role="dialog"]')
      .should('have.class', 'opacity-100')
      .and(
        'contain.text',
        'Você não pode entrar ou registrar-se no momento. Por favor, tente novamente após 31/12/2026 20:59',
      )
    cy.contains('Restrição de conta').should('be.visible')
    cy.get('@login.all').should('have.length', 0)

    // `.account-restriction-modal-close-button` (the header's icon-only "X")
    // is `display: none` below 768px (modules/registration/src/styles.css)
    // — only visible here, at a desktop viewport. The mobile test above
    // closes via the "Fechar" button instead.
    cy.get('[aria-label="Fechar modal"]').should('be.visible').click()
    cy.get('[role="dialog"]').should('have.class', 'opacity-0')
  })

  it('closing the account-restriction modal dismisses it', () => {
    cy.stubLogin()
    cy.stubMigratableStatus({
      isSelfExcluded: true,
      selfExclusionEndDate: '2026-12-31T23:59:00Z',
    })
    submitLoginForm()
    cy.wait('@migratableStatus')
    cy.dismissCookieBannerIfVisible()

    cy.get('[role="dialog"]').should('have.class', 'opacity-100')
    // The header's icon-only close button is hidden at this (mobile) default
    // viewport — the bottom "Fechar" button is the one actually visible.
    cy.contains('button', 'Fechar').click()
    cy.get('[role="dialog"]').should('have.class', 'opacity-0')
  })

  it('a not-migratable, not-excluded account logs in normally, modal never shown', () => {
    cy.stubMigratableStatus() // defaults: migrateable false, not excluded
    cy.stubLogin()
    submitLoginForm()
    cy.wait('@migratableStatus')
    cy.wait('@login')

    // A successful login navigates away from /login entirely — there's no
    // modal (or anything else from this page) left to assert against.
    cy.url().should('not.include', '/login')
  })

  it('isSelfExcluded true but no end date logs in normally — both fields are required', () => {
    cy.stubMigratableStatus({ isSelfExcluded: true, selfExclusionEndDate: null })
    cy.stubLogin()
    submitLoginForm()
    cy.wait('@migratableStatus')
    cy.wait('@login')

    // A successful login navigates away from /login entirely — there's no
    // modal (or anything else from this page) left to assert against.
    cy.url().should('not.include', '/login')
  })
})
