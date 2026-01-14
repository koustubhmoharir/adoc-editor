export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8001; // Find a better solution to avoid hard-coding the port here
export const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
