'use strict';

const fs = require('node:fs');
const [receiptPath, url] = process.argv.slice(2);
fs.writeFileSync(`${receiptPath}.tmp`, JSON.stringify({ url, pid: process.pid }));
fs.renameSync(`${receiptPath}.tmp`, receiptPath);

// Simulate a browser that continues running after accepting the URL. Bound
// its lifetime in case a failing test cannot collect the receipt for cleanup.
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 30000).unref();
if (process.send) process.send({ received: true });
