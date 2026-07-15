'use strict';

const OSC_SEQUENCE = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/g;
const ESCAPE_SEQUENCE = /\u001B[()][0-2A-Z0-9]|\u001B[=>]/g;

function stripAnsiSequences(value) {
  return String(value ?? '')
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESCAPE_SEQUENCE, '');
}

module.exports = {
  stripAnsiSequences,
};
