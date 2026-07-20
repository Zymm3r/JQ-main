const line = require('@line/bot-sdk');
require('./loadEnv');

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'mock_token',
    channelSecret: process.env.LINE_CHANNEL_SECRET || 'mock_secret'
};

const client = process.env.LINE_CHANNEL_ACCESS_TOKEN
    ? new line.Client(config)
    : null;

module.exports = {
    client
};
