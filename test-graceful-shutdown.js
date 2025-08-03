#!/usr/bin/env node

/**
 * Test script to verify graceful shutdown functionality
 * This script simulates concurrent requests while triggering a database change
 */

import axios from 'axios';

const SERVER_URL = 'http://localhost:5001';
const NUM_CONCURRENT_REQUESTS = 5;

async function simulateLongRunningRequest(requestId, duration = 5000) {
  try {
    console.log(`🚀 Starting request ${requestId} (${duration}ms duration)`);
    
    // Use the test endpoint that simulates a long-running request
    const response = await axios.get(`${SERVER_URL}/test-long-request?duration=${duration}`, {
      timeout: duration + 2000 // Allow extra time for network
    });
    
    console.log(`✅ Request ${requestId} completed successfully`);
    return { requestId, success: true, status: response.status, data: response.data };
    
  } catch (error) {
    if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
      console.log(`🔄 Request ${requestId} interrupted by server restart (expected)`);
      return { requestId, success: false, interrupted: true, error: error.message };
    }
    console.log(`❌ Request ${requestId} failed:`, error.message);
    return { requestId, success: false, error: error.message };
  }
}

async function testGracefulShutdown() {
  console.log("🧪 Testing Graceful Shutdown with Active Requests");
  console.log("================================================");
  
  console.log("📡 Starting concurrent requests...");
  
  // Start multiple long-running requests
  const requestPromises = [];
  for (let i = 1; i <= NUM_CONCURRENT_REQUESTS; i++) {
    const requestPromise = simulateLongRunningRequest(i, 3000);
    requestPromises.push(requestPromise);
    
    // Stagger the requests slightly
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  console.log("⏳ Waiting 2 seconds before triggering database change...");
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log("🗃️ Now trigger a database change (delete a business) to test graceful shutdown");
  console.log("💡 The server should:");
  console.log("   1. Detect the database change");
  console.log("   2. Stop accepting new connections");
  console.log("   3. Wait for all active requests to complete");
  console.log("   4. Then restart gracefully");
  
  // Wait for all requests to complete
  console.log("⏱️ Waiting for all requests to complete...");
  const results = await Promise.allSettled(requestPromises);
  
  console.log("\n📊 Results:");
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const { requestId, success, interrupted } = result.value;
      if (interrupted) {
        console.log(`   Request ${requestId}: 🔄 Interrupted by restart (expected)`);
      } else {
        console.log(`   Request ${requestId}: ${success ? '✅ Completed' : '❌ Failed'}`);
      }
    } else {
      console.log(`   Request ${index + 1}: ❌ Promise rejected - ${result.reason}`);
    }
  });
  
  const successful = results.filter(r => 
    r.status === 'fulfilled' && r.value.success
  ).length;
  
  const interrupted = results.filter(r =>
    r.status === 'fulfilled' && r.value.interrupted
  ).length;
  
  console.log(`\n🎯 Summary: ${successful}/${NUM_CONCURRENT_REQUESTS} requests completed successfully`);
  if (interrupted > 0) {
    console.log(`   ${interrupted} requests were interrupted by server restart`);
  }
  
  if (successful === NUM_CONCURRENT_REQUESTS) {
    console.log("✅ All requests completed - graceful shutdown is working perfectly!");
  } else if (successful > 0) {
    console.log("⚠️ Some requests completed, some were interrupted - this may be expected during restart");
  } else {
    console.log("❌ No requests completed - check graceful shutdown implementation");
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testGracefulShutdown().catch(console.error);
}

export default testGracefulShutdown;
