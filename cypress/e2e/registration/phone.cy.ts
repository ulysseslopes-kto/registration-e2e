/**
 * Phone step of the account-create flow (test matrix section 05,
 * PHONE-01..05). Only appears when the CPF check flags
 * `mobilePrefixAndNumberRequired`; the post-password order is overridden to
 * `[phone]` only so these tests don't also have to go through e-mail
 * verification (already covered in email-verification.cy.ts).
 */
describe('Account create — phone step', () => {
  const PHONE_ONLY_ORDER = {
    fe_igp_registration_post_password_step_order: {
      defaultValue: { post_password_phase: [{ step: 'phone', visible: true }] },
    },
  }

  it('PHONE-01a: appears when the CPF check requires a phone number', () => {
    cy.stubGrowthbookFeatures(PHONE_ONLY_ORDER)
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: true })
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    cy.get('input[inputmode="tel"]').should('be.visible')
  })

  it('PHONE-01b: is skipped when the CPF check does not require a phone number', () => {
    cy.stubGrowthbookFeatures(PHONE_ONLY_ORDER)
    cy.stubCpfCheck({ mobilePrefixAndNumberRequired: false })
    cy.stubRegister()
    cy.startRegistration()
    cy.fillCpfStep()
    cy.wait('@cpfCheck')
    cy.fillPasswordStep()
    // Password was the last remaining step (phone excluded, no other
    // post-password step configured), so it submits straight away.
    cy.contains('Validando seus dados').should('be.visible')
  })

  describe('on the phone step', () => {
    beforeEach(() => {
      cy.stubGrowthbookFeatures(PHONE_ONLY_ORDER)
      cy.stubCpfCheck({ mobilePrefixAndNumberRequired: true })
      cy.startRegistration()
      cy.fillCpfStep()
      cy.wait('@cpfCheck')
      cy.fillPasswordStep()
    })

    it('PHONE-02: the number formats progressively as digits are typed', () => {
      cy.get('input[inputmode="tel"]').type('11987654321')
      cy.get('input[inputmode="tel"]').should('have.value', '(11) 98765-4321')
    })

    it('PHONE-03: exactly 11 digits enables "Próximo" — no DDD validation', () => {
      cy.get('input[inputmode="tel"]').type('00912345678') // DDD "00" doesn't exist
      cy.get('.step-primary-button').should('not.be.disabled')
    })

    it('PHONE-05: as the last step, "Próximo" fires the final registration submit', () => {
      cy.stubRegister()
      cy.get('input[inputmode="tel"]').type('11987654321')
      cy.get('.step-primary-button').click()
      cy.contains('Validando seus dados').should('be.visible')
      cy.wait('@register')
    })
  })

  // PHONE-04 (accessible name without a visible label) needs axe-core or a
  // real screen reader to verify meaningfully — not asserted here.
})
