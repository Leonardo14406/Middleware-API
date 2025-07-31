import { chatbotService } from './src/services/chatbotService.js';
import dotenv from 'dotenv';
import { logger } from './src/utils/logger.js';

dotenv.config();

// Test configuration
const TEST_CHATBOT_ID = process.env.TEST_CHATBOT_ID || 'test-chatbot-1';
const TEST_EMAIL = process.env.TEST_EMAIL || 'test@example.com';

async function testGenistudioIntegration() {
  console.log('🚀 Starting Genistudio Integration Test\n');
  
  try {
    // Generate a unique thread ID for this test session
    const threadId = `test_thread_${Date.now()}`;
    
    // Test 1: Send a simple message
    console.log('📨 Sending test message to Genistudio...');
    const testMessage = 'Hello, can you tell me about your services?';
    
    const context = {
      threadId: threadId,
      platform: 'test',
      businessId: 'test-business-1',
      email: TEST_EMAIL,
      timestamp: new Date().toISOString()
    };
    
    console.log('📝 Test message:', testMessage);
    console.log('🔍 Context:', JSON.stringify(context, null, 2));
    
    const startTime = Date.now();
    console.log('\n🔗 Sending request to:', process.env.GENISTUDIO_API_URL || 'https://genistud.io/api/message');
    console.log('🔑 Chatbot ID:', TEST_CHATBOT_ID);
    
    const response = await chatbotService.sendMessage(
      TEST_CHATBOT_ID,
      testMessage,
      context
    );
    
    const timeElapsed = Date.now() - startTime;
    
    console.log('\n✅ Received response from Genistudio:');
    console.log('----------------------------------------');
    console.log(response);
    console.log('----------------------------------------');
    console.log(`\n⏱️  Response time: ${timeElapsed}ms`);
    
    // Test 2: Get message history
    console.log('\n📜 Fetching message history...');
    console.log('📭 Email:', TEST_EMAIL);
    console.log('🔑 Chatbot ID:', TEST_CHATBOT_ID);
    
    const messages = await chatbotService.getMessages(TEST_CHATBOT_ID, TEST_EMAIL, 5);
    
    if (messages && messages.length > 0) {
      console.log('\n📋 Message history (first 5 messages):');
      messages.slice(0, 5).forEach((msg, i) => {
        console.log(`\n--- Message ${i + 1} ---`);
        console.log('ID:', msg.id);
        console.log('Type:', msg.isUserMessage ? 'User' : 'Bot');
        console.log('Date:', new Date(msg.createAt).toLocaleString());
        console.log('Content:', msg.text);
      });
    }
    
    console.log('\n📋 Message history:');
    console.log('----------------------------------------');
    console.log(JSON.stringify(messages, null, 2));
    console.log('----------------------------------------');
    
    console.log('\n🎉 Test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:');
    console.error(error);
    
    if (error.response) {
      console.error('\nError details:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }
    
    process.exit(1);
  }
}

// Run the test
testGenistudioIntegration();
