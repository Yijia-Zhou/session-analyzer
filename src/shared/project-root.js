'use strict';

const { sameProjectPath, interpretProjectPath } = require('./project-path');

function sameProjectRoot(left, right) {
  const descriptor = (value) => typeof value === 'string'
    ? interpretProjectPath(value, { legacyNamespace: true }) : value;
  return sameProjectPath(descriptor(left), descriptor(right));
}

module.exports = {
  sameProjectRoot,
};
