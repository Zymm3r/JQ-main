const { spawn } = require('child_process');
require('./loadEnv');

if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is missing from server/.env or the repository-root .env');
    process.exit(1);
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, ['-y', 'mongodb-mcp-server@latest', '--readOnly'], {
    stdio: 'inherit',
    env: {
        ...process.env,
        MDB_MCP_CONNECTION_STRING: process.env.MONGO_URI
    }
});

child.on('error', error => {
    console.error(`Unable to start MongoDB MCP Server: ${error.message}`);
    process.exit(1);
});

child.on('exit', code => process.exit(code ?? 1));
