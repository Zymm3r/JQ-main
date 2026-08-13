const line = require('@line/bot-sdk');
require('./loadEnv');

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'mock_token',
    channelSecret: process.env.LINE_CHANNEL_SECRET || 'mock_secret'
};

const client = process.env.LINE_CHANNEL_ACCESS_TOKEN
    ? new line.Client(config)
    : null;
const messagingClient = process.env.LINE_CHANNEL_ACCESS_TOKEN
    ? new line.messagingApi.MessagingApiClient({ channelAccessToken: config.channelAccessToken })
    : null;

module.exports = {
    client,
    messagingClient
};
