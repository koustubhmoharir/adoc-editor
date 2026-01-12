
if (!process.env.PORT) {
    throw new Error("PORT environment variable must be set. For example, prefix your command with 'cross-env PORT=8000' for development or 'cross-env PORT=8001' for testing")
}
export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000;
export const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
