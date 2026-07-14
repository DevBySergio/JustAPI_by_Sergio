export const malformedProtocolFixtures: readonly unknown[] = [
  null,
  {},
  { type: '' },
  { type: 'unknownMessage' },
  { type: 'executeRequest', request: null },
  { type: 'saveRequest', request: {}, collectionId: 42 },
];

export const staleResponseFixture = {
  operationId: 'operation-current',
  activeExecutionId: 'execution-current',
  staleExecutionId: 'execution-previous',
  response: { type: 'response', operationId: 'operation-previous', executionId: 'execution-previous' },
};

export const queuedStartupFixture = {
  command: 'justapi.createRequest',
  viewReady: false,
  expectedDeliveryCountAfterReady: 1,
};
