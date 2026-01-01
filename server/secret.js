// Secret configuration file
// In production, this should contain actual Twilio credentials
export default {
    twilio: {
        accountSid: process.env.TWILIO_ACCOUNT_SID || '',
        authToken: process.env.TWILIO_AUTH_TOKEN || ''
    }
};

