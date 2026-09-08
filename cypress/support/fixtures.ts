/**
 * A real capture of a migratable `POST /registration/user/is-migrateable`
 * response — an existing account's data to carry into the migration modal,
 * shared by the legacy and new login flows' equivalent specs
 * (`cypress/e2e/mocked/legacy/login/migratable.cy.ts` and
 * `cypress/e2e/mocked/new/login/migratable.cy.ts`), including the
 * `state`/`city`/`address` the address step prefills from (see either file's
 * header).
 */
export const MIGRATABLE_USER_DATA = {
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
}

/**
 * Global `GET /country/registration-dropdown` stub response
 * (`cypress/support/e2e.ts`'s `beforeEach`) — feeds `countriesArray`
 * (`TranslationProvider`), which the legacy register flow's
 * `useRegisterData.safeSetCountry('Brazil', ...)` depends on to load the
 * regions/cities the address step's CEP autofill validates against.
 *
 * `id: 31` is Brazil's real id on api.kto-dev.com — not an arbitrary
 * stand-in. `getCountryRegions`/`getCountryCities` (useRegisterData.js) call
 * the REAL `/country/{id}/regions` and `/city?country_id={id}` with
 * whatever id lands here; a made-up id like `1` gets a real `{ data: [] }`
 * back (verified against the real API), silently leaving the address step's
 * state/city dropdowns empty for any spec that doesn't route around them via
 * a real CEP lookup.
 */
export const REGISTRATION_DROPDOWN_RESPONSE = {
  data: [
    {
      id: 31,
      name: 'Brazil',
      code: 'BR',
      phone_prefix: '55',
      default_country_currency: 'BRL',
    },
  ],
}

/**
 * Global `GET /country/register` stub response (`cypress/support/e2e.ts`'s
 * `beforeEach`) — feeds `Countries` (a NAME->id map), only consumed by the
 * withdraw/payment components (method.js, directa.js), neither of which any
 * spec here touches. Content doesn't matter, kept for shape consistency with
 * `REGISTRATION_DROPDOWN_RESPONSE`.
 */
export const REGISTER_COUNTRIES_RESPONSE = {
  data: [{ id: '1', name: 'Brazil' }],
}

/**
 * Global `GET /meta.json**` stub response (`cypress/support/e2e.ts`'s
 * `beforeEach`) — apps/core's gatsby-browser.js polls this on every page
 * load to detect a new deploy and force-reload the page. Stubbed globally
 * so no spec depends on a real build having run (the file 404s otherwise)
 * or on whatever's actually deployed.
 */
export const META_JSON_RESPONSE = {
  version: '0.0.0-e2e',
  versionHash: 0,
  commitHash: 'e2e0000',
}

/**
 * Real-shaped default value for the `igp_registration_verification_phases`
 * GrowthBook flag — every registration/activation step marked visible, as
 * GrowthBook would actually serve it, rather than the trimmed-down
 * per-suite subsets other specs pass inline.
 */
export const DEFAULT_FLOW = {
  registration_phase: [
    { step: 'register_lobby', visible: true },
    { step: 'email_and_pass', visible: true },
    { step: 'email_verification', visible: true },
    { step: 'phone_verification', visible: true },
    { step: 'address', visible: true },
  ],
  activation_phase: [
    { step: 'gov_restricted', visible: true },
    { step: 'rg', visible: true },
    { step: 'kyc', visible: true },
    { step: 'update_account', visible: true },
  ],
}
