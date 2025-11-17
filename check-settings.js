import fs from 'fs';

console.log('='.repeat(70));
console.log('GOOGLE ANALYTICS PRODUCTION SETUP');
console.log('='.repeat(70));

try {
  // Read the credentials file
  const credentials = fs.readFileSync('./google-credentials.json', 'utf8');

  // Generate base64 encoded version
  const base64Encoded = Buffer.from(credentials).toString('base64');

  console.log('\n✅ Found google-credentials.json');
  console.log('\n📋 COPY THIS FOR VERCEL (BASE64 ENCODED - NO ESCAPING ISSUES):');
  console.log('-'.repeat(70));
  console.log('\nVariable Name: GOOGLE_SERVICE_ACCOUNT_KEY_BASE64');
  console.log('\nVariable Value (copy the line below):');
  console.log('-'.repeat(70));
  console.log(base64Encoded);
  console.log('-'.repeat(70));

  console.log('\n📝 INSTRUCTIONS FOR VERCEL:');
  console.log('1. Go to Vercel > Your Backend Project > Settings > Environment Variables');
  console.log('2. DELETE the old variable: GOOGLE_SERVICE_ACCOUNT_KEY');
  console.log('3. Add a NEW variable:');
  console.log('   Name: GOOGLE_SERVICE_ACCOUNT_KEY_BASE64');
  console.log('   Value: [paste the base64 string above]');
  console.log('4. Make sure you also have:');
  console.log('   Name: GA_PROPERTY_ID');
  console.log('   Value: 513403342');
  console.log('5. Redeploy your application');
  console.log('\n✅ This base64 format avoids all newline/escaping issues!');
  console.log('✅ Your local development will continue using the file');
  console.log('\n' + '='.repeat(70));
} catch (error) {
  console.error('❌ Error reading credentials file:', error.message);
  console.log('\nMake sure google-credentials.json exists in the Server808 folder');
}
