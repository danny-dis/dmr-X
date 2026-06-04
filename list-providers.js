"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bun_sqlite_1 = require("bun:sqlite");
const db = new bun_sqlite_1.Database('C:/Users/pc/.dmr-x/data.db');
const providers = db.query('SELECT name, base_url, is_active FROM providers').all();
console.log(JSON.stringify(providers, null, 2));
//# sourceMappingURL=list-providers.js.map