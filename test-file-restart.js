#!/usr/bin/env node

/**
 * Simple test script to test nodemon restart mechanism
 */

import fs from 'fs';
import path from 'path';

async function testFileRestart() {
  console.log("🧪 Testing Nodemon File Restart Mechanism");
  console.log("========================================");
  
  try {
    const triggerFile = path.join(process.cwd(), '.nodemon-trigger');
    const signalFile = path.join(process.cwd(), 'src', 'services', 'restart-signal.js');
    const timestamp = new Date().toISOString();
    
    console.log("📁 Creating trigger files...");
    
    // Create main trigger file
    const triggerContent = `// Test restart trigger: ${timestamp}\n// Manual test\n`;
    fs.writeFileSync(triggerFile, triggerContent);
    console.log("✅ Created:", triggerFile);
    
    // Modify signal file
    const signalContent = `// This file is used to trigger nodemon restarts when database changes occur
// Test restart: ${timestamp}
export const lastRestart = "${timestamp}";
export const testRestart = true;
`;
    fs.writeFileSync(signalFile, signalContent);
    console.log("✅ Modified:", signalFile);
    
    console.log("⏳ Files created - nodemon should restart now...");
    console.log("💡 If nodemon doesn't restart, check:");
    console.log("   1. Is nodemon running?");
    console.log("   2. Are the files being watched?");
    console.log("   3. Check nodemon.json configuration");
    
    // Clean up after delay
    setTimeout(() => {
      try {
        if (fs.existsSync(triggerFile)) {
          fs.unlinkSync(triggerFile);
          console.log("🧹 Cleaned up trigger file");
        }
        
        // Reset signal file
        const defaultContent = `// This file is used to trigger nodemon restarts when database changes occur
// It gets modified and then deleted automatically
export const lastRestart = null;`;
        fs.writeFileSync(signalFile, defaultContent);
        console.log("🧹 Reset signal file");
        
      } catch (error) {
        console.error("❌ Cleanup error:", error.message);
      }
    }, 10000);
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testFileRestart();
}

export default testFileRestart;
