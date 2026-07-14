export const malformedProtocolFixtures: readonly unknown[] = [
  null,
  {},
  { type: '' },
  { type: 'unknownMessage' },
  { type: 'executeRequest', request: null },
  { type: 'saveRequest', request: {}, collectionId: 42 },
];

export const staleResponseFixture = {
  activeExecutionId: 'execution-current',
  staleExecutionId: 'execution-previous',
  response: { type: 'response', executionId: 'execution-previous' },
};

export const queuedStartupFixture = {
  command: 'justapi.createRequest',
  viewReady: false,
  expectedDeliveryCountAfterReady: 1,
};
