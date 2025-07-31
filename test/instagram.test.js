import { IgApiClient } from 'instagram-private-api';
import { loginInstagram, fetchRecentMessages } from '../src/services/instagramService.js';
import dotenv from 'dotenv';

dotenv.config();

// Test configuration
const TEST_USERNAME = process.env.IG_TEST_USERNAME;
const TEST_PASSWORD = process.env.IG_TEST_PASSWORD;
const TEST_BUSINESS_ID = 'test-business-1';

if (!TEST_USERNAME || !TEST_PASSWORD) {
  console.error('Error: IG_TEST_USERNAME and IG_TEST_PASSWORD must be set in .env file');
  process.exit(1);
}

async function testInstagramLogin() {
  console.log('Testing Instagram login...');
  try {
    const { ig, serialized } = await loginInstagram(TEST_USERNAME, TEST_PASSWORD);
    console.log('✅ Login successful!');
    console.log('Session data length:', serialized.length, 'characters');
    
    // Test getting user info
    const user = await ig.user.info(ig.state.cookieUserId);
    console.log('\n📱 User Info:');
    console.log(`Username: ${user.username}`);
    console.log(`Full Name: ${user.full_name}`);
    console.log(`Profile Pic: ${user.profile_pic_url}`);
    
    return { ig, serialized };
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    if (error.message.includes('checkpoint_required')) {
      console.error('Checkpoint required. Please check your Instagram app or email for a verification code.');
    }
    throw error;
  }
}

async function testFetchMessages(ig) {
  console.log('\nTesting message fetching...');
  try {
    const messages = await fetchRecentMessages(ig, 5);
    console.log(`✅ Successfully fetched ${messages.length} recent messages`);
    
    if (messages.length > 0) {
      console.log('\n📨 Recent Messages:');
      messages.forEach((msg, index) => {
        console.log(`\nMessage ${index + 1}:`);
        console.log(`Thread ID: ${msg.threadId}`);
        console.log(`Content: ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
        console.log(`Date: ${msg.timestamp}`);
        console.log(`Incoming: ${msg.isIncoming ? 'Yes' : 'No'}`);
      });
    } else {
      console.log('No recent messages found.');
    }
    
    return messages;
  } catch (error) {
    console.error('❌ Failed to fetch messages:', error.message);
    throw error;
  }
}

async function runTests() {
  console.log('🚀 Starting Instagram API Tests\n');
  
  try {
    // Test 1: Login and get session
    const { ig, serialized } = await testInstagramLogin();
    
    // Test 2: Fetch recent messages
    await testFetchMessages(ig);
    
    console.log('\n✅ All tests completed successfully!');
    console.log('\n💡 Tip: You can use the following session data in your .env file:');
    console.log(`IG_SESSION='${encodeURIComponent(serialized)}'`);
    
  } catch (error) {
    console.error('\n❌ Tests failed:', error.message);
    process.exit(1);
  }
}

// Run the tests
runTests();
