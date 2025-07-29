#!/usr/bin/env node

/**
 * Facebook Connectivity Test Script
 * Run this script to diagnose Facebook connection issues
 */

import { testFacebookConnectivity } from './src/services/facebookService.js';
import https from 'https';

console.log('🔍 Facebook Connectivity Diagnostic Tool');
console.log('========================================\n');

async function runDiagnostics() {
  console.log('1. Testing basic Facebook connectivity...');
  
  try {
    const isReachable = await testFacebookConnectivity();
    if (isReachable) {
      console.log('✅ Facebook is reachable');
    } else {
      console.log('❌ Facebook is NOT reachable');
    }
  } catch (error) {
    console.log('❌ Error testing connectivity:', error.message);
  }

  console.log('\n2. Testing HTTPS connection...');
  
  const testHttps = () => {
    return new Promise((resolve) => {
      const req = https.get('https://www.facebook.com', { timeout: 10000 }, (res) => {
        console.log(`✅ HTTPS connection successful (Status: ${res.statusCode})`);
        resolve(true);
      });

      req.on('error', (err) => {
        console.log(`❌ HTTPS connection failed: ${err.message}`);
        if (err.code) {
          console.log(`   Error code: ${err.code}`);
        }
        resolve(false);
      });

      req.on('timeout', () => {
        console.log('❌ HTTPS connection timed out');
        req.destroy();
        resolve(false);
      });
    });
  };

  await testHttps();

  console.log('\n3. Network diagnostic suggestions:');
  console.log('   • Check your internet connection');
  console.log('   • Verify firewall settings (port 443 should be open)');
  console.log('   • Try using a VPN if in a restricted region');
  console.log('   • Check if Facebook is down: https://downdetector.com/status/facebook/');
  
  console.log('\n4. Quick network tests you can run:');
  console.log('   ping facebook.com');
  console.log('   curl -I https://www.facebook.com');
  console.log('   nslookup facebook.com');

  console.log('\n5. If issues persist:');
  console.log('   • Try using mobile hotspot');
  console.log('   • Contact your ISP or network administrator');
  console.log('   • Check FACEBOOK_TROUBLESHOOTING.md for detailed solutions');
}

// Run diagnostics
runDiagnostics().catch(console.error);
