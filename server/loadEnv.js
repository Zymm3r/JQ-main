const path = require('path');
const dotenv = require('dotenv');

dotenv.config({
    // Prefer server/.env, while supporting the repository-root .env used by deployment tooling.
    path: [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env')],
    quiet: true
});
