import fs from 'fs';

console.log('='.repeat(70));
console.log('GOOGLE ANALYTICS PRODUCTION SETUP');
console.log('='.repeat(70));

try {
  // Read the credentials file
  const credentials = fs.readFileSync('./google-credentials.json', 'utf8');

  console.log('\n✅ Found google-credentials.json');
  console.log('\n📋 COPY THIS FOR PRODUCTION:');
  console.log('-'.repeat(70));
  console.log('\nVariable Name: GOOGLE_SERVICE_ACCOUNT_KEY');
  console.log('\nVariable Value (copy everything below):');
  console.log('-'.repeat(70));
  console.log(credentials);
  console.log('-'.repeat(70));

  console.log('\n📝 INSTRUCTIONS FOR VERCEL/HOSTING PLATFORM:');
  console.log('1. Go to your hosting platform (e.g., Vercel)');
  console.log('2. Navigate to: Project Settings > Environment Variables');
  console.log('3. Add a new variable:');
  console.log('   Name: GOOGLE_SERVICE_ACCOUNT_KEY');
  console.log('   Value: [paste the JSON above]');
  console.log('4. Also add:');
  console.log('   Name: GA_PROPERTY_ID');
  console.log('   Value: 513403342');
  console.log('5. Redeploy your application');
  console.log('\n✅ Your local development will continue using the file');
  console.log('✅ Production will use the environment variable');
  console.log('\n' + '='.repeat(70));
} catch (error) {
  console.error('❌ Error reading credentials file:', error.message);
  console.log('\nMake sure google-credentials.json exists in the Server808 folder');
}
