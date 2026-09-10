describe('Registration 2026 — RG limits screen (KIB-8557)', () => {
  const openRgLimitsScreen = () => {
    cy.visitAsLoggedInUser('/')
    cy.dismissCookieBannerIfVisible()
    cy.wait('@activationSteps', { timeout: 20000 })
    cy.dismissCookieBannerIfVisible()
    cy.contains('button', 'Ativar conta').click()
    cy.contains('Hora de definir seus limites', { timeout: 15000 }).should(
      'be.visible',
    )
  }

  const rgScreen = () => cy.get('.activation-limits-overlay')

  const openManualStage = () => {
    openRgLimitsScreen()
    cy.dismissCookieBannerIfVisible()
    rgScreen().contains('button', 'Definir manualmente').click()
    cy.contains('Definir meus limites').should('be.visible')
  }

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
    cy.get('#activation-limits-loss').type('5')

    chooseOtherOption('activation-limits-playtime')
    cy.get('#activation-limits-playtime').type('20')

    cy.get('.activation-limits-warning')
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
    cy.contains('Definir meus limites').should('be.visible')
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
