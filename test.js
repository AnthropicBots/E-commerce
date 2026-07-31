const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = 'ecommerce.sql';
const DEFAULT_ENCODING = 'utf8';

function getFilePath() {
    const args = process.argv.slice(2);
    const fileArg = args.find(arg => !arg.startsWith('--'));
    return fileArg || DEFAULT_FILE;
}

function getTableName() {
    const args = process.argv.slice(2);
    const tableArg = args.find(arg => arg.startsWith('--table='));
    if (tableArg) {
        return tableArg.split('=')[1];
    }
    return 'users';
}

function getEncoding() {
    const args = process.argv.slice(2);
    const encodingArg = args.find(arg => arg.startsWith('--encoding='));
    if (encodingArg) {
        return encodingArg.split('=')[1];
    }
    return DEFAULT_ENCODING;
}

function shouldListTables() {
    const args = process.argv.slice(2);
    return args.includes('--list') || args.includes('-l');
}

function shouldHelp() {
    const args = process.argv.slice(2);
    return args.includes('--help') || args.includes('-h');
}

function shouldSaveFile() {
    const args = process.argv.slice(2);
    return args.includes('--save') || args.includes('-s');
}

function showHelp() {
    console.log(`
Usage: node test.js [options] [file]

Options:
  --table=<name>    Table name to extract (default: users)
  --encoding=<enc>  File encoding (default: utf8)
  --list, -l        List all tables in the SQL file
  --save, -s        Save extracted table to file
  --help, -h        Show this help message

Examples:
  node test.js                          # Extract users table from ecommerce.sql
  node test.js schema.sql               # Extract users table from schema.sql
  node test.js --table=products         # Extract products table
  node test.js --list                   # List all tables in the file
  node test.js --encoding=utf16le       # Use UTF-16LE encoding
  node test.js --save                   # Save to file
    `);
}

function findTable(sql, tableName) {
    const patterns = [
        `CREATE TABLE \`${tableName}\``,
        `CREATE TABLE ${tableName}`,
        `CREATE TABLE IF NOT EXISTS \`${tableName}\``,
        `CREATE TABLE IF NOT EXISTS ${tableName}`
    ];
    
    for (const pattern of patterns) {
        const start = sql.indexOf(pattern);
        if (start !== -1) {
            return { start, pattern };
        }
    }
    return null;
}

function extractTable(sql, tableName) {
    const result = findTable(sql, tableName);
    
    if (!result) {
        return null;
    }
    
    const { start } = result;
    const end = sql.indexOf(';', start);
    
    if (end === -1) {
        return sql.substring(start);
    }
    
    return sql.substring(start, end + 1);
}

function listTables(sql) {
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/gi;
    const tables = [];
    let match;
    
    while ((match = tableRegex.exec(sql)) !== null) {
        tables.push(match[1]);
    }
    
    return [...new Set(tables)];
}

function readSqlFile(filePath) {
    try {
        const encoding = getEncoding();
        const resolvedPath = path.resolve(process.cwd(), filePath);
        
        if (!fs.existsSync(resolvedPath)) {
            console.error(`Error: File not found: ${resolvedPath}`);
            return null;
        }
        
        const stats = fs.statSync(resolvedPath);
        if (stats.size > 50 * 1024 * 1024) {
            console.warn(`Warning: File size (${(stats.size / (1024 * 1024)).toFixed(2)}MB) may cause performance issues`);
        }
        
        const content = fs.readFileSync(resolvedPath, encoding);
        
        if (!content || content.trim().length === 0) {
            console.error(`Error: File is empty: ${resolvedPath}`);
            return null;
        }
        
        return content;
        
    } catch (error) {
        console.error(`Error reading file: ${error.message}`);
        return null;
    }
}

function main() {
    if (shouldHelp()) {
        showHelp();
        process.exit(0);
    }
    
    const filePath = getFilePath();
    const tableName = getTableName();
    
    console.log(`Reading file: ${filePath}`);
    console.log(`Looking for table: ${tableName}`);
    
    const sql = readSqlFile(filePath);
    
    if (!sql) {
        process.exit(1);
    }
    
    if (shouldListTables()) {
        console.log('\nTables found in SQL file:');
        const tables = listTables(sql);
        if (tables.length === 0) {
            console.log('   No tables found');
        } else {
            tables.forEach((table, index) => {
                console.log(`   ${index + 1}. ${table}`);
            });
            console.log(`\n   Total: ${tables.length} tables`);
        }
        process.exit(0);
    }
    
    const tableSql = extractTable(sql, tableName);
    
    if (!tableSql) {
        console.error(`Error: Table "${tableName}" not found in the SQL file`);
        console.log(`\nAvailable tables:`);
        const tables = listTables(sql);
        if (tables.length === 0) {
            console.log('   No tables found');
        } else {
            tables.forEach((table) => {
                console.log(`   - ${table}`);
            });
        }
        process.exit(1);
    }
    
    console.log(`\nSuccessfully extracted "${tableName}" table:`);
    console.log('-'.repeat(50));
    console.log(tableSql);
    console.log('-'.repeat(50));
    console.log(`\nTable size: ${tableSql.length} characters`);
    
    if (shouldSaveFile()) {
        const outputFile = `${tableName}_extracted.sql`;
        try {
            fs.writeFileSync(outputFile, tableSql, 'utf8');
            console.log(`Saved to: ${outputFile}`);
        } catch (error) {
            console.warn(`Could not save to file: ${error.message}`);
        }
    }
    
    process.exit(0);
}

main();