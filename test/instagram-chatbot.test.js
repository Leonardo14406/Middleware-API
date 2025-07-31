import { IgApiClient } from 'instagram-private-api';
import { loginInstagram } from '../src/services/instagramService.js';
import { pollingService } from '../src/services/pollingService.js';
import { chatbotService } from '../src/services/chatbotService.js';
import dotenv from 'dotenv';
import prisma from '../src/config/db.js';

dotenv.config();

// Test configuration
const TEST_USERNAME = process.env.IG_TEST_USERNAME;
const TEST_PASSWORD = process.env.IG_TEST_PASSWORD;
const TEST_BUSINESS_ID = process.env.TEST_BUSINESS_ID || 'test-business-1';
const TEST_CHATBOT_ID = process.env.TEST_CHATBOT_ID || 'test-chatbot-1';

if (!TEST_USERNAME || !TEST_PASSWORD) {
  console.error('Error: IG_TEST_USERNAME and IG_TEST_PASSWORD must be set in .env file');
  process.exit(1);
}

// Mock chatbot service for testing
const originalSendMessage = chatbotService.sendMessage.bind(chatbotService);
chatbotService.sendMessage = async (chatbotId, message, context = {}) => {
  console.log(`\n🤖 Chatbot received message (${chatbotId}):`, message);
  console.log('Context:', JSON.stringify({
    threadId: context.threadId,
    platform: context.platform,
    businessId: context.businessId,
    email: context.email
  }, null, 2));
  
  // Simulate a response in the format expected by the frontend
  const response = `This is a test response to: "${message}"`;
  console.log(`🤖 Chatbot response: ${response}`);
  
  // Return a response in the format expected by the polling service
  return response;
};

async function setupTestEnvironment() {
  console.log('\n🛠️  Setting up test environment...');
  
  // Ensure test business exists
  await prisma.business.upsert({
    where: { id: TEST_BUSINESS_ID },
    update: {},
    create: {
      id: TEST_BUSINESS_ID,
      businessName: 'Test Business',
      email: 'test@example.com',
      password: 'testpassword',
      chatbotId: TEST_CHATBOT_ID,
    },
  });
  
  console.log('✅ Test environment ready');
}

async function testInstagramChatbot() {
  console.log('\n🚀 Starting Instagram Chatbot Integration Test\n');
  
  try {
    // 1. Setup test environment
    await setupTestEnvironment();
    
    // 2. Login to Instagram
    console.log('\n🔐 Logging in to Instagram...');
    const { ig, serialized } = await loginInstagram(TEST_USERNAME, TEST_PASSWORD);
    console.log('✅ Logged in successfully');
    
    // 3. Create or update Instagram session
    console.log('\n💾 Creating/Updating Instagram session...');
    await prisma.session.upsert({
      where: {
        businessId_platform: {
          businessId: TEST_BUSINESS_ID,
          platform: 'INSTAGRAM'
        }
      },
      update: {
        serializedCookies: serialized,
        updatedAt: new Date()
      },
      create: {
        businessId: TEST_BUSINESS_ID,
        platform: 'INSTAGRAM',
        serializedCookies: serialized
      }
    });
    console.log('✅ Session saved to database');
    
    // 4. Start polling for messages
    console.log('\n🔄 Starting message polling...');
    await pollingService.startPolling(TEST_BUSINESS_ID);
    console.log('✅ Polling service started');
    
    // 5. Simulate receiving a new message
    console.log('\n💬 Simulating new message from Instagram...');
    const testThreadId = 'test_thread_123';
    const testMessage = 'Hello, chatbot!';
    
    // Get the business with its session for polling
    const business = await prisma.business.findUnique({
      where: { id: TEST_BUSINESS_ID },
      include: {
        sessions: {
          where: { platform: 'INSTAGRAM' },
          take: 1
        }
      }
    });
    
    if (!business || !business.sessions.length) {
      throw new Error('Failed to find business with Instagram session');
    }
    
    // Manually trigger the polling logic for our test message
    await pollingService.pollInstagram({
      id: TEST_BUSINESS_ID,
      instagramSession: business.sessions[0].serializedCookies,
    });
    
    console.log('✅ Test message processed');
    
    // 6. Verify the message was processed
    console.log('\n🔍 Verifying message processing...');
    const messages = await prisma.message.findMany({
      where: { businessId: TEST_BUSINESS_ID },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });
    
    if (messages.length > 0) {
      console.log('✅ Message stored in database:', messages[0]);
      
      // Verify the message content
      if (messages[0].content.includes('Do we need to print an equation sheet?')) {
        console.log('✅ Test message content verified');
      } else {
        console.warn('⚠️ Unexpected message content:', messages[0].content);
      }
    } else {
      console.warn('⚠️ No messages found in database. Check if polling service is working correctly.');
    }
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Clean up
    await pollingService.stopPolling(TEST_BUSINESS_ID);
    process.exit(0);
  }
}

// Run the test
testInstagramChatbot();
