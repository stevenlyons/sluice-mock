#!/usr/bin/env node
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const { version } = require('../package.json');
  console.log(version);
  process.exit(0);
}
require('../app.js');
