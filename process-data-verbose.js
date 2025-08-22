// Enhanced process-data.js with detailed logging
const NSWPropertyAPI = require('./server.js');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🚀 NSW Property Data Processing Started');
  console.log('======================================');
  console.log();

  // Check data source
  const dataPath = './nsw-data-source';
  if (!fs.existsSync(dataPath)) {
    console.error('❌ nsw-data-source directory not found');
    process.exit(1);
  }

  // List ZIP files
  const files = fs.readdirSync(dataPath).filter(f => f.toLowerCase().endsWith('.zip'));
  console.log(`📦 Found ${files.length} ZIP files:`);
  files.forEach(f => console.log(`   - ${f}`));
  console.log();

  if (files.length === 0) {
    console.error('❌ No ZIP files found in nsw-data-source/');
    console.log('Please add your NSW property data ZIP files');
    process.exit(1);
  }

  const config = {
    githubUser: 'your-username',
    githubRepo: 'nsw-property-data',
    dataSourcePath: dataPath,
    outputPath: './processed-data'
  };

  console.log('⚙️ Configuration:');
  console.log(`   Data source: ${config.dataSourcePath}`);
  console.log(`   Output: ${config.outputPath}`);
  console.log();

  try {
    const api = new NSWPropertyAPI(config);
    await api.processDataForGitHub();
    console.log();
    console.log('✅ Processing completed successfully!');
  } catch (error) {
    console.error();
    console.error('❌ Processing failed:');
    console.error(error.message);
    console.error();
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
