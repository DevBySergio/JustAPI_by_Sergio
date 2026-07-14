export const corruptStorageDocument = '{"collections": [invalid-json]';

export const legacyStorageFixture = {
  collections: [],
  requests: [],
};

export const concurrentWriteFixture = {
  first: { revision: 1, value: 'first' },
  second: { revision: 2, value: 'second' },
};

export const collectionRoundTripFixture = {
  collectionName: 'Fixture collection',
  folderName: 'Nested fixture folder',
  requestName: 'Fixture request',
};
