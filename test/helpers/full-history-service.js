'use strict';

const { createHistoryService: createService } = require('../../src/history-service');

// These older source/identity tests exercise the explicit full contract. The
// default compact shape and its lifecycle have dedicated presentation tests.
function withFullPresentation(service) {
  return { ...service, execute(operation, input, ...rest) {
    if (operation === 'open' || (input !== undefined
        && (!input || typeof input !== 'object' || Array.isArray(input)))) {
      return service.execute(operation, input, ...rest);
    }
    return service.execute(operation, { presentation: 'full', ...input }, ...rest);
  } };
}

async function createHistoryService(options) {
  return withFullPresentation(await createService(options));
}

module.exports = { createHistoryService, withFullPresentation };
