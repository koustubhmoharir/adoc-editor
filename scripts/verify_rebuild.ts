import * as http from 'http';
import { SERVER_HOST, SERVER_PORT } from './devserver.config.ts';

const options = {
    hostname: SERVER_HOST,
    port: SERVER_PORT,
    path: '/_rebuild',
    method: 'POST',
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();
