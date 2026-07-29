#!/usr/bin/env node

/**
 * Standalone script to create a user
 * Run: node scripts/create-user-standalone.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Load environment from .env
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not required for this script
}

// Determine database path
const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const databaseUrl = process.env.DATABASE_URL || `file:${sqlitePath}`;

console.log('📁 Database URL:', databaseUrl);
console.log('📁 Checking database file:', sqlitePath);
console.log('   File exists:', fs.existsSync(sqlitePath));

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl
    }
  }
});

const USER_EMAIL = 'majidgohar@gmail.com';
const USER_PASSWORD = 'password123';
const USER_NAME = 'Majid Gohar';

async function main() {
  try {
    console.log('\n🔍 Checking for existing user:', USER_EMAIL);
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: USER_EMAIL }
    });
    
    if (existingUser) {
      console.log('\n✅ User already exists!');
      console.log('   Email:', existingUser.email);
      console.log('   Username:', existingUser.username);
      console.log('   Name:', existingUser.name);
      console.log('   Active:', existingUser.isActive);
      console.log('\n🔑 You can log in with:');
      console.log('   Email:', USER_EMAIL);
      console.log('   Password:', USER_PASSWORD);
      return;
    }
    
    console.log('\n❌ User not found. Creating new user...');
    
    // Hash password
    const hashedPassword = await bcrypt.hash(USER_PASSWORD, 12);
    
    // Create user
    const user = await prisma.user.create({
      data: {
        email: USER_EMAIL,
        username: 'majidgohar',
        name: USER_NAME,
        password: hashedPassword,
        isActive: true,
        businessAccessGranted: true,
        syncStatus: 'SYNCED'
      }
    });
    
    console.log('\n✅ User created successfully!');
    console.log('   ID:', user.id);
    console.log('   Email:', user.email);
    console.log('   Username:', user.username);
    console.log('\n🔑 Login credentials:');
    console.log('   Email:', USER_EMAIL);
    console.log('   Password:', USER_PASSWORD);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code) {
      console.error('   Error code:', error.code);
    }
    if (error.meta) {
      console.error('   Error meta:', error.meta);
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
