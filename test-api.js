#!/usr/bin/env node

/**
 * Test script for the updated Business Platform API
 * Run with: node test-api.js
 */

const API_BASE = 'http://localhost:5001';
const TEST_BUSINESS_ID = 'test-business-' + Date.now();

// Helper function to make API requests
async function apiRequest(method, endpoint, data = null) {
  const url = `${API_BASE}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, options);
    const result = await response.json();
    
    console.log(`\n${method} ${endpoint}`);
    console.log(`Status: ${response.status}`);
    console.log('Response:', JSON.stringify(result, null, 2));
    
    return { status: response.status, data: result };
  } catch (error) {
    console.error(`Error calling ${method} ${endpoint}:`, error.message);
    return { status: 500, error: error.message };
  }
}

async function runTests() {
  console.log('🚀 Testing Business Platform API');
  console.log('=================================');

  // Test 1: Register Business
  console.log('\n📝 Test 1: Register Business');
  await apiRequest('POST', '/business/register', {
    businessId: TEST_BUSINESS_ID,
    igUsername: 'test_business_ig',
    chatbotId: 'test-chatbot-123',
    email: 'test@business.com'
  });

  // Test 2: Check Status (should show no platforms)
  console.log('\n📊 Test 2: Check Initial Status');
  await apiRequest('GET', `/business/status/${TEST_BUSINESS_ID}`);

  // Test 3: Add Platform Credentials
  console.log('\n🔐 Test 3: Add Platform Credentials');
  await apiRequest('POST', `/business/platforms/${TEST_BUSINESS_ID}`, {
    instagramUsername: 'test_instagram',
    instagramPassword: 'test_password', // Note: This will fail in real scenario
    facebookEmail: 'test@facebook.com',
    facebookPassword: 'test_fb_password', // Note: This will fail in real scenario
    whatsappNumber: '+1234567890',
    whatsappApiKey: 'test_whatsapp_key',
    websiteUrl: 'https://test-business.com',
    websiteApiKey: 'test_website_key'
  });

  // Test 4: Check Status Again (should show configured platforms)
  console.log('\n📊 Test 4: Check Status After Adding Platforms');
  await apiRequest('GET', `/business/status/${TEST_BUSINESS_ID}`);

  // Test 5: Remove Some Platforms
  console.log('\n🗑️  Test 5: Remove Some Platforms');
  await apiRequest('DELETE', `/business/platforms/${TEST_BUSINESS_ID}`, {
    platforms: ['WHATSAPP', 'WEBSITE']
  });

  // Test 6: Final Status Check
  console.log('\n📊 Test 6: Final Status Check');
  await apiRequest('GET', `/business/status/${TEST_BUSINESS_ID}`);

  // Test 7: Update Business Info
  console.log('\n✏️  Test 7: Update Business Info');
  await apiRequest('PUT', `/business/business/${TEST_BUSINESS_ID}`, {
    igUsername: 'updated_instagram_username',
    email: 'updated@business.com'
  });

  console.log('\n✅ All tests completed!');
  console.log('\nNote: Instagram and Facebook authentication will fail with test credentials.');
  console.log('WhatsApp and Website should succeed as they use placeholder implementations.');
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };
