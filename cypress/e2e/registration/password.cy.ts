/**
 * Password step of the account-create flow (test matrix section 04,
 * PW-01..05).
 */
describe('Account create — password step', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.stubCpfCheck()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    // Now on the password step.
  })

  it('PW-01: all 5 rules must hold at once to enable "Próximo"', () => {
    cy.get('input[type="password"]').type('Sup3rSecret23') // missing a special char
    cy.get('.step-primary-button').should('be.disabled')
    cy.get('input[type="password"]').type('!')
    cy.get('.step-primary-button').should('not.be.disabled')
  })

  it('PW-02: the checklist reacts rule by rule, on every keystroke', () => {
    const met = (label: string) =>
      cy.contains('li', label).find('.sr-only').should('have.text', 'Requisito atendido')
    const unmet = (label: string) =>
      cy.contains('li', label).find('.sr-only').should('have.text', 'Requisito não atendido')

    cy.get('input[type="password"]').type('a')
    met('1 Letra minúscula')
    unmet('1 Letra maiúscula')
    unmet('1 Número')
    unmet('1 Caractere especial')
    unmet('Mínimo 8 caracteres')

    cy.get('input[type="password"]').type('A')
    met('1 Letra maiúscula')

    cy.get('input[type="password"]').type('1')
    met('1 Número')

    cy.get('input[type="password"]').type('!')
    met('1 Caractere especial')

    cy.get('input[type="password"]').type('rest23')
    met('Mínimo 8 caracteres')
  })

  it('PW-03: an internal space fails "minimum length" even at 10+ characters', () => {
    cy.get('input[type="password"]').type('Abc1! defg') // 10 chars, 4 other rules met
    cy.contains('li', 'Mínimo 8 caracteres')
      .find('.sr-only')
      .should('have.text', 'Requisito não atendido')
    cy.get('.step-primary-button').should('be.disabled')
  })

  it('PW-04: the field never enters a negative/error state', () => {
    cy.get('input[type="password"]')
      .parent('label')
      .should('have.attr', 'data-state', 'default')
    cy.get('input[type="password"]').type('short')
    cy.get('input[type="password"]')
      .parent('label')
      .should('have.attr', 'data-state', 'default')
      .and('not.have.attr', 'data-state', 'negative')
    cy.get('input[type="password"]').type('1! more valid Aa')
    // Still not necessarily "positive" if the space above breaks length, but
    // never "negative" regardless of how invalid the password is.
    cy.get('input[type="password"]')
      .parent('label')
      .should('not.have.attr', 'data-state', 'negative')
  })

  it('PW-05: the field is auto-focused on entering the step', () => {
    cy.get('input[type="password"]').should('have.focus')
  })
})
