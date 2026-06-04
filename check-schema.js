"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bun_sqlite_1 = require("bun:sqlite");
const db = new bun_sqlite_1.Database('C:/Users/pc/.dmr-x/data.db');
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables);
for (const table of tables) {
    const schema = db.query(`PRAGMA table_info(${table.name})`).all();
    console.log(`Schema for ${table.name}:`, schema);
}
//# sourceMappingURL=check-schema.js.map