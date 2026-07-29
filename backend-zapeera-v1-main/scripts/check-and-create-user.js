#!/usr/bin/env node

/**
 * Script to check if a user exists and create one if needed
 * Usage: node scripts/check-and-create-user.js [email] [password] [name]
 */

const { getPrisma } = require('../src/utils/db.util');
const bcrypt = require('bcryptjs');

const args = process.argv.slice(2);
const email = args[0] || 'majidgohar@gmail.com';
const password = args[1] || 'password123';
const name = args[2] || email.split('@')[0];
const username = email.split('@')[0];

async function main() {
  console.log(`🔍 Checking for user: ${email}`);
  
  try {
    const prisma = await getPrisma();
    
    // Check if user exists by email
    let user = await prisma.user.findUnique({
      where: { email: email }
    });
    
    // Check by username too
    if (!user) {
      user = await prisma.user.findUnique({
        where: { username: username }
      });
    }
    
    if (user) {
      console.log('✅ User found:');
      console.log(`  ID: ${user.id}`);
      console.log(`  Email: ${user.email}`);
      console.log(`  Username: ${user.username}`);
      console.log(`  Name: ${user.name}`);
      console.log(`  Active: ${user.isActive}`);
      console.log(`  Role: ${user.role || 'USER'}`);
      console.log('\n🔑 You can now log in with these credentials.');
      return;
    }
    
    console.log('❌ User not found. Creating new user...');
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const newUser = await prisma.user.create({
      data: {
        email: email,
        username: username,
        name: name,
        password: hashedPassword,
        isActive: true,
        businessAccessGranted: true,
        syncStatus: 'SYNCED',
        role: 'OWNER' // Give owner role for full access
      }
    });
    
    console.log('\n✅ User created successfully!');
    console.log(`  ID: ${newUser.id}`);
    console.log(`  Email: ${newUser.email}`);
    console.log(`  Username: ${newUser.username}`);
    console.log(`  Password: ${password}`);
    console.log('\n🔑 You can now log in with these credentials:');
    console.log(`  Email: ${email}`);
    console.log(`  Password: ${password}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
