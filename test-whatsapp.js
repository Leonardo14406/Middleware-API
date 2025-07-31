#!/usr/bin/env node

/**
 * WhatsApp Integration Test Script
 * Tests the WhatsApp service functionality
 * Run with: node test-whatsapp.js
 */

const API_BASE = 'http://localhost:5001';

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

async function runWhatsAppTests() {
  console.log('📱 WhatsApp Integration Tests');
  console.log('============================');

  // Test 1: Health Check
  console.log('\n🏥 Test 1: Health Check');
  await apiRequest('GET', '/whatsapp/health');

  // Test 2: Send Test Message (will likely fail without proper credentials)
  console.log('\n📤 Test 2: Send Test Message');
  await apiRequest('POST', '/whatsapp/test', {
    phoneNumber: '1234567890',
    message: 'Hello from WhatsApp integration test!'
  });

  // Test 3: Test Bulk Messaging
  console.log('\n📢 Test 3: Bulk Message Test');
  await apiRequest('POST', '/whatsapp/send-bulk', {
    phoneNumbers: ['1234567890', '0987654321'],
    message: 'This is a bulk test message!'
  });

  // Test 4: Test Appointment Reminder
  console.log('\n📅 Test 4: Appointment Reminder Test');
  await apiRequest('POST', '/whatsapp/send-reminder', {
    phoneNumber: '1234567890',
    appointmentDetails: {
      date: '2025-07-30',
      time: '14:30',
      location: 'Test Office',
      notes: 'This is a test appointment'
    }
  });

  // Test 5: Simulate Webhook Message (test message processing)
  console.log('\n📨 Test 5: Webhook Message Processing');
  await apiRequest('POST', '/whatsapp/webhook', {
    messages: [
      {
        chat_id: '1234567890@c.us',
        text: {
          body: 'Hello, I need help with my account'
        },
        from_me: false
      }
    ]
  });

  console.log('\n✅ All WhatsApp tests completed!');
  console.log('\nNote: Some tests may fail if WhatsApp credentials are not properly configured.');
  console.log('Check WHATSAPP_INTEGRATION.md for setup instructions.');
}

// Run tests if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runWhatsAppTests().catch(console.error);
}

export { runWhatsAppTests };
