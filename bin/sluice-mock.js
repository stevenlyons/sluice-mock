#!/usr/bin/env node
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const { version } = require('../package.json');
  console.log(version);
  process.exit(0);
}
const app = require('../app.js');
const port = app.resolvePort();
app.listen(port, () => console.log(`Listening on port ${port}`));
