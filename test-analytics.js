import dotenv from 'dotenv';
import { BetaAnalyticsDataClient } from '@google-analytics/data';

dotenv.config();

async function testAnalytics() {
  try {
    console.log('Testing Google Analytics connection...');
    console.log('Property ID:', process.env.GA_PROPERTY_ID);

    let analyticsDataClient;

    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      console.log('Using GOOGLE_SERVICE_ACCOUNT_KEY from environment');
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      analyticsDataClient = new BetaAnalyticsDataClient({
        credentials: credentials,
      });
    } else {
      console.log('Using default credentials');
      analyticsDataClient = new BetaAnalyticsDataClient();
    }

    const [response] = await analyticsDataClient.runReport({
      property: `properties/${process.env.GA_PROPERTY_ID}`,
      dateRanges: [
        {
          startDate: '7daysAgo',
          endDate: 'today',
        },
      ],
      metrics: [
        { name: 'activeUsers' },
      ],
    });

    console.log('\n✅ SUCCESS! Analytics connection working.');
    console.log('Active users (last 7 days):', response.rows?.[0]?.metricValues?.[0]?.value || 0);
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);

    if (error.message.includes('PERMISSION_DENIED')) {
      console.error('\n🔴 Permission Issue:');
      console.error('The service account email needs to be added to Google Analytics:');
      console.error('Email: analytics-reader@cry808.iam.gserviceaccount.com');
      console.error('\nSteps:');
      console.error('1. Go to https://analytics.google.com/');
      console.error('2. Click Admin (gear icon)');
      console.error('3. Under Property, click "Property Access Management"');
      console.error('4. Click "+" to add users');
      console.error('5. Add: analytics-reader@cry808.iam.gserviceaccount.com');
      console.error('6. Select role: "Viewer"');
      console.error('7. Click "Add"');
    } else if (error.message.includes('NOT_FOUND')) {
      console.error('\n🔴 Property ID Issue:');
      console.error('Property ID', process.env.GA_PROPERTY_ID, 'not found or not accessible');
      console.error('\nDouble-check your Property ID:');
      console.error('1. Go to https://analytics.google.com/');
      console.error('2. Admin > Property > Property Settings');
      console.error('3. Copy the Property ID (numeric value)');
    } else {
      console.error('\n🔴 Full error details:');
      console.error(error);
    }
  }
}

testAnalytics();
