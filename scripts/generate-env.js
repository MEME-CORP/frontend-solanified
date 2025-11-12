const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load local .env if present (useful for local development)
dotenv.config();

const REQUIRED_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const OPTIONAL_KEYS = ['ORCHESTRATOR_BASE_URL'];

function getEnvValue(key) {
  return process.env[key] ?? '';
}

const envConfig = {};
let missingRequired = false;

for (const key of REQUIRED_KEYS) {
  const value = getEnvValue(key);
  if (!value) {
    console.error(`❌ Missing required environment variable: ${key}`);
    missingRequired = true;
  } else {
    envConfig[key] = value;
  }
}

for (const key of OPTIONAL_KEYS) {
  const value = getEnvValue(key);
  if (value) {
    envConfig[key] = value;
  }
}

const output = `window.__ENV = ${JSON.stringify(envConfig, null, 2)};\n`;
const outputPath = path.resolve(__dirname, '..', 'env.js');

fs.writeFileSync(outputPath, output, { encoding: 'utf8' });
console.log(`✅ Generated env.js with ${Object.keys(envConfig).length} variables.`);

if (missingRequired) {
  console.error('❌ Required environment variables are missing. Aborting build.');
  process.exit(1);
}
