describe('Legacy RG limits screen (pre-KIB-8557 RGLimits)', () => {
  const openLegacyRgScreen = () => {
    cy.visitAsLoggedInUser('/', { user_status: { name: 'PENDING' } })
    cy.dismissCookieBannerIfVisible()
    cy.contains('Escolha como definir seus limites', { timeout: 15000 }).should(
      'be.visible',
    )
    cy.wait('@limitPeriods')
  }

  const openManualStage = () => {
    openLegacyRgScreen()
    cy.get('#manually-set-card').click()
    cy.contains('Defina seus limites').should('be.visible')
  }

  const openDrawer = () => cy.get('aside:visible')

  const chooseOtherOption = (placeholder: string) => {
    cy.contains(placeholder).click()
    openDrawer().contains('li[role="button"]', 'Outro').click()
  }

  const confirmCustomValue = () => {
    openDrawer().find('#confirm-custom-value-button').click()
  }

  beforeEach(() => {
    cy.stubGrowthbookFeatures({
      fe_igp_registration_new_ui_experience: { defaultValue: false },
      fe_registration_loss_limits_enabled: { defaultValue: true },
    })
    cy.stubLimitPeriods()
    cy.stubSetLimit()
    cy.stubActiveSession()
    cy.acceptCookieBanner()
  })

  it('renders the choice stage with both methods', () => {
    openLegacyRgScreen()

    cy.contains(
      'A definição de limites é obrigatória. Escolha como você prefere fazer isso.',
    ).should('be.visible')
    cy.get('#max-limit-set-card')
      .should('be.visible')
      .and('contain.text', 'Usar os limites máximos')
    cy.get('#manually-set-card')
      .should('be.visible')
      .and('contain.text', 'Definir limites manualmente')
  })

  it('"Usar os limites máximos" submits immediately with the exact max-limit payloads (no confirm click, no "source" field)', () => {
    openLegacyRgScreen()

    cy.get('#max-limit-set-card').click()

    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        amount: '10000000',
        period_id: '1',
        duration: '1440',
        type: 'STOP_LOSS',
      })
    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        duration: '1440',
        period_id: '1',
        type: 'GAMING_SESSION',
      })
  })

  it('the manual "Outro" path sends the exact typed-value payloads for both limit types', () => {
    openManualStage()

    chooseOtherOption('Insira um valor')
    cy.get('#lossLimit-custom').type('50000')
    confirmCustomValue()

    chooseOtherOption('Insira o tempo')
    cy.get('#sessionLimit-custom').type('12')
    confirmCustomValue()

    cy.get('#confirm-limits-button').should('not.be.disabled').click()

    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        amount: '50000',
        period_id: '1',
        duration: '1440',
        type: 'STOP_LOSS',
      })
    cy.wait('@setLimit')
      .its('request.body')
      .should('deep.equal', {
        duration: '720',
        period_id: '1',
        type: 'GAMING_SESSION',
      })
  })

  it('a loss value over the max shows the warning and disables the drawer\'s own confirm — the bad value never reaches the form', () => {
    openManualStage()

    chooseOtherOption('Insira um valor')
    cy.get('#lossLimit-custom').type('50000000')

    cy.contains('O valor não deve exceder 1 bilhão de reais.').should(
      'be.visible',
    )
    openDrawer().find('#confirm-custom-value-button').should('be.disabled')

    cy.get('#lossLimit-custom').clear().type('50000')
    cy.contains('O valor não deve exceder 1 bilhão de reais.').should(
      'not.exist',
    )
    openDrawer().find('#confirm-custom-value-button').should('not.be.disabled')
    confirmCustomValue()

    cy.contains('Insira um valor').should('not.exist')
  })

  it('a low (but valid) loss value shows the advisory without blocking the outer Confirm', () => {
    openManualStage()

    chooseOtherOption('Insira um valor')
    cy.get('#lossLimit-custom').type('5')
    confirmCustomValue()

    chooseOtherOption('Insira o tempo')
    cy.get('#sessionLimit-custom').type('12')
    confirmCustomValue()

    cy.contains('Um limite baixo pode impedir você de apostar.').should(
      'be.visible',
    )
    cy.get('#confirm-limits-button').should('not.be.disabled')
  })
})
