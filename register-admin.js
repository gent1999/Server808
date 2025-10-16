// register-admin.js
// CLI script to register admin accounts via command line

import readline from 'readline';

const API_URL = 'https://server808.vercel.app';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🔐 Admin Registration Tool\n');
console.log('Register a new admin account via CLI\n');

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function checkRegistrationStatus() {
  try {
    const response = await fetch(`${API_URL}/api/auth/registration-status`);
    const data = await response.json();
    return data;
  } catch (error) {
    throw new Error('Failed to connect to server. Make sure the server is running on port 5000.');
  }
}

async function registerAdmin(username, email, password) {
  try {
    const response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Registration failed');
    }

    return data;
  } catch (error) {
    throw error;
  }
}

async function main() {
  try {
    // Check registration status
    console.log('📊 Checking registration status...\n');
    const status = await checkRegistrationStatus();

    if (!status.registrationOpen) {
      console.log('❌ Registration is closed!');
      console.log('   An admin account already exists.');
      console.log('   You must delete the existing admin before creating a new one.\n');
      rl.close();
      return;
    }

    console.log('✅ Registration is open!\n');

    // Get admin details
    const username = await question('Enter username (min 3 characters): ');
    const email = await question('Enter email: ');
    const password = await question('Enter password (min 6 characters): ');

    console.log('\n🔄 Creating admin account...\n');

    const result = await registerAdmin(username, email, password);

    console.log('✅ Admin account created successfully!\n');
    console.log('📋 Details:');
    console.log(`   Username: ${result.admin.username}`);
    console.log(`   Email: ${result.admin.email}`);
    console.log(`   ID: ${result.admin.id}\n`);
    console.log('🔑 Token generated (expires in 7 days)');
    console.log(`   ${result.token}\n`);
    console.log('✨ You can now login via the admin dashboard!\n');

  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
  } finally {
    rl.close();
  }
}

main();
