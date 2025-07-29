#!/usr/bin/env node

/**
 * Environment validation script
 * Checks if the server is running and ready to accept requests
 */

const API_BASE = 'http://localhost:5001';

async function checkServerHealth() {
  try {
    console.log('🔍 Checking server health...');
    
    // Try to make a simple request to check if server is running
    const response = await fetch(`${API_BASE}/business/status/health-check`);
    
    if (response.status === 404) {
      console.log('✅ Server is running (expected 404 for health-check)');
      return true;
    }
    
    console.log(`Server responded with status: ${response.status}`);
    return true;
  } catch (error) {
    console.log('❌ Server is not running or not accessible');
    console.log('Error:', error.message);
    console.log('\nTo start the server, run:');
    console.log('npm run dev');
    console.log('or');
    console.log('npm start');
    return false;
  }
}

async function validateEnvironment() {
  console.log('🚀 Business Platform API - Environment Check');
  console.log('============================================');
  
  const serverRunning = await checkServerHealth();
  
  if (serverRunning) {
    console.log('\n✅ Environment is ready for testing!');
    console.log('\nYou can now run:');
    console.log('node test-api.js');
    console.log('\nOr test endpoints manually using the examples in API_USAGE.md');
  } else {
    console.log('\n❌ Please start the server first');
  }
}

// Run validation if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validateEnvironment().catch(console.error);
}

export { validateEnvironment };
