const http = require('http');

const accountData = {
  email: "JoelGrundydi@outlook.com",
  client_id: "9e5f94bc-e8a4-4e73-b8be-63364c29d753",
  refresh_token_enc: "M.C540_SN1.0.U.-CpFZTmNMcEFoMb9b5uf1XB7Rr8PiYdBuc0Z6c7j7PST8TJxucddMSmejWWuNGpjaEn3tQWcZlQFpuKZl9wzujmlbibUC1XlRT9AtvzmhrZUsoDoOBCB1ZlQfFHVJTXjHFI28Yeivf6D5oFJxMBKfawoZhHrorbz62I2Cn3a85MCDam2JW!H66fc6CQQy4iwjcTxZcda3G6sJEhxvobkYKBxLUEu70E1n7uoDqJrD87Pfmph5TxA0kZzMvuddyrTxe8F3hP498wEkIh9YJ0yLJOwX9b6gceiYxVd0SBshHEisQYkpasxkyj6iS9EHT8gEAla89ojff7o3KrWgPjKZiS!lnOjQI4BnvORENu7scNxNFOwr11nd8iQvrAqUwZLqgA$$",
  status: "authorized"
};

const postData = JSON.stringify(accountData);

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/accounts/batch',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`状态码: ${res.statusCode}`);
  console.log(`响应头: ${JSON.stringify(res.headers)}`);

  res.setEncoding('utf8');
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log(`响应体: ${body}`);
  });
});

req.on('error', (e) => {
  console.error(`请求遇到问题: ${e.message}`);
});

// 写入数据到请求主体
req.write(postData);
req.end();