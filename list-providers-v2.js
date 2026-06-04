"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bun_sqlite_1 = require("bun:sqlite");
const db = new bun_sqlite_1.Database('C:/Users/pc/.dmr-x/data.db');
const providers = db.query('SELECT name, adapter_type, is_healthy FROM providers').all();
console.log(JSON.stringify(providers, null, 2));
//# sourceMappingURL=list-providers-v2.js.map