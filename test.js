const fs = require('fs');
const sql = fs.readFileSync('ecommerce.sql', 'utf16le');
const usersStart = sql.indexOf('CREATE TABLE `users`');
if (usersStart !== -1) {
  const usersEnd = sql.indexOf(';', usersStart);
  console.log(sql.substring(usersStart, usersEnd + 1));
} else {
  console.log("No users table found");
}
