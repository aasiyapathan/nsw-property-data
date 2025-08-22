const NSWPropertyAPI = require('./server.js');

async function main() {
  console.log('🚀 Starting NSW Property Data Processing...');
  
  const config = {
    githubUser: 'your-username',
    githubRepo: 'nsw-property-data',
    dataSourcePath: './nsw-data-source',
    outputPath: './processed-data'
  };
  
  try {
    const api = new NSWPropertyAPI(config);
    await api.processDataForGitHub();
    console.log('✅ Processing completed successfully!');
  } catch (error) {
    console.error('❌ Processing failed:', error.message);
    process.exit(1);
  }
}

main();