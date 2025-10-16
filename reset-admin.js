// reset-admin.js
// Simple script to reset admin accounts via command line

import fetch from 'node-fetch';
import readline from 'readline';

const API_URL = 'http://localhost:5000';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('\n🔧 Admin Reset Tool\n');
console.log('This will check the current registration status.\n');

async function checkStatus() {
  try {
    const response = await fetch(`${API_URL}/api/auth/registration-status`);
    const data = await response.json();

    console.log('📊 Current Status:');
    console.log(`   Registration: ${data.registrationOpen ? '✅ OPEN' : '🔒 CLOSED'}`);
    console.log(`   Message: ${data.message}\n`);

    if (!data.registrationOpen) {
      console.log('⚠️  An admin account already exists.');
      console.log('💡 To delete it, you need to login and use the dashboard,');
      console.log('   or restart the server to clear the in-memory storage.\n');
    } else {
      console.log('✅ Registration is open! You can create a new admin account.\n');
    }

    rl.close();
  } catch (error) {
    console.error('❌ Error connecting to server. Make sure the server is running on port 5000.');
    console.error(`   Error: ${error.message}\n`);
    rl.close();
  }
}

checkStatus();
