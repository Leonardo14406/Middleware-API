#!/usr/bin/env node

/**
 * Test script for database change monitoring
 * This script can be used to test if the server restarts when database changes occur
 */

import prisma from "../src/config/db.js";
import { logger } from "../src/utils/logger.js";

async function testDatabaseChanges() {
  try {
    console.log("🧪 Testing Database Change Monitor");
    console.log("=================================");
    
    // Get current businesses
    const businesses = await prisma.business.findMany({
      select: {
        id: true,
        businessName: true,
        email: true,
        facebookVerifyToken: true,
        whatsappVerifyToken: true
      }
    });
    
    console.log(`📊 Current businesses: ${businesses.length}`);
    businesses.forEach(b => {
      console.log(`  - ${b.businessName} (${b.email})`);
    });
    
    if (businesses.length === 0) {
      console.log("❌ No businesses found to test with. Please create a business first.");
      return;
    }
    
    console.log("\n⚠️  Testing server restart on deletion...");
    console.log("This will DELETE the first business temporarily!");
    console.log("Make sure your server is running with the database monitor enabled.");
    console.log("The server should restart automatically when the business is deleted.");
    
    // Wait for user confirmation in production
    console.log("\nPress Ctrl+C to cancel, or wait 5 seconds to proceed...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const testBusiness = businesses[0];
    console.log(`🗑️  Deleting business: ${testBusiness.businessName}`);
    
    // Delete the business (this should trigger server restart)
    await prisma.business.delete({
      where: { id: testBusiness.id }
    });
    
    console.log("✅ Business deleted successfully");
    console.log("🔄 Check if your server restarted automatically!");
    
    // Wait a moment then recreate the business
    console.log("\n⏳ Waiting 10 seconds before recreating...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log("🔄 Recreating the business...");
    await prisma.business.create({
      data: {
        id: testBusiness.id,
        businessName: testBusiness.businessName,
        email: testBusiness.email,
        password: "temp_password_for_test",
        chatbotId: "temp_chatbot_id",
        facebookVerifyToken: testBusiness.facebookVerifyToken,
        whatsappVerifyToken: testBusiness.whatsappVerifyToken
      }
    });
    
    console.log("✅ Business recreated successfully");
    console.log("🏁 Test completed!");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testDatabaseChanges();
}

export default testDatabaseChanges;
