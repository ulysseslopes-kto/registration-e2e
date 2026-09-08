import './commands'
import './commands/api'
import {
  REGISTRATION_DROPDOWN_RESPONSE,
  REGISTER_COUNTRIES_RESPONSE,
  META_JSON_RESPONSE,
} from './fixtures'

beforeEach(() => {
  // Set the AdOpt "already-answered" cookie globally so the consent banner
  // never renders, regardless of which spec/command visits a page — see
  // `acceptCookieBanner()` in commands.ts. Must run before `cy.visit()`.
  // Unlike everything else in this hook, this isn't a network stub — AdOpt's
  // own real script reads it — so it applies in both modes.
  cy.acceptCookieBanner()

  // CY_MODE=integrated is meant to hit real backend and third-party services
  // (see cypress.config.ts) — none of the intercepts below apply there, only
  // in `mocked`.
  if (Cypress.env('mode') === 'integrated') return

  cy.intercept('GET', '**/meta.json**', META_JSON_RESPONSE)
  cy.intercept('GET', '**cdn-smr.kto.bet.br/**', { statusCode: 204, body: '' })
  cy.intercept('GET', '**accounts.google.com/gsi/**', { statusCode: 204, body: '' })
  cy.intercept('GET', '**ctn-api.kambi.com/**', { statusCode: 204, body: '' })
  cy.intercept('**cms.kto.bet.br/**', { statusCode: 204, body: '' })
  cy.intercept( 'GET', '**/country/registration-dropdown', REGISTRATION_DROPDOWN_RESPONSE)
  cy.intercept('GET', '**/country/register', REGISTER_COUNTRIES_RESPONSE)
})
