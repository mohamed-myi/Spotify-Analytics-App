import { config } from 'dotenv';
import { resolve } from 'path';

const dotenvPath = resolve(__dirname, '../.env.test');

config({
    path: dotenvPath,
    override: true,
});

export {};
