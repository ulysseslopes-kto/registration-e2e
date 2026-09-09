/**
 * KIB-8557 — the redesigned RG (responsible-gaming) limits screen for the
 * "Registration 2026" post-registration activation flow (PR #2193,
 * techmobilt/mono-fe, branch `KIB-8557`). Rebuilds the `rg` activation step
 * behind `fe_registration_loss_limits_enabled`
 * (`ActivationLimitsScreen`/`useActivationLimits`,
 * `modules/registration/src/features/activation-flow/activation-limits/`) —
 * when that flag is off, `useActivationLimits`'s effect calls `onComplete()`
 * immediately and the step is skipped, same as the legacy `RGLimits` screen
 * it replaces. Same `GET /limit`, `GET /limit/period`, `POST /limit`,
 * `PUT /limit/{id}` calls as the legacy screen — no backend contract change
 * (see `use-rg-limits.hook.ts`).
 *
 * Reaching this screen for real (not just rendering the component in
 * isolation, which the PR's own 67 new unit tests already do thoroughly)
 * doesn't require driving the full CPF → password → e-mail-OTP →
 * `registration/v4` pipe first: the same `ActivationStepModal`/
 * `ActivationLimitsScreen` pair also opens from the home lobby's
 * `ActivationCard` (`apps/core/.../registration2026/ActivationCard.js`,
 * gated by `organisms/layout/index.js`'s `SHOW_ACTIVATION_CARD`) for any
 * already-logged-in user with a pending step — which this suite fakes
 * directly via `cy.visitAsLoggedInUser()` (seeds the same
 * `localStorage`/cookie a real login leaves behind; `authProvider.js` never
 * makes a network call to decide `isLoggedIn`, see that command's doc in
 * `commands.ts`) rather than a real login or registration. `Ativar conta`
 * (the card's CTA) opens `ActivationStepModal` exactly like
 * `ActivationInviteScreen`'s own "Ativar minha conta" would post-registration
 * — same modal, same `NATIVE_STEP_SCREENS[MODAL_IDS.RG]`.
 *
 * Selectors: the two value fields are `#activation-limits-loss` /
 * `#activation-limits-playtime` (`LOSS_FIELD_ID`/`PLAYTIME_FIELD_ID`,
 * `activation-limits.tsx`) — real `<input>` ids, not synthetic test-ids.
 * Clicking one opens its option list (`<ul id="{fieldId}-options">`,
 * `limit-value-field.tsx`); picking "Outro" clears the field and turns it
 * into a free numeric input (`selectOption`/`startTyping`,
 * `limit-value-field.hook.tsx`) — used here instead of a numbered preset
 * option, since preset labels are locale-formatted currency/hour strings
 * this suite would otherwise have to reimplement just to assert against.
 * The choice stage's two buttons ("Usar limites máximos"/"Definir
 * manualmente") both carry `.step-primary-button` — `LimitsChoiceFooter`
 * folds it into the secondary button's own variant class too — so this
 * suite always targets a button by its visible text within `rgScreen()`,
 * never by that class alone. The back arrow is `.auth-shell-back-button`
 * (`auth-shell.tsx`, already the selector `translations.cy.ts` uses
 * elsewhere in this repo).
 *
 * All copy below is asserted via its `*_FALLBACK` constant
 * (`activation-limits.consts.ts`/`activation-invite.consts.ts`), not a CMS
 * value — the PR's own description lists every `activationv4.rg.*` key as
 * "New — please create", so until someone adds them in the CMS,
 * `translateWithFallback` renders the fallback in every environment this
 * suite can run against.
 *
 * Not covered: the double-submit guard (PR: "double-click it — only one
 * pair of `/limit` calls should appear") — genuinely racing two clicks
 * before a React re-render disables the button isn't something Cypress's
 * serialized `.click()` commands can reproduce reliably; it's exactly what
 * the unit test suite's synchronous `fireEvent` calls are for. Also not
 * covered: playtime's own over-max warning — unlike the loss field (typing
 * capped at `MAXIMUM_TYPED_LOSS_VALUE`, 1 billion, ten times its real
 * business max), the playtime field's typing cap *is* its business max
 * (`maxTypedValue: limits.maxPlaytimeLimit`, `activation-limits.hook.tsx`),
 * so an over-max value can't actually be typed into it through the real UI.
 */
describe('Registration 2026 — RG limits screen (KIB-8557)', () => {
  /**
   * Reaches the RG screen through the home lobby's `ActivationCard` and
   * waits for its title to render. Assumes `stubActivationSteps` and
   * `stubSetLimit` (or a test's own variant of either) are already set up —
   * `stubLimitPeriods` is called by `beforeEach` since no test needs to vary
   * it.
   *
   * `dismissCookieBannerIfVisible()` is called twice on the way in — once
   * right after the visit, once right before the click — because AdOpt can
   * render its banner with a delay even with the consent cookie already set
   * (see that command's own doc in `commands.ts`); the "Ativar conta" CTA
   * sits low enough on the lobby card to be exactly the kind of target a
   * delayed banner covers.
   */
  const openRgLimitsScreen = () => {
    cy.visitAsLoggedInUser('/')
    cy.dismissCookieBannerIfVisible()
    // `ActivationCard` is lazy-loaded (`SuspensfulComponent`) into the home
    // page, a much heavier page than the registration routes other specs
    // visit — give its chunk and effects room to land before giving up.
    cy.wait('@activationSteps', { timeout: 20000 })
    cy.dismissCookieBannerIfVisible()
    cy.contains('button', 'Ativar conta').click()
    cy.contains('Hora de definir seus limites', { timeout: 15000 }).should(
      'be.visible',
    )
  }

  /**
   * `.activation-limits-overlay` is `NativeScreen`'s own className
   * (`ActivationStepModal.js`), landing on `AuthShell`'s root — scopes
   * interactions to the RG screen itself rather than the rest of the lobby
   * page behind/around it.
   */
  const rgScreen = () => cy.get('.activation-limits-overlay')

  const openManualStage = () => {
    openRgLimitsScreen()
    cy.dismissCookieBannerIfVisible()
    rgScreen().contains('button', 'Definir manualmente').click()
    cy.contains('Definir meus limites').should('be.visible')
  }

  /** Opens a field's option list and picks "Outro", leaving it empty and ready to type into. */
  const chooseOtherOption = (fieldId: string) => {
    cy.get(`#${fieldId}`).click()
    cy.get(`#${fieldId}-options`).contains('button', 'Outro').click()
  }

  beforeEach(() => {
    cy.stubGrowthbookFeatures({
      fe_registration_loss_limits_enabled: { defaultValue: true },
    })
    cy.stubActivationSteps()
    cy.stubLimitPeriods()
    cy.stubSetLimit()
    cy.stubActiveSession()
    cy.acceptCookieBanner()
  })

  it('renders the choice stage with the max/manual/dismiss options', () => {
    openRgLimitsScreen()

    cy.contains(
      'A definição de limites é obrigatória. Escolha como você prefere fazer isso.',
    ).should('be.visible')
    rgScreen().contains('button', 'Usar limites máximos').should('be.visible')
    rgScreen().contains('button', 'Definir manualmente').should('be.visible')
    rgScreen().contains('Agora não').should('be.visible')
  })

  it('"Usar limites máximos" sends the exact max-limit payloads for both limit types', () => {
    openRgLimitsScreen()

    cy.dismissCookieBannerIfVisible()
    rgScreen().contains('button', 'Usar limites máximos').click()

    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.include', {
        type: 'STOP_LOSS',
        amount: '10000000',
        period_id: '1',
        duration: '1440',
        source: 'ACTIVATION',
      })
    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.include', {
        type: 'GAMING_SESSION',
        duration: '1440',
        period_id: '1',
        source: 'ACTIVATION',
      })
  })

  it('the manual "Outro" path sends the exact typed-value payloads for both limit types', () => {
    openManualStage()

    chooseOtherOption('activation-limits-loss')
    cy.get('#activation-limits-loss').type('50000')

    chooseOtherOption('activation-limits-playtime')
    cy.get('#activation-limits-playtime').type('60')

    cy.dismissCookieBannerIfVisible()
    rgScreen()
      .contains('button', 'Confirmar meus limites')
      .should('not.be.disabled')
      .click()

    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.include', {
        type: 'STOP_LOSS',
        amount: '50000',
        period_id: '1',
        duration: '1440',
        source: 'ACTIVATION',
      })
    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.include', {
        type: 'GAMING_SESSION',
        duration: '60',
        period_id: '1',
        source: 'ACTIVATION',
      })
  })

  it('a loss value over the max is blocked with a warning, and fixing it re-enables Confirm', () => {
    openManualStage()

    chooseOtherOption('activation-limits-playtime')
    cy.get('#activation-limits-playtime').type('60')

    chooseOtherOption('activation-limits-loss')
    // Above the real business max (10,000,000) but still under the typing
    // cap (1,000,000,000), so it's actually reachable by typing — see the
    // file header on why the playtime field's own over-max can't be.
    cy.get('#activation-limits-loss').type('50000000')

    cy.contains('O valor não deve exceder 1 bilhão de reais.').should(
      'be.visible',
    )
    rgScreen().contains('button', 'Confirmar meus limites').should('be.disabled')

    cy.get('#activation-limits-loss').clear().type('50000')
    cy.contains('O valor não deve exceder 1 bilhão de reais.').should(
      'not.exist',
    )
    rgScreen()
      .contains('button', 'Confirmar meus limites')
      .should('not.be.disabled')
  })

  it('a low (but valid) value on either field shows the advisory without blocking Confirm', () => {
    openManualStage()

    chooseOtherOption('activation-limits-loss')
    cy.get('#activation-limits-loss').type('5') // <= low_loss_warning.Day (10)

    chooseOtherOption('activation-limits-playtime')
    cy.get('#activation-limits-playtime').type('20') // <= low_session_time_warning.Day (30)

    cy.get('.activation-limits-warning') // LimitWarning — one per field
      .should('have.length', 2)
      .each(($warning) => {
        cy.wrap($warning).should(
          'contain.text',
          'Um limite baixo pode impedir você de apostar.',
        )
      })
    rgScreen()
      .contains('button', 'Confirmar meus limites')
      .should('not.be.disabled')
  })

  it('one limit call failing keeps the user on the screen with an error, and Confirm stays usable', () => {
    // Override the default stub: the session write fails, the loss write
    // still succeeds — both fire regardless (submitValues awaits them
    // sequentially, unconditionally). REALITY_CHECK still routes to its own
    // alias, same as stubSetLimit — see that command's doc for why.
    cy.intercept('POST', '**/limit', (req) => {
      if (req.body?.type === 'REALITY_CHECK') {
        req.alias = 'realityCheckLimit'
        req.reply({ statusCode: 200, body: {} })
        return
      }
      req.alias = 'setLimit'
      const failed = req.body?.type === 'GAMING_SESSION'
      req.reply({ statusCode: failed ? 500 : 200, body: {} })
    })
    openManualStage()

    chooseOtherOption('activation-limits-loss')
    cy.get('#activation-limits-loss').type('50000')
    chooseOtherOption('activation-limits-playtime')
    cy.get('#activation-limits-playtime').type('60')

    cy.dismissCookieBannerIfVisible()
    rgScreen().contains('button', 'Confirmar meus limites').click()
    cy.wait('@setLimit')
    cy.wait('@setLimit')

    cy.contains('Não foi possível salvar seus limites. Tente novamente.', {
      timeout: 10000,
    }).should('be.visible')
    cy.contains('Definir meus limites').should('be.visible') // still on the manual stage
    rgScreen()
      .contains('button', 'Confirmar meus limites')
      .should('not.be.disabled')
  })

  it('the back arrow on the manual stage returns to the choice stage', () => {
    openManualStage()

    rgScreen().find('.auth-shell-back-button').click()

    cy.contains('Hora de definir seus limites').should('be.visible')
    cy.contains('Definir meus limites').should('not.exist')
  })

  it('"Agora não" dismisses the screen', () => {
    openRgLimitsScreen()

    cy.dismissCookieBannerIfVisible()
    rgScreen().contains('Agora não').click()

    cy.contains('Hora de definir seus limites').should('not.exist')
  })

  it('fe_registration_loss_limits_enabled off skips the step entirely (legacy gate kept)', () => {
    cy.stubGrowthbookFeatures({
      fe_registration_loss_limits_enabled: { defaultValue: false },
    })
    // First read lights up the lobby CTA; by the time the flag-off skip's
    // own re-read fires, there is nothing left pending.
    let call = 0
    cy.intercept('GET', '**/activation/steps', (req) => {
      const isFirstRead = call === 0
      call += 1
      req.reply({
        body: {
          data: {
            active: false,
            nextStep: isFirstRead ? 'rg' : null,
            steps: isFirstRead ? [{ step: 'rg', completed: false }] : [],
          },
        },
      })
    }).as('activationSteps')

    cy.visitAsLoggedInUser('/')
    cy.dismissCookieBannerIfVisible()
    cy.wait('@activationSteps', { timeout: 20000 })
    cy.dismissCookieBannerIfVisible()
    cy.contains('button', 'Ativar conta').click()

    cy.contains('Conta ativada!', { timeout: 15000 }).should('be.visible')
    cy.contains('Hora de definir seus limites').should('not.exist')
  })
})
