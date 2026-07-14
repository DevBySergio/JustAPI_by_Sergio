export const fixtureSecret = '${FIXTURE_SECRET_NOT_A_REAL_CREDENTIAL}';

export const legacyAuthorizationFixture = {
  key: 'Authorization',
  value: `Bearer ${fixtureSecret}`,
  enabled: true,
};

export const expectedRedactedFixture = {
  key: 'Authorization',
  value: '<redacted>',
  enabled: true,
};

export const secretStorageFixture = {
  reference: 'justapi.auth.v1.fixture-request.fixture-key',
  value: fixtureSecret,
};
