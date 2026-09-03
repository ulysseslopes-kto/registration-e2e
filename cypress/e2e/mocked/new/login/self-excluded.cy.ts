/**
 * New "Registration 2026" login's pre-login migratable/self-exclusion check
 * (`AuthLandingRoute.js` → `getSelfExclusionMessage`,
 * modules/registration/src/features/auth-landing/self-exclusion.ts).
 * `onLogin` awaits `getUserMigratableStatus`
 * (`POST /registration/user/is-migrateable`) before calling `doLogin`. Kept
 * in its own file (separate from `cypress/e2e/registration/login/login.cy.ts`,
 * the "Matriz de Testes" LOGIN-01..08 specs) so these conditions can be run
 * in isolation: `pnpm cypress:run:registration:self-excluded`, or point
 * Cypress at this file directly. Mirrors
 * `cypress/e2e/legacy/login/self-excluded.cy.ts` for the pre-KIB-8932 flow.
 *
 * Unlike the legacy flow, a migratable account here does **not** open a
 * migration modal — that's an explicit TODO in `AuthLandingRoute.js`
 * ("Not reimplemented here yet") — it just proceeds straight to `doLogin`
 * as if nothing were different. `getSelfExclusionMessage` also returns
 * `undefined` for a migratable account regardless of its self-exclusion
 * status (`if (isMigratable) return undefined`, checked *before* looking at
 * `isSelfExcluded` at all) — the last two tests below pin that down.
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
describe('New login — migratable/self-exclusion conditions', () => {
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

  it('a migratable account logs in normally — no migration modal here yet, self-exclusion never checked', () => {
    cy.stubMigratableStatus({ migrateable: true })
    cy.stubLogin()
    submitLoginForm()
    cy.wait('@migratableStatus')
    cy.wait('@login')

    // A successful login navigates away from /login entirely — there's no
    // modal (or anything else from this page) left to assert against.
    cy.url().should('not.include', '/login')
  })

  it('a migratable AND self-excluded account still logs in normally, not blocked', () => {
    // `getSelfExclusionMessage` returns early on `isMigratable` before ever
    // looking at `isSelfExcluded` — this pins that precedence down
    // explicitly, in case that ordering ever gets reshuffled.
    cy.stubMigratableStatus({
      migrateable: true,
      isSelfExcluded: true,
      selfExclusionEndDate: '2026-12-31T23:59:00Z',
    })
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
