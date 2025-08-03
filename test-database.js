#!/usr/bin/env node

/**
 * Database connection test utility
 */

import prisma from "../src/config/db.js";
import { logger } from "../src/utils/logger.js";
import * as dotenv from 'dotenv';

dotenv.config();

async function testDatabaseConnection() {
  console.log("🔌 Testing Database Connection");
  console.log("============================");
  
  try {
    console.log("📡 Attempting to connect to database...");
    
    // Test basic connection
    await prisma.$connect();
    console.log("✅ Prisma client connected successfully");
    
    // Test with a simple query
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log("✅ Test query executed successfully:", result);
    
    // Test businesses table access
    const businessCount = await prisma.business.count();
    console.log(`✅ Business table accessible - found ${businessCount} businesses`);
    
    // Test a more complex query
    const businesses = await prisma.business.findMany({
      select: { id: true, businessName: true },
      take: 1
    });
    console.log("✅ Business query successful");
    
    console.log("\n🎉 All database tests passed!");
    console.log("   The database connection is working correctly.");
    
  } catch (error) {
    console.error("\n❌ Database connection failed:");
    console.error("   Error:", error.message);
    console.error("   Code:", error.code);
    
    if (error.message.includes("Can't reach database server")) {
      console.log("\n🔧 Troubleshooting steps:");
      console.log("   1. Check your internet connection");
      console.log("   2. Verify DATABASE_URL in .env file");
      console.log("   3. Check if Supabase service is running");
      console.log("   4. Verify database credentials");
      console.log("   5. Try again in a few minutes (temporary network issue)");
    }
    
    if (error.message.includes("timeout")) {
      console.log("\n⏱️ Connection timeout detected:");
      console.log("   1. Your internet connection might be slow");
      console.log("   2. Supabase server might be experiencing high load");
      console.log("   3. Try increasing connection timeout");
    }
    
    process.exit(1);
    
  } finally {
    try {
      await prisma.$disconnect();
      console.log("🔌 Database connection closed");
    } catch (disconnectError) {
      console.warn("⚠️ Error closing connection:", disconnectError.message);
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testDatabaseConnection();
}

export default testDatabaseConnection;
