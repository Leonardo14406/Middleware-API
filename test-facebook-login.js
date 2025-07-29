#!/usr/bin/env node

/**
 * Facebook Login Test Script
 * 
 * This script helps test Facebook login after completing browser verification.
 * Run this script after you've logged into Facebook in a browser.
 */

import facebookService from './src/services/facebookService.js';

// Test credentials - replace with your actual credentials
const TEST_EMAIL = process.env.FACEBOOK_EMAIL || 'your-email@example.com';
const TEST_PASSWORD = process.env.FACEBOOK_PASSWORD || 'your-password';

console.log('🧪 Facebook Login Test Script');
console.log('===============================\n');

async function testFacebookLogin() {
  try {
    console.log('📋 Pre-flight checklist:');
    console.log('   1. Have you logged into Facebook in a browser? (Required)');
    console.log('   2. Did you complete any security challenges/captcha?');
    console.log('   3. Is your browser session still active?');
    console.log('   4. Are you using the correct email/password?\n');

    console.log('🔍 Testing Facebook connectivity...');
    const isConnected = await facebookService.testFacebookConnectivity();
    
    if (!isConnected) {
      console.log('❌ Facebook connectivity failed');
      console.log('   Solution: Check your internet connection');
      return;
    }
    
    console.log('✅ Facebook is reachable\n');

    console.log('🔐 Attempting Facebook login...');
    console.log(`   Email: ${TEST_EMAIL.replace(/(.{2}).*(@.*)/, '$1***$2')}`);
    console.log('   Please wait...\n');

    const result = await facebookService.loginFacebook(TEST_EMAIL, TEST_PASSWORD);
    
    console.log('🎉 SUCCESS! Facebook login completed');
    console.log(`   User ID: ${result.api.getCurrentUserID()}`);
    console.log(`   Session serialized: ${result.serialized ? 'Yes' : 'No'}`);
    console.log(`   Session length: ${result.serialized?.length || 0} characters\n`);

    console.log('🧪 Testing basic functionality...');
    
    // Test getting thread list
    try {
      const messages = await facebookService.fetchRecentMessages(result.api, 5);
      console.log(`✅ Retrieved ${messages.length} recent messages`);
    } catch (msgErr) {
      console.log(`⚠️ Could not fetch messages: ${msgErr.message}`);
    }

    console.log('\n🎯 Next Steps:');
    console.log('   1. Your Facebook credentials are working!');
    console.log('   2. You can now use the addPlatformCredentials API');
    console.log('   3. The session will be cached for future use');
    console.log('   4. Consider setting up proper error handling in production');

  } catch (error) {
    console.log('\n❌ Facebook login failed');
    console.log(`   Error: ${error.message}\n`);

    if (error.message.includes('retrieving userID')) {
      console.log('🔧 Troubleshooting Steps:');
      console.log('   1. Open https://www.facebook.com in your browser');
      console.log('   2. Login with the same email/password');
      console.log('   3. Complete any security challenges');
      console.log('   4. Make sure you can access Messenger');
      console.log('   5. Keep the browser tab open');
      console.log('   6. Wait 5-10 minutes and try again');
      console.log('   7. Check FACEBOOK_AUTH_TROUBLESHOOTING.md for detailed solutions\n');
    } else if (error.message.includes('wrong password')) {
      console.log('🔧 Credential Issue:');
      console.log('   1. Verify your email and password are correct');
      console.log('   2. Try logging in manually to Facebook');
      console.log('   3. Make sure 2FA is disabled or use app password\n');
    } else if (error.message.includes('Network')) {
      console.log('🔧 Network Issue:');
      console.log('   1. Check your internet connection');
      console.log('   2. Try using a VPN');
      console.log('   3. Check if Facebook is blocked in your region\n');
    } else {
      console.log('🔧 General Solutions:');
      console.log('   1. Wait 30 minutes and try again');
      console.log('   2. Use a different Facebook account');
      console.log('   3. Try from a different network/location');
      console.log('   4. Check FACEBOOK_AUTH_TROUBLESHOOTING.md\n');
    }

    console.log('📖 Documentation:');
    console.log('   • FACEBOOK_AUTH_TROUBLESHOOTING.md - Authentication issues');
    console.log('   • NETWORK_TROUBLESHOOTING.md - Network connectivity issues');
    console.log('   • API_USAGE.md - API usage examples');
  }
}

// Handle environment variables
if (TEST_EMAIL === 'your-email@example.com') {
  console.log('⚠️  Please set your credentials:');
  console.log('   export FACEBOOK_EMAIL="your-email@gmail.com"');
  console.log('   export FACEBOOK_PASSWORD="your-password"');
  console.log('   node test-facebook-login.js\n');
  console.log('   Or edit this file and replace the TEST_EMAIL and TEST_PASSWORD variables.\n');
  process.exit(1);
}

// Run the test
testFacebookLogin().catch(console.error);
