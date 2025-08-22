// debug-dat.js
const NSWPropertyAPI = require('./server.js');

async function debugDAT() {
  console.log('🔍 NSW Property DAT File Debugger');
  console.log('==================================');
  
  const api = new NSWPropertyAPI({
    dataSourcePath: './nsw-data-source',
    outputPath: './processed-data'
  });
  
  // Test with 2010.zip (which found DAT files)
  await api.debugSingleZip('2010.zip');
  
  console.log('\n🔍 Testing newer format...');
  await api.debugSingleZip('2020.zip');
}

debugDAT().catch(console.error);