/**
 * CPF step of the account-create flow (test matrix section 02, CPF-01..08).
 * Requires apps/core's dev server running — see cypress.config.ts.
 */
describe('Account create — CPF step', () => {
  beforeEach(() => {
    cy.stubGrowthbookFeatures()
    cy.startRegistration()
  })

  it('CPF-01: happy path — valid CPF + consents advances to the password step', () => {
    cy.stubCpfCheck()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.get('input[type="password"]').should('be.visible')
  })

  it('CPF-02: invalid check-digit message appears exactly at the 14-char mask, not before', () => {
    // 111.444.777-36 — 11 digits, wrong check digit (valid one is ...-35).
    cy.get('input[inputmode="numeric"]').type('1114447773')
    cy.contains('CPF inválido').should('not.exist')
    cy.get('input[inputmode="numeric"]').type('6')
    cy.contains('CPF inválido. Verifique os números digitados.').should(
      'be.visible',
    )
  })

  it('CPF-03a: a REJECTED check shows the rejected-specific message', () => {
    cy.stubCpfCheck({ status: 'REJECTED' })
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.contains(
      'Não foi possível validar este CPF. Verifique os dados e tente novamente.',
    ).should('be.visible')
  })

  it('CPF-03b: a failed check-request shows the generic retry message', () => {
    cy.stubCpfCheck({ statusCode: 500 })
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.contains(
      'Não conseguimos validar seu CPF agora. Tente novamente.',
    ).should('be.visible')
  })

  it('CPF-04: marketing consent is optional — the other three are not', () => {
    cy.stubCpfCheck()
    cy.get('input[inputmode="numeric"]').type('52998224725')
    cy.get('.cpf-terms-toggle').click() // "Ver mais"

    // CONSENTS order: acceptTerms, acceptPrivacy, acceptMarketing, acceptNotRestricted.
    cy.get('[data-testid="cpf-terms-list"] input[type="checkbox"]').then(
      ($checkboxes) => {
        cy.wrap($checkboxes.eq(0)).check({ force: true }) // terms
        cy.wrap($checkboxes.eq(1)).check({ force: true }) // privacy
        cy.wrap($checkboxes.eq(3)).check({ force: true }) // not restricted
        // index 2 (marketing) left unchecked on purpose.
      },
    )
    cy.get('.step-primary-button').should('not.be.disabled')
  })

  it('CPF-05: "Ver mais"/"Ver menos" toggles the expanded state', () => {
    cy.get('.cpf-terms-toggle').click()
    cy.get('.cpf-terms-list-wrapper').should('have.attr', 'data-expanded', 'true')
    cy.get('.cpf-terms-toggle').click()
    cy.get('.cpf-terms-list-wrapper').should(
      'have.attr',
      'data-expanded',
      'false',
    )
  })

  it('CPF-06: consent links open in a new tab without window.opener', () => {
    cy.get('.cpf-terms-toggle').click()
    cy.get('a[target="_blank"]').should('have.length.greaterThan', 0)
    cy.get('a[target="_blank"]').each(($a) => {
      expect($a.attr('rel')).to.include('noopener')
      expect($a.attr('rel')).to.include('noreferrer')
    })
  })

  it('CPF-07: Enter on "aceitar tudo" checks every consent and advances in one step', () => {
    cy.stubCpfCheck()
    cy.get('input[inputmode="numeric"]').type('52998224725')
    cy.get('input[type="checkbox"]').first().focus().type('{enter}')
    cy.wait('@cpfCheck')
    cy.get('input[type="password"]').should('be.visible')
  })

  it('CPF-08: advancing before the async check resolves does not double-submit, and proceeds once it resolves', () => {
    cy.intercept('POST', '**/registration/cpf-checks/v4', {
      delay: 1500,
      body: { data: { status: 'APPROVED', cpfCheckId: null } },
    }).as('slowCpfCheck')
    cy.fillCpfStep()
    // Note: unlike the final registration/v4 submit (which shows a full
    // "Validando seus dados" screen), the CPF step itself has no such
    // full-screen loading state — the button just disables while the check
    // is in flight, which is what actually prevents a duplicate call.
    cy.get('.step-primary-button').should('be.disabled')
    cy.wait('@slowCpfCheck')
    cy.get('input[type="password"]').should('be.visible')
  })
})
