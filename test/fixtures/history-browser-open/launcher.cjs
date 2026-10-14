'use strict';

const { fork } = require('node:child_process');
const [browserPath, receiptPath, url] = process.argv.slice(2);
const browser = fork(browserPath, [receiptPath, url], {
  detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
browser.once('error', () => { process.exitCode = 1; });
browser.once('message', () => {
  // This fixture models a launch receipt, keeping the application's lifetime
  // independent of the launcher. The Linux tests exercise actual gio as well.
  browser.disconnect();
  browser.unref();
});
